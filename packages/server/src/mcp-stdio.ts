import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { VaultManager } from '@agent-colab/core';
import { createMcpServer } from './mcp.js';

export async function startStdioMcpServer(vaultPath?: string): Promise<void> {
  const vault = new VaultManager(vaultPath);
  vault.init();
  const mcpServer = createMcpServer(vault, { readOnly: false, via: 'mcp' });
  const transport = new StdioServerTransport();
  await mcpServer.connect(transport);
}
