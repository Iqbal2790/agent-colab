import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import yaml from 'js-yaml';
import type { McpServerEntry, VaultManager } from '@agent-colab/core';
import type {
  AdapterDetectInfo,
  AgentAdapter,
  ConnectOptions,
  ConnectResult,
  SyncActionItem,
  SyncResult,
} from './types.js';

export interface HermesAdapterOptions {
  skillsDir?: string;
  configPath?: string;
  /** Optional named Hermes profile (resolves to ~/.hermes/profiles/<profile>/) */
  profile?: string;
  /** Optional custom HERMES_HOME directory (e.g. ~/.hermes-work) */
  hermesHome?: string;
}

interface HermesConfig {
  mcp_servers?: Record<string, Record<string, unknown>>;
  skills?: {
    external_dirs?: string[];
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

function createBackup(filePath: string): string | undefined {
  if (!fs.existsSync(filePath)) return undefined;
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = `${filePath}.bak.${stamp}`;
  fs.copyFileSync(filePath, backupPath);
  return backupPath;
}

export class HermesAdapter implements AgentAdapter {
  public readonly id = 'hermes' as const;
  public readonly displayName: string;
  private readonly skillsDir: string;
  private readonly configPath: string;

  constructor(options?: HermesAdapterOptions) {
    const home = os.homedir();
    const profileName = options?.profile?.trim();
    const baseDir = options?.hermesHome?.trim()
      ? path.resolve(options.hermesHome.trim())
      : profileName
        ? path.join(home, '.hermes', 'profiles', profileName)
        : path.join(home, '.hermes');

    this.displayName = profileName ? `Hermes Agent (${profileName})` : 'Hermes Agent';
    this.skillsDir = options?.skillsDir ?? path.join(baseDir, 'skills');
    this.configPath = options?.configPath ?? path.join(baseDir, 'config.yaml');
  }

  detect(): AdapterDetectInfo {
    const installed = fs.existsSync(this.skillsDir) || fs.existsSync(this.configPath);
    return {
      agent: this.id,
      displayName: this.displayName,
      installed,
      skillsDir: this.skillsDir,
      configPath: this.configPath,
    };
  }

  private readConfig(): HermesConfig {
    if (!fs.existsSync(this.configPath)) return {};
    const parsed = yaml.load(fs.readFileSync(this.configPath, 'utf8'));
    return (parsed && typeof parsed === 'object' ? parsed : {}) as HermesConfig;
  }

  importToVault(vault: VaultManager, options?: { dryRun?: boolean }): SyncResult {
    const dryRun = options?.dryRun ?? false;
    const actions: SyncActionItem[] = [];
    const cfg = this.readConfig();

    // Collect skills from ~/.hermes/skills and any configured external_dirs
    const skillDirs = [this.skillsDir, ...(cfg.skills?.external_dirs ?? [])].filter((d) =>
      fs.existsSync(d)
    );
    const seenSkills = new Set<string>();

    for (const dir of skillDirs) {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (!entry.isDirectory() || seenSkills.has(entry.name)) continue;
        const skillFile = path.join(dir, entry.name, 'SKILL.md');
        if (!fs.existsSync(skillFile)) continue;
        seenSkills.add(entry.name);

        const existing = vault.getSkill(entry.name);
        const raw = fs.readFileSync(skillFile, 'utf8');
        const op = existing ? (existing.content === raw ? 'skip' : 'update') : 'create';

        actions.push({
          kind: 'skill',
          name: entry.name,
          operation: op,
          targetPath: path.join(vault.vaultPath, 'skills', entry.name, 'SKILL.md'),
        });

        if (!dryRun && op !== 'skip') {
          vault.upsertSkill(entry.name, raw, this.id);
        }
      }
    }

    // Import mcp_servers from ~/.hermes/config.yaml
    const mcpServers = cfg.mcp_servers ?? {};
    const existingNames = new Set(vault.getMcpRegistry().map((s) => s.name));

    for (const [name, srv] of Object.entries(mcpServers)) {
      if (name === 'agent-colab') continue;
      const entry: McpServerEntry = srv.url
        ? {
            name,
            transport: 'http',
            url: String(srv.url),
            headers: (srv.headers as Record<string, string> | undefined) ?? undefined,
            sourceAgent: this.id,
          }
        : {
            name,
            transport: 'stdio',
            command: String(srv.command ?? ''),
            args: Array.isArray(srv.args) ? srv.args.map(String) : [],
            env: (srv.env as Record<string, string> | undefined) ?? undefined,
            sourceAgent: this.id,
          };

      const op = existingNames.has(name) ? 'update' : 'create';
      let redactedKeys: string[] = [];
      if (!dryRun) {
        const res = vault.upsertMcpServer(entry);
        redactedKeys = res.redactedKeys;
      }

      actions.push({
        kind: 'mcp',
        name,
        operation: op,
        targetPath: path.join(vault.vaultPath, 'configs', 'mcp-registry.yaml'),
        redactedKeys,
      });
    }

    return {
      agent: this.id,
      direction: 'import',
      dryRun,
      actions,
    };
  }

  exportFromVault(vault: VaultManager, options?: { dryRun?: boolean }): SyncResult {
    const dryRun = options?.dryRun ?? false;
    const actions: SyncActionItem[] = [];

    // 1. Export skills to ~/.hermes/skills
    for (const skill of vault.listSkills()) {
      const targetFile = path.join(this.skillsDir, skill.name, 'SKILL.md');
      const exists = fs.existsSync(targetFile);
      const current = exists ? fs.readFileSync(targetFile, 'utf8') : '';
      const op = exists ? (current === skill.content ? 'skip' : 'update') : 'create';

      actions.push({
        kind: 'skill',
        name: skill.name,
        operation: op,
        targetPath: targetFile,
      });

      if (!dryRun && op !== 'skip') {
        fs.mkdirSync(path.dirname(targetFile), { recursive: true });
        fs.writeFileSync(targetFile, skill.content, 'utf8');
      }
    }

    // 2. Export MCP servers into ~/.hermes/config.yaml
    const registry = vault.getMcpRegistry().filter((s) => s.enabled !== false);
    let backupPath: string | undefined;

    if (registry.length > 0) {
      const cfg = this.readConfig();
      const mcpServers = cfg.mcp_servers ?? {};

      for (const srv of registry) {
        const op = mcpServers[srv.name] ? 'update' : 'create';
        actions.push({
          kind: 'mcp',
          name: srv.name,
          operation: op,
          targetPath: this.configPath,
        });

        mcpServers[srv.name] =
          srv.transport === 'http'
            ? {
                url: srv.url,
                ...(srv.headers ? { headers: srv.headers } : {}),
              }
            : {
                command: srv.command,
                args: srv.args ?? [],
                ...(srv.env ? { env: srv.env } : {}),
              };
      }

      if (!dryRun) {
        backupPath = createBackup(this.configPath);
        fs.mkdirSync(path.dirname(this.configPath), { recursive: true });
        cfg.mcp_servers = mcpServers;
        fs.writeFileSync(this.configPath, yaml.dump(cfg, { lineWidth: 120 }), 'utf8');
      }
    }

    return {
      agent: this.id,
      direction: 'export',
      dryRun,
      actions,
      backupPath,
    };
  }

  connectAgentColab(options: ConnectOptions): ConnectResult {
    const dryRun = options.dryRun ?? false;
    const entry: Record<string, unknown> =
      options.mode === 'http'
        ? {
            url: options.serverUrl ?? 'http://127.0.0.1:4242/mcp',
          }
        : {
            command: options.cliCommand ?? 'npx',
            args: options.cliArgs ?? ['-y', '@agent-colab/cli', 'mcp'],
            ...(options.vaultPath ? { env: { AGENT_COLAB_VAULT: options.vaultPath } } : {}),
          };

    let backupPath: string | undefined;
    if (!dryRun) {
      const cfg = this.readConfig();
      backupPath = createBackup(this.configPath);
      cfg.mcp_servers = cfg.mcp_servers ?? {};
      cfg.mcp_servers['agent-colab'] = entry;
      fs.mkdirSync(path.dirname(this.configPath), { recursive: true });
      fs.writeFileSync(this.configPath, yaml.dump(cfg, { lineWidth: 120 }), 'utf8');
    }

    return {
      agent: this.id,
      configPath: this.configPath,
      backupPath,
      dryRun,
      entry,
    };
  }
}
