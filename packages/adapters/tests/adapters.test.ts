import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import yaml from 'js-yaml';
import { VaultManager } from '@agent-colab/core';
import { AntigravityAdapter, HermesAdapter } from '../src/index.js';

describe('@agent-colab/adapters (sandboxed)', () => {
  let tmpRoot: string;
  let vault: VaultManager;
  let agyAdapter: AntigravityAdapter;
  let hermesAdapter: HermesAdapter;

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-colab-adapters-'));
    vault = new VaultManager(path.join(tmpRoot, 'vault'));
    vault.init();

    agyAdapter = new AntigravityAdapter({
      skillsDir: path.join(tmpRoot, 'agy', 'skills'),
      configPath: path.join(tmpRoot, 'agy', 'mcp_config.json'),
    });

    hermesAdapter = new HermesAdapter({
      skillsDir: path.join(tmpRoot, 'hermes', 'skills'),
      configPath: path.join(tmpRoot, 'hermes', 'config.yaml'),
    });
  });

  afterEach(() => {
    vault.close();
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('imports skills and MCP configs from Antigravity into Vault, then exports to Hermes', () => {
    // Seed mock Antigravity skill & MCP config
    const agySkillDir = path.join(tmpRoot, 'agy', 'skills', 'code-review');
    fs.mkdirSync(agySkillDir, { recursive: true });
    fs.writeFileSync(
      path.join(agySkillDir, 'SKILL.md'),
      '---\nname: code-review\ndescription: Strict PR reviewer\n---\n# Code Review\nCheck edge cases.',
      'utf8'
    );

    fs.mkdirSync(path.join(tmpRoot, 'agy'), { recursive: true });
    fs.writeFileSync(
      path.join(tmpRoot, 'agy', 'mcp_config.json'),
      JSON.stringify({
        mcpServers: {
          github: {
            command: 'npx',
            args: ['-y', '@modelcontextprotocol/server-github'],
            env: { GITHUB_TOKEN: 'ghp_supersecret1234567890123456' },
          },
        },
      }),
      'utf8'
    );

    // Dry run first should not mutate vault
    const dryImport = agyAdapter.importToVault(vault, { dryRun: true });
    expect(dryImport.actions).toHaveLength(2);
    expect(vault.listSkills()).toHaveLength(0);

    // Real import from Antigravity -> Vault
    const imported = agyAdapter.importToVault(vault);
    expect(imported.actions).toHaveLength(2);
    expect(vault.listSkills()).toHaveLength(1);
    const mcp = vault.getMcpRegistry();
    expect(mcp).toHaveLength(1);
    // Secret must be redacted!
    expect(mcp[0].env?.GITHUB_TOKEN).toBe('${GITHUB_TOKEN}');

    // Export from Vault -> Hermes
    const exported = hermesAdapter.exportFromVault(vault);
    expect(exported.actions).toHaveLength(2);

    const hermesSkill = path.join(tmpRoot, 'hermes', 'skills', 'code-review', 'SKILL.md');
    expect(fs.existsSync(hermesSkill)).toBe(true);

    const hermesCfg = yaml.load(
      fs.readFileSync(path.join(tmpRoot, 'hermes', 'config.yaml'), 'utf8')
    ) as { mcp_servers: Record<string, { command: string; env?: Record<string, string> }> };
    expect(hermesCfg.mcp_servers.github.command).toBe('npx');
    expect(hermesCfg.mcp_servers.github.env?.GITHUB_TOKEN).toBe('${GITHUB_TOKEN}');
  });

  it('connects Agent Colab MCP to both Antigravity and Hermes with auto-backup', () => {
    fs.mkdirSync(path.join(tmpRoot, 'hermes'), { recursive: true });
    fs.writeFileSync(path.join(tmpRoot, 'hermes', 'config.yaml'), 'model: hermes-3\n', 'utf8');

    const hermesConn = hermesAdapter.connectAgentColab({
      mode: 'http',
      serverUrl: 'http://127.0.0.1:4242/mcp',
    });
    expect(hermesConn.backupPath).toBeDefined();
    expect(fs.existsSync(hermesConn.backupPath!)).toBe(true);

    const cfg = yaml.load(
      fs.readFileSync(path.join(tmpRoot, 'hermes', 'config.yaml'), 'utf8')
    ) as { mcp_servers: Record<string, { url: string }> };
    expect(cfg.mcp_servers['agent-colab'].url).toBe('http://127.0.0.1:4242/mcp');

    const agyConn = agyAdapter.connectAgentColab({
      mode: 'stdio',
      vaultPath: vault.vaultPath,
    });
    expect(agyConn.entry.command).toBe('npx');
  });
});
