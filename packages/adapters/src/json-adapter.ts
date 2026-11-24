import fs from 'node:fs';
import path from 'node:path';
import type { McpServerEntry, VaultManager } from '@agent-colab/core';
import type {
  AdapterDetectInfo,
  AgentAdapter,
  AgentAdapterId,
  ConnectOptions,
  ConnectResult,
  SyncActionItem,
  SyncResult,
} from './types.js';

export interface JsonAgentAdapterConfig {
  id: AgentAdapterId;
  displayName: string;
  skillsDir: string;
  configPath: string;
  /** Path to the MCP servers object inside the JSON config, e.g. ['mcpServers'] or ['mcp', 'servers'] */
  mcpKeyPath: string[];
  /** Field name for HTTP MCP URL when connecting, e.g. 'url' or 'serverUrl' */
  httpUrlField?: string;
  /** Optional extra fields for HTTP MCP entries, e.g. { type: 'http' } for Claude Code */
  httpExtraFields?: Record<string, unknown>;
}

function createBackup(filePath: string): string | undefined {
  if (!fs.existsSync(filePath)) return undefined;
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = `${filePath}.bak.${stamp}`;
  fs.copyFileSync(filePath, backupPath);
  return backupPath;
}

function getNestedRecord(
  obj: Record<string, unknown>,
  keyPath: string[]
): Record<string, Record<string, unknown>> {
  let curr: unknown = obj;
  for (const key of keyPath) {
    if (!curr || typeof curr !== 'object') return {};
    curr = (curr as Record<string, unknown>)[key];
  }
  return (curr && typeof curr === 'object' ? curr : {}) as Record<string, Record<string, unknown>>;
}

function setNestedRecord(
  obj: Record<string, unknown>,
  keyPath: string[],
  value: Record<string, Record<string, unknown>>
): Record<string, unknown> {
  const root = { ...obj };
  let curr: Record<string, unknown> = root;
  for (let i = 0; i < keyPath.length - 1; i++) {
    const key = keyPath[i];
    const next = curr[key];
    curr[key] = next && typeof next === 'object' ? { ...(next as Record<string, unknown>) } : {};
    curr = curr[key] as Record<string, unknown>;
  }
  curr[keyPath[keyPath.length - 1]] = value;
  return root;
}

export class JsonAgentAdapter implements AgentAdapter {
  public readonly id: AgentAdapterId;
  public readonly displayName: string;
  private readonly skillsDir: string;
  private readonly configPath: string;
  private readonly mcpKeyPath: string[];
  private readonly httpUrlField: string;
  private readonly httpExtraFields: Record<string, unknown>;

  constructor(cfg: JsonAgentAdapterConfig) {
    this.id = cfg.id;
    this.displayName = cfg.displayName;
    this.skillsDir = cfg.skillsDir;
    this.configPath = cfg.configPath;
    this.mcpKeyPath = cfg.mcpKeyPath;
    this.httpUrlField = cfg.httpUrlField ?? 'url';
    this.httpExtraFields = cfg.httpExtraFields ?? {};
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

  private readJsonConfig(): Record<string, unknown> {
    if (!fs.existsSync(this.configPath)) return {};
    const raw = fs.readFileSync(this.configPath, 'utf8').trim();
    if (!raw) return {};
    return JSON.parse(raw) as Record<string, unknown>;
  }

  importToVault(vault: VaultManager, options?: { dryRun?: boolean }): SyncResult {
    const dryRun = options?.dryRun ?? false;
    const actions: SyncActionItem[] = [];

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

    if (fs.existsSync(this.configPath)) {
      const parsed = this.readJsonConfig();
      const servers = getNestedRecord(parsed, this.mcpKeyPath);
      const existingNames = new Set(vault.getMcpRegistry().map((s) => s.name));

      for (const [name, cfg] of Object.entries(servers)) {
        if (name === 'agent-colab') continue;
        const httpUrl = cfg.url ?? cfg.serverUrl ?? cfg.httpUrl;
        const entry: McpServerEntry = httpUrl
          ? {
              name,
              transport: 'http',
              url: String(httpUrl),
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

    const registry = vault.getMcpRegistry().filter((s) => s.enabled !== false);
    let backupPath: string | undefined;

    if (registry.length > 0) {
      const existingConfig = this.readJsonConfig();
      const mcpServers = { ...getNestedRecord(existingConfig, this.mcpKeyPath) };

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
                ...this.httpExtraFields,
                [this.httpUrlField]: srv.url,
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
        const updated = setNestedRecord(existingConfig, this.mcpKeyPath, mcpServers);
        fs.mkdirSync(path.dirname(this.configPath), { recursive: true });
        fs.writeFileSync(this.configPath, JSON.stringify(updated, null, 2) + '\n', 'utf8');
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
            ...this.httpExtraFields,
            [this.httpUrlField]: options.serverUrl ?? 'http://127.0.0.1:4242/mcp',
          }
        : {
            command: options.cliCommand ?? 'npx',
            args: options.cliArgs ?? ['-y', '@agent-colab/cli', 'mcp'],
            ...(options.vaultPath ? { env: { AGENT_COLAB_VAULT: options.vaultPath } } : {}),
          };

    let backupPath: string | undefined;
    if (!dryRun) {
      const existing = this.readJsonConfig();
      backupPath = createBackup(this.configPath);
      const mcpServers = { ...getNestedRecord(existing, this.mcpKeyPath) };
      mcpServers['agent-colab'] = entry;
      const updated = setNestedRecord(existing, this.mcpKeyPath, mcpServers);
      fs.mkdirSync(path.dirname(this.configPath), { recursive: true });
      fs.writeFileSync(this.configPath, JSON.stringify(updated, null, 2) + '\n', 'utf8');
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
