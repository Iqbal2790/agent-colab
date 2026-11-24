import { startHttpServer } from './server.js';

const { host, port, vault } = startHttpServer();
console.log(`\n🚀 Agent Colab Server running on http://${host}:${port}`);
console.log(`   Vault : ${vault.vaultPath}`);
console.log(`   MCP   : http://${host}:${port}/mcp`);
console.log(`   Tunnel: OFF (private network only — toggle via CLI or Web Dashboard)\n`);
