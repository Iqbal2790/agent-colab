import os from 'node:os';
import path from 'node:path';
import { JsonAgentAdapter } from './json-adapter.js';

export interface SimpleAdapterOptions {
  skillsDir?: string;
  configPath?: string;
}

export class ClaudeCodeAdapter extends JsonAgentAdapter {
  constructor(options?: SimpleAdapterOptions) {
    const home = os.homedir();
    super({
      id: 'claude-code',
      displayName: 'Claude Code',
      skillsDir: options?.skillsDir ?? path.join(home, '.claude', 'skills'),
      configPath: options?.configPath ?? path.join(home, '.claude.json'),
      mcpKeyPath: ['mcpServers'],
      httpUrlField: 'url',
      httpExtraFields: { type: 'http' },
    });
  }
}

export class OpenClawAdapter extends JsonAgentAdapter {
  constructor(options?: SimpleAdapterOptions) {
    const home = os.homedir();
    super({
      id: 'openclaw',
      displayName: 'OpenClaw',
      skillsDir: options?.skillsDir ?? path.join(home, '.openclaw', 'skills'),
      configPath: options?.configPath ?? path.join(home, '.openclaw', 'openclaw.json'),
      mcpKeyPath: ['mcp', 'servers'],
      httpUrlField: 'url',
    });
  }
}

export class CursorAdapter extends JsonAgentAdapter {
  constructor(options?: SimpleAdapterOptions) {
    const home = os.homedir();
    super({
      id: 'cursor',
      displayName: 'Cursor',
      skillsDir: options?.skillsDir ?? path.join(home, '.cursor', 'skills'),
      configPath: options?.configPath ?? path.join(home, '.cursor', 'mcp.json'),
      mcpKeyPath: ['mcpServers'],
      httpUrlField: 'url',
    });
  }
}
