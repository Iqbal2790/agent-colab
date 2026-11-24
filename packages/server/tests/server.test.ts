import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { VaultManager } from '@agent-colab/core';
import { TunnelManager } from '@agent-colab/tunnel';
import { createApp } from '../src/index.js';

describe('@agent-colab/server', () => {
  let tmpDir: string;
  let vault: VaultManager;
  let tunnel: TunnelManager;
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-colab-server-'));
    vault = new VaultManager(tmpDir);
    vault.init();
    tunnel = new TunnelManager();
    app = createApp({ vault, tunnel, port: 4242 });
  });

  afterEach(() => {
    tunnel.stop();
    vault.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('serves health, project CRUD, handoff notes, and Claude/Gemini export over private API', async () => {
    const health = await app.request('/api/health');
    expect(health.status).toBe(200);
    const healthJson = await health.json();
    expect(healthJson.ok).toBe(true);

    // Create project
    const putProj = await app.request('/api/projects/web-app', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Web App',
        status: 'active',
        content: 'Next-gen centralized agent workspace.',
      }),
    });
    expect(putProj.status).toBe(200);

    // Create handoff note
    const postNote = await app.request('/api/notes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        projectSlug: 'web-app',
        authorAgent: 'antigravity',
        title: 'API endpoints ready',
        summary: 'All REST routes implemented.',
        nextSteps: ['Build React dashboard'],
      }),
    });
    expect(postNote.status).toBe(201);

    // Export for Gemini Web
    const exportRes = await app.request('/api/export?target=gemini&project=web-app');
    expect(exportRes.status).toBe(200);
    const exportJson = await exportRes.json();
    expect(exportJson.markdown).toContain('Gemini Gems');
    expect(exportJson.markdown).toContain('API endpoints ready');
  });

  it('blocks /api/* over public tunnel and serves /share/:token/context.md only with valid token', async () => {
    vault.upsertProject('secret-proj', { name: 'Secret Proj', content: 'Private context.' });

    // Start mock tunnel
    const startRes = await app.request('/api/tunnel/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider: 'mock', scope: 'read-only', ttlMinutes: 10 }),
    });
    expect(startRes.status).toBe(200);
    const tunnelInfo = await startRes.json();
    expect(tunnelInfo.active).toBe(true);

    // Management API must be blocked when cf-connecting-ip header is present
    const blockedApi = await app.request('/api/projects', {
      headers: { 'cf-connecting-ip': '203.0.113.10' },
    });
    expect(blockedApi.status).toBe(403);

    // Share link with invalid token -> 401
    const badShare = await app.request('/share/invalid-token/context.md?project=secret-proj');
    expect(badShare.status).toBe(401);

    // Share link with valid token -> 200 Markdown
    const okShare = await app.request(
      `/share/${tunnelInfo.token}/context.md?project=secret-proj&target=gemini`
    );
    expect(okShare.status).toBe(200);
    const md = await okShare.text();
    expect(md).toContain('Secret Proj');

    // Stop tunnel -> token immediately invalid
    await app.request('/api/tunnel/stop', { method: 'POST' });
    const expiredShare = await app.request(
      `/share/${tunnelInfo.token}/context.md?project=secret-proj`
    );
    expect(expiredShare.status).toBe(401);
  });
});
