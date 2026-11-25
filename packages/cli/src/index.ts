#!/usr/bin/env node
import fs from 'node:fs';
import { Command } from 'commander';
import * as p from '@clack/prompts';
import { VaultManager, buildContextPack, getDefaultVaultPath } from '@agent-colab/core';
import { createAdapters, type AgentAdapterId } from '@agent-colab/adapters';
import { startHttpServer, startStdioMcpServer } from '@agent-colab/server';
import { TunnelManager, type TunnelScope } from '@agent-colab/tunnel';

const program = new Command();

program
  .name('agent-colab')
  .description('Centralized AI agent context, collaboration, and skill-sync hub')
  .version('0.1.0');

program
  .command('init')
  .description('Initialize a new Agent Colab Vault (Markdown + YAML + SQLite FTS5)')
  .option('-v, --vault <path>', 'Path to Vault directory', getDefaultVaultPath())
  .action((opts: { vault: string }) => {
    p.intro('Agent Colab — Vault Setup');
    const vault = new VaultManager(opts.vault);
    vault.init();
    const adapters = createAdapters();
    const detected = Object.values(adapters).map((a) => a.detect());

    p.log.success(`Vault initialized at: ${vault.vaultPath}`);
    for (const info of detected) {
      p.log.info(
        `${info.displayName}: ${info.installed ? 'Detected' : 'Not detected'} (${info.configPath})`
      );
    }
    vault.close();
    p.outro('Run `agent-colab serve` to start the private server & Web Dashboard.');
  });

program
  .command('serve')
  .description('Start the private Agent Colab HTTP Server, MCP endpoint, and Web Dashboard')
  .option('-H, --host <host>', 'Host interface to bind (default: 127.0.0.1)', '127.0.0.1')
  .option('-p, --port <port>', 'Port number', '4242')
  .option('-v, --vault <path>', 'Path to Vault directory')
  .action((opts: { host: string; port: string; vault?: string }) => {
    const port = Number(opts.port);
    const { host, vault } = startHttpServer({
      host: opts.host,
      port,
      vaultPath: opts.vault,
    });
    console.log(`\nAgent Colab running on http://${host}:${port}`);
    console.log(`  Vault     : ${vault.vaultPath}`);
    console.log(`  Dashboard : http://${host}:${port}`);
    console.log(`  MCP HTTP  : http://${host}:${port}/mcp`);
    console.log(`  Tunnel    : OFF (private network only — toggle via Web Dashboard or CLI)\n`);
  });

program
  .command('mcp')
  .description('Run Agent Colab as a local stdio MCP server (for Antigravity, Hermes, Claude Code, etc.)')
  .option('-v, --vault <path>', 'Path to Vault directory')
  .action(async (opts: { vault?: string }) => {
    await startStdioMcpServer(opts.vault);
  });

program
  .command('sync')
  .description('Import or export skills & MCP configs between supported agents and Vault')
  .requiredOption('-a, --agent <agent>', 'Target agent: antigravity | hermes | claude-code | openclaw | cursor')
  .requiredOption('-d, --direction <direction>', 'Direction: import | export')
  .option('--profile <name>', 'Hermes named profile (uses ~/.hermes/profiles/<name>)')
  .option('--hermes-home <path>', 'Custom HERMES_HOME directory (e.g. ~/.hermes-work)')
  .option('--dry-run', 'Preview changes without modifying any files', false)
  .option('-v, --vault <path>', 'Path to Vault directory')
  .action(
    (opts: {
      agent: AgentAdapterId;
      direction: 'import' | 'export';
      profile?: string;
      hermesHome?: string;
      dryRun: boolean;
      vault?: string;
    }) => {
      const vault = new VaultManager(opts.vault);
      vault.init();
      const adapter = createAdapters({
        hermes: { profile: opts.profile, hermesHome: opts.hermesHome },
      })[opts.agent];
      if (!adapter) {
        console.error(
          `Unknown agent "${opts.agent}". Supported: antigravity, hermes, claude-code, openclaw, cursor`
        );
        process.exit(1);
      }

      const res =
        opts.direction === 'import'
          ? adapter.importToVault(vault, { dryRun: opts.dryRun })
          : adapter.exportFromVault(vault, { dryRun: opts.dryRun });

      console.log(
        `\n[${res.dryRun ? 'DRY RUN' : 'APPLIED'}] ${adapter.displayName} (${res.direction}) — ${res.actions.length} item(s):`
      );
      for (const action of res.actions) {
        const redactNote =
          action.redactedKeys && action.redactedKeys.length > 0
            ? ` (redacted secrets: ${action.redactedKeys.join(', ')})`
            : '';
        console.log(`  - [${action.operation.toUpperCase()}] ${action.kind}: ${action.name}${redactNote}`);
      }
      if (res.backupPath) {
        console.log(`  Backup saved to: ${res.backupPath}`);
      }
      vault.close();
    }
  );

