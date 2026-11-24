import { AntigravityAdapter, type AntigravityAdapterOptions } from './antigravity.js';
import { HermesAdapter, type HermesAdapterOptions } from './hermes.js';
import {
  ClaudeCodeAdapter,
  CursorAdapter,
  OpenClawAdapter,
  type SimpleAdapterOptions,
} from './agents.js';
import type { AgentAdapter, AgentAdapterId } from './types.js';

export * from './types.js';
export * from './antigravity.js';
export * from './hermes.js';
export * from './json-adapter.js';
export * from './agents.js';

export interface AdapterRegistryOptions {
  antigravity?: AntigravityAdapterOptions;
  hermes?: HermesAdapterOptions;
  'claude-code'?: SimpleAdapterOptions;
  openclaw?: SimpleAdapterOptions;
  cursor?: SimpleAdapterOptions;
}

export function createAdapters(
  options?: AdapterRegistryOptions
): Record<AgentAdapterId, AgentAdapter> {
  return {
    antigravity: new AntigravityAdapter(options?.antigravity),
    hermes: new HermesAdapter(options?.hermes),
    'claude-code': new ClaudeCodeAdapter(options?.['claude-code']),
    openclaw: new OpenClawAdapter(options?.openclaw),
    cursor: new CursorAdapter(options?.cursor),
  };
}

export function getAdapter(id: AgentAdapterId, options?: AdapterRegistryOptions): AgentAdapter {
  const all = createAdapters(options);
  return all[id];
}
