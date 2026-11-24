import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { McpServerEntry, VaultManager } from '@agent-colab/core';
import type {
  AdapterDetectInfo,
  AgentAdapter,
  ConnectOptions,
  ConnectResult,
  SyncActionItem,
  SyncResult,
} from './types.js';

export interface AntigravityAdapterOptions {
  skillsDir?: string;
  configPath?: string;
}

function createBackup(filePath: string): string | undefined {
  if (!fs.existsSync(filePath)) return undefined;
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = `${filePath}.bak.${stamp}`;
  fs.copyFileSync(filePath, backupPath);
  return backupPath;
}

export class AntigravityAdapter implements AgentAdapter {
  public readonly id = 'antigravity' as const;
  public readonly displayName = 'Antigravity';
  private readonly skillsDir: string;
  private readonly configPath: string;

  constructor(options?: AntigravityAdapterOptions) {
    const home = os.homedir();
    this.skillsDir = options?.skillsDir ?? path.join(home, '.gemini', 'config', 'skills');
    this.configPath =
      options?.configPath ?? path.join(home, '.gemini', 'config', 'mcp_config.json');
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

  importToVault(vault: VaultManager, options?: { dryRun?: boolean }): SyncResult {
    const dryRun = options?.dryRun ?? false;
    const actions: SyncActionItem[] = [];

    // 1. Import SKILL.md folders
    if (fs.existsSync(this.skillsDir)) {
      for (const entry of fs.readdirSync(this.skillsDir, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const skillFile = path.join(this.skillsDir, entry.name, 'SKILL.md');
        if (!fs.existsSync(skillFile)) continue;

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

    // 2. Import MCP servers from mcp_config.json
    if (fs.existsSync(this.configPath)) {
      const parsed = JSON.parse(fs.readFileSync(this.configPath, 'utf8')) as {
        mcpServers?: Record<string, Record<string, unknown>>;
      };
      const servers = parsed.mcpServers ?? {};
      const existingNames = new Set(vault.getMcpRegistry().map((s) => s.name));

      for (const [name, cfg] of Object.entries(servers)) {
        if (name === 'agent-colab') continue;
        const entry: McpServerEntry = cfg.url
          ? {
              name,
              transport: 'http',
              url: String(cfg.url),
              headers: (cfg.headers as Record<string, string> | undefined) ?? undefined,
              sourceAgent: this.id,
            }
          : {
              name,
              transport: 'stdio',
              command: String(cfg.command ?? ''),
              args: Array.isArray(cfg.args) ? cfg.args.map(String) : [],
              env: (cfg.env as Record<string, string> | undefined) ?? undefined,
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

    // 1. Export skills to ~/.gemini/config/skills
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

    // 2. Export MCP servers into mcp_config.json
    const registry = vault.getMcpRegistry().filter((s) => s.enabled !== false);
    let backupPath: string | undefined;

    if (registry.length > 0) {
      let existingConfig: { mcpServers?: Record<string, Record<string, unknown>> } = {
        mcpServers: {},
      };
      if (fs.existsSync(this.configPath)) {
        existingConfig = JSON.parse(fs.readFileSync(this.configPath, 'utf8'));
      }
      const mcpServers = existingConfig.mcpServers ?? {};

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
        fs.writeFileSync(
          this.configPath,
          JSON.stringify({ ...existingConfig, mcpServers }, null, 2) + '\n',
          'utf8'
        );
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
      let existing: { mcpServers?: Record<string, Record<string, unknown>> } = { mcpServers: {} };
      if (fs.existsSync(this.configPath)) {
        existing = JSON.parse(fs.readFileSync(this.configPath, 'utf8'));
        backupPath = createBackup(this.configPath);
      }
      const mcpServers = existing.mcpServers ?? {};
      mcpServers['agent-colab'] = entry;
      fs.mkdirSync(path.dirname(this.configPath), { recursive: true });
      fs.writeFileSync(
        this.configPath,
        JSON.stringify({ ...existing, mcpServers }, null, 2) + '\n',
        'utf8'
      );
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
