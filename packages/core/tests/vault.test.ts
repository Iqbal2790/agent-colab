import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { VaultManager, buildContextPack, redactEnvRecord, syncSkillsDirectory } from '../src/index.js';

describe('@agent-colab/core', () => {
  let tmpDir: string;
  let vault: VaultManager;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-colab-core-'));
    vault = new VaultManager(tmpDir);
    vault.init();
  });

  afterEach(() => {
    vault.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('initializes default vault files and profile', () => {
    const profile = vault.getUserProfile();
    expect(profile.content).toContain('User Profile');
    const rules = vault.getGlobalRules();
    expect(rules.content).toContain('Global Agent Rules');
  });

  it('supports project CRUD, decisions, tasks, locking, and handoff notes', () => {
    const project = vault.upsertProject('demo-app', {
      name: 'Demo App',
      status: 'active',
      tags: ['ts', 'mcp'],
      content: 'Main architecture uses Hono and MCP.',
    });
    expect(project.slug).toBe('demo-app');

    vault.appendDecision('demo-app', 'Use node:sqlite', 'Zero native compilation needed.', 'antigravity');
    const updatedProject = vault.getProject('demo-app')!;
    expect(updatedProject.decisions).toContain('Use node:sqlite');

    const task = vault.createTask({
      projectSlug: 'demo-app',
      id: 'auth-flow',
      title: 'Implement auth flow',
      priority: 'high',
      createdBy: 'user',
      body: 'Add bearer token validation.',
    });
    expect(task.status).toBe('todo');

    const claimed = vault.claimTask('demo-app', 'auth-flow', 'antigravity', 30);
    expect(claimed.claimedBy).toBe('antigravity');
    expect(claimed.status).toBe('in_progress');

    // Another agent cannot claim while locked
    expect(() => vault.claimTask('demo-app', 'auth-flow', 'hermes', 30)).toThrow(/locked by "antigravity"/);

    // Release as handoff
    const handedOff = vault.updateTask('demo-app', 'auth-flow', { status: 'handoff' });
    expect(handedOff.claimedBy).toBeUndefined();

    // Hermes can now claim
    const claimedByHermes = vault.claimTask('demo-app', 'auth-flow', 'hermes', 30);
    expect(claimedByHermes.claimedBy).toBe('hermes');

    // Handoff notes
    const note = vault.createNote({
      projectSlug: 'demo-app',
      authorAgent: 'antigravity',
      title: 'Backend auth done',
      summary: 'Implemented middleware and token parsing.',
      nextSteps: ['Write integration tests', 'Wire dashboard UI'],
      relatedTaskId: 'auth-flow',
    });
    expect(note.authorAgent).toBe('antigravity');

    const notes = vault.listNotes('demo-app');
    expect(notes).toHaveLength(1);
    expect(notes[0].nextSteps).toContain('Write integration tests');
  });

  it('indexes and searches across projects, tasks, notes, and skills via FTS5', () => {
    vault.upsertProject('search-proj', {
      name: 'Search Project',
      content: 'Uses Cloudflared tunnel for ephemeral access.',
    });
    vault.createNote({
      projectSlug: 'search-proj',
      authorAgent: 'hermes',
      title: 'Tunnel check',
      summary: 'Verified ephemeral token expiry works.',
    });
    vault.upsertSkill('deploy-vps', '---\nname: deploy-vps\ndescription: Deploy with Docker Compose\n---\n# Deploy\nRun docker compose up -d.');

    const results = vault.search('Cloudflared');
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].projectSlug).toBe('search-proj');

    const skillResults = vault.search('Docker Compose');
    expect(skillResults.some((r) => r.type === 'skill')).toBe(true);
  });

  it('redacts sensitive secrets when storing MCP servers', () => {
    const res = vault.upsertMcpServer({
      name: 'github',
      transport: 'stdio',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-github'],
      env: {
        GITHUB_TOKEN: 'ghp_1234567890abcdefghij1234567890',
        LOG_LEVEL: 'info',
      },
    });
    expect(res.redactedKeys).toContain('GITHUB_TOKEN');
    expect(res.entry.env?.GITHUB_TOKEN).toBe('${GITHUB_TOKEN}');
    expect(res.entry.env?.LOG_LEVEL).toBe('info');

    const direct = redactEnvRecord({ API_KEY: '${API_KEY}' });
    expect(direct.redactedKeys).toHaveLength(0);
  });

  it('builds tailored context packs for Claude Chat and Gemini Web', () => {
    vault.upsertProject('colab', { name: 'Agent Colab', content: 'Central hub.' });
    vault.createNote({
      projectSlug: 'colab',
      authorAgent: 'antigravity',
      title: 'Core ready',
      summary: 'Vault engine finished.',
      nextSteps: ['Connect Hermes'],
    });

    const claudePack = buildContextPack(vault, { projectSlug: 'colab', target: 'claude' });
    expect(claudePack).toContain('Claude Chat');
    expect(claudePack).toContain('Core ready');

    const geminiPack = buildContextPack(vault, { projectSlug: 'colab', target: 'gemini' });
    expect(geminiPack).toContain('Gemini Gems');
    expect(geminiPack).toContain('Connect Hermes');
  });

  it('supports multi-persona profiles for multi-profile agents and devices', () => {
    const work = vault.upsertPersona('work', '# Work Persona\nUse strict PR reviews.');
    expect(work.name).toBe('work');
    vault.upsertPersona('personal', '# Personal Persona\nKeep it casual.');

    expect(vault.listPersonas().map((p) => p.name)).toEqual(['personal', 'work']);
    expect(vault.getPersona('work')?.content).toContain('strict PR reviews');

    expect(vault.deletePersona('personal')).toBe(true);
    expect(vault.listPersonas()).toHaveLength(1);
  });

  it('syncs SKILL.md folders universally across any local directory', () => {
    const srcDir = path.join(tmpDir, 'agent-a-skills');
    const dstDir = path.join(tmpDir, 'agent-b-skills');
    fs.mkdirSync(path.join(srcDir, 'my-skill'), { recursive: true });
    fs.writeFileSync(
      path.join(srcDir, 'my-skill', 'SKILL.md'),
      '---\nname: my-skill\ndescription: Universal skill\n---\n# Body\n',
      'utf8'
    );

    const imported = syncSkillsDirectory(vault, srcDir, 'import');
    expect(imported.actions).toHaveLength(1);
    expect(vault.listSkills()).toHaveLength(1);

    const exported = syncSkillsDirectory(vault, dstDir, 'export');
    expect(exported.actions).toHaveLength(1);
    expect(fs.existsSync(path.join(dstDir, 'my-skill', 'SKILL.md'))).toBe(true);
  });

  it('encrypts credentials with AES-256-GCM at rest and decrypts on demand', () => {
    const saved = vault.upsertCredential({
      name: 'instabox',
      value: 'ibk_test_secret_token_9876543210',
      service: 'InstaBox',
      envVar: 'INSTABOX_API_KEY',
      tags: ['infra'],
      addedBy: 'antigravity@pc',
    });
    expect(saved.maskedValue).toBe('ibk_••••3210');
    expect(saved.allowAgentRead).toBe(true);

    // Raw file on disk must NOT contain the plaintext secret
    const encFile = fs.readFileSync(path.join(tmpDir, '.secrets', 'credentials.enc.json'), 'utf8');
    expect(encFile).not.toContain('ibk_test_secret_token_9876543210');

    // Decrypted retrieval returns exact value
    const revealed = vault.getCredential('instabox');
    expect(revealed?.value).toBe('ibk_test_secret_token_9876543210');

    expect(vault.deleteCredential('instabox')).toBe(true);
    expect(vault.getCredential('instabox')).toBeNull();
  });
});
