import type { VaultManager } from '@agent-colab/core';

export type AgentAdapterId = 'antigravity' | 'hermes';

export interface SyncActionItem {
  kind: 'skill' | 'mcp';
  name: string;
  operation: 'create' | 'update' | 'skip';
  targetPath: string;
  redactedKeys?: string[];
}

export interface SyncResult {
  agent: AgentAdapterId;
  direction: 'import' | 'export';
  dryRun: boolean;
  actions: SyncActionItem[];
  backupPath?: string;
}

export interface ConnectOptions {
  mode: 'stdio' | 'http';
  serverUrl?: string;
  cliCommand?: string;
  cliArgs?: string[];
  vaultPath?: string;
  dryRun?: boolean;
}

export interface ConnectResult {
  agent: AgentAdapterId;
  configPath: string;
  backupPath?: string;
  dryRun: boolean;
  entry: Record<string, unknown>;
}

export interface AdapterDetectInfo {
  agent: AgentAdapterId;
  displayName: string;
  installed: boolean;
  skillsDir: string;
  configPath: string;
}

export interface AgentAdapter {
  readonly id: AgentAdapterId;
  readonly displayName: string;
  detect(): AdapterDetectInfo;
  importToVault(vault: VaultManager, options?: { dryRun?: boolean }): SyncResult;
  exportFromVault(vault: VaultManager, options?: { dryRun?: boolean }): SyncResult;
  connectAgentColab(options: ConnectOptions): ConnectResult;
}