program
  .command('connect')
  .description('Register Agent Colab as an MCP server inside a supported agent')
  .argument('<agent>', 'Target agent: antigravity | hermes | claude-code | openclaw | cursor')
  .option('-m, --mode <mode>', 'Transport mode: http | stdio', 'http')
  .option('-u, --url <url>', 'MCP HTTP URL', 'http://127.0.0.1:4242/mcp')
  .option('--identity <id>', 'Device/profile identity, e.g. antigravity@laptop or hermes:work@pc')
  .option('--persona <name>', 'Persona profile to auto-load, e.g. work or personal')
  .option('--tags <tags>', 'Comma-separated project tags scope, e.g. work,backend')
  .option('--profile <name>', 'Hermes named profile (uses ~/.hermes/profiles/<name>)')
  .option('--hermes-home <path>', 'Custom HERMES_HOME directory (e.g. ~/.hermes-work)')
  .option('--dry-run', 'Preview config change without writing', false)
  .option('-v, --vault <path>', 'Path to Vault directory')
  .action(
    (
      agent: AgentAdapterId,
      opts: {
        mode: 'http' | 'stdio';
        url: string;
        identity?: string;
        persona?: string;
        tags?: string;
        profile?: string;
        hermesHome?: string;
        dryRun: boolean;
        vault?: string;
      }
    ) => {
      const adapter = createAdapters({
        hermes: { profile: opts.profile, hermesHome: opts.hermesHome },
      })[agent];
      if (!adapter) {
        console.error(
          `Unknown agent "${agent}". Supported: antigravity, hermes, claude-code, openclaw, cursor`
        );
        process.exit(1);
      }

      let finalUrl = opts.url;
      if (opts.mode === 'http' && (opts.identity || opts.persona || opts.tags)) {
        const parsed = new URL(opts.url);
        if (opts.identity) parsed.searchParams.set('agent', opts.identity);
        if (opts.persona) parsed.searchParams.set('persona', opts.persona);
        if (opts.tags) parsed.searchParams.set('tags', opts.tags);
        finalUrl = parsed.toString();
      }

      const res = adapter.connectAgentColab({
        mode: opts.mode,
        serverUrl: finalUrl,
        vaultPath: opts.vault ?? getDefaultVaultPath(),
        dryRun: opts.dryRun,
      });
      console.log(`\n[${res.dryRun ? 'DRY RUN' : 'CONNECTED'}] ${adapter.displayName}`);
      console.log(`  Config : ${res.configPath}`);
      if (res.backupPath) console.log(`  Backup : ${res.backupPath}`);
      console.log(`  Entry  : ${JSON.stringify(res.entry, null, 2)}\n`);
    }
  );

program
  .command('export')
  .description('Generate a Context Pack Markdown for Claude Chat or Gemini Web / Gems')
  .option('-t, --target <target>', 'Target format: claude | gemini | generic', 'claude')
  .option('-p, --project <slug>', 'Specific project slug')
  .option('-o, --out <file>', 'Write output to a file instead of stdout')
  .option('-v, --vault <path>', 'Path to Vault directory')
  .action((opts: { target: 'claude' | 'gemini' | 'generic'; project?: string; out?: string; vault?: string }) => {
    const vault = new VaultManager(opts.vault);
    vault.init();
    const md = buildContextPack(vault, {
      target: opts.target,
      projectSlug: opts.project,
      includeSkills: true,
    });
    if (opts.out) {
      fs.writeFileSync(opts.out, md, 'utf8');
      console.log(`Context Pack written to ${opts.out}`);
    } else {
      console.log(md);
    }
    vault.close();
  });

program
  .command('tunnel')
  .description('Start a standalone on-demand Cloudflare Quick Tunnel with TTL')
  .option('-p, --port <port>', 'Local Agent Colab port', '4242')
  .option('--ttl <minutes>', 'Auto-close after N minutes', '30')
  .option('--scope <scope>', 'read-only | read-write', 'read-only')
  .action(async (opts: { port: string; ttl: string; scope: TunnelScope }) => {
    const manager = new TunnelManager();
    try {
      const status = await manager.start({
        localPort: Number(opts.port),
        ttlMinutes: Number(opts.ttl),
        scope: opts.scope,
      });
      console.log(`\nTunnel active!`);
      console.log(`  Public URL : ${status.publicUrl}`);
      console.log(`  Scope      : ${status.scope}`);
      console.log(`  Expires At : ${status.expiresAt}`);
      console.log(`  Press Ctrl+C to close the tunnel immediately.\n`);
      process.on('SIGINT', () => {
        manager.stop();
        process.exit(0);
      });
    } catch (err) {
      console.error((err as Error).message);
      process.exit(1);
    }
  });

program.parse();
