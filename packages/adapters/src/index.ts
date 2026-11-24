import { AntigravityAdapter, type AntigravityAdapterOptions } from './antigravity.js';
import { HermesAdapter, type HermesAdapterOptions } from './hermes.js';
import type { AgentAdapter, AgentAdapterId } from './types.js';

export * from './types.js';
export * from './antigravity.js';
export * from './hermes.js';

export interface AdapterRegistryOptions {
  antigravity?: AntigravityAdapterOptions;
  hermes?: HermesAdapterOptions;
}

export function createAdapters(options?: AdapterRegistryOptions): Record<AgentAdapterId, AgentAdapter> {
  return {
    antigravity: new AntigravityAdapter(options?.antigravity),
    hermes: new HermesAdapter(options?.hermes),
  };
}

export function getAdapter(id: AgentAdapterId, options?: AdapterRegistryOptions): AgentAdapter {
  const all = createAdapters(options);
  return all[id];
}
