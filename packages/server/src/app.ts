import fs from 'node:fs';
import path from 'node:path';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { serveStatic } from '@hono/node-server/serve-static';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {
  buildContextPack,
  syncSkillsDirectory,
  type CodingAccessMode,
  type TaskPriority,
  type TaskStatus,
  type VaultManager,
} from '@agent-colab/core';
import type { TunnelManager, TunnelProvider, TunnelScope } from '@agent-colab/tunnel';
import { createMcpServer } from './mcp.js';

export interface CreateAppOptions {
  vault: VaultManager;
  tunnel: TunnelManager;
  port: number;
  staticDir?: string;
}

function isTunneledRequest(headers: Headers): boolean {
  const cfIp = headers.get('cf-connecting-ip');
  const forwardedHost = headers.get('x-forwarded-host') ?? '';
  const host = headers.get('host') ?? '';
  return Boolean(
    cfIp ||
      forwardedHost.includes('trycloudflare.com') ||
      host.includes('trycloudflare.com')
  );
}

function extractToken(headers: Headers, queryToken?: string): string | undefined {
  const auth = headers.get('authorization');
  if (auth && auth.toLowerCase().startsWith('bearer ')) {
    return auth.slice(7).trim();
  }
  return queryToken;
}

export function createApp(options: CreateAppOptions): Hono {
  const { vault, tunnel, port, staticDir } = options;
  const app = new Hono();

  app.use('*', cors());

  // Security guard: block management /api/* endpoints when accessed through public tunnel
  app.use('/api/*', async (c, next) => {
    if (isTunneledRequest(c.req.raw.headers)) {
      vault.logAudit({
        actor: 'public-tunnel',
        action: 'blocked_api_access',
        resource: c.req.path,
        via: 'tunnel',
      });
      return c.json(
        { error: 'Management API is private-network only. Use /mcp or /share/:token over the tunnel.' },
        403
      );
    }
    await next();
  });

  // --- Ephemeral Read-Only Share Link (for Gemini Web / Claude Chat) ---
  app.get('/share/:token/context.md', (c) => {
    const token = c.req.param('token');
    if (!tunnel.validateToken(token, 'read-only')) {
      return c.text('Unauthorized or expired share token.', 401);
    }
    const projectSlug = c.req.query('project') || undefined;
    const target = (c.req.query('target') as 'claude' | 'gemini' | 'generic') || 'gemini';
    const includeSkills = c.req.query('skills') !== '0';

    vault.logAudit({
      actor: 'web-ai-share',
      action: 'read_context_pack',
      resource: projectSlug ? `project:${projectSlug}` : 'all-projects',
      via: 'tunnel',
    });

    const pack = buildContextPack(vault, { projectSlug, target, includeSkills });
    return c.text(pack, 200, { 'Content-Type': 'text/markdown; charset=utf-8' });
  });

  // --- Universal MCP Streamable HTTP Endpoint (/mcp) with Auto-Client Detection ---
  app.all('/mcp', async (c) => {
    const viaTunnel = isTunneledRequest(c.req.raw.headers);
    let readOnly = false;

    if (viaTunnel) {
      const token = extractToken(c.req.raw.headers, c.req.query('token'));
      if (!tunnel.validateToken(token, 'read-only')) {
        return c.json({ error: 'Unauthorized: valid ephemeral tunnel token required.' }, 401);
      }
      readOnly = !tunnel.validateToken(token, 'read-write');
    }

    let body: unknown = undefined;
    if (c.req.method === 'POST') {
      try {
        body = await c.req.json();
      } catch {
        body = undefined;
      }
    }

    // Auto-detect connecting client from MCP initialize handshake (clientInfo) or query/headers
    const rpcBody = body as
      | { method?: string; params?: { clientInfo?: { name?: string; version?: string } } }
      | undefined;
    const handshakeName = rpcBody?.params?.clientInfo?.name?.trim();
    const handshakeVersion = rpcBody?.params?.clientInfo?.version?.trim();
    const explicitAgent =
      c.req.query('agent') || c.req.header('x-agent-identity') || undefined;
    const persona =
      c.req.query('persona') || c.req.header('x-agent-persona') || undefined;
    const tagsRaw = c.req.query('tags') || c.req.header('x-agent-tags') || '';
    const allowedTags = tagsRaw
      ? tagsRaw.split(',').map((t) => t.trim()).filter(Boolean)
      : undefined;

    const detectedName = handshakeName || explicitAgent || 'mcp-client';
    const agentId = explicitAgent || handshakeName || undefined;

    // Only register/update connected_agents when we have an explicit ?agent= identity
    // or a real MCP initialize handshake (params.clientInfo.name) — never create ghost
    // entries from generic HTTP User-Agent headers like "curl", "node", or "undici" on
    // follow-up tools/list or tools/call requests.
    if (agentId) {
      vault.recordConnectedAgent({
        id: agentId,
        clientName: handshakeName || explicitAgent || detectedName,
        clientVersion: handshakeVersion,
        persona,
        tagScope: allowedTags ? allowedTags.join(', ') : undefined,
        via: viaTunnel ? 'tunnel' : 'mcp',
      });
    }

    const mcpServer = createMcpServer(vault, {
      readOnly,
      via: viaTunnel ? 'tunnel' : 'mcp',
      defaultAgent: agentId ?? 'mcp-client',
      persona,
      allowedTags,
    });

    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });

    await mcpServer.connect(transport);

    const env = c.env as { incoming?: unknown; outgoing?: unknown } | undefined;
    if (env?.incoming && env?.outgoing) {
      await transport.handleRequest(
        env.incoming as Parameters<typeof transport.handleRequest>[0],
        env.outgoing as Parameters<typeof transport.handleRequest>[1],
        body
      );
      return c.body(null);
    }

    return c.json({
      name: 'agent-colab-mcp',
      status: 'ready',
      detectedClient: agentId,
      readOnly,
      hint: 'Connect any MCP-compatible AI agent to this universal Streamable HTTP endpoint.',
    });
  });

  // --- REST API (Private Network Only) ---

  app.get('/api/health', (c) => {
    return c.json({
      ok: true,
      name: 'agent-colab',
      version: '0.1.0',
      vaultPath: vault.vaultPath,
      tunnelActive: tunnel.getStatus().active,
    });
  });

  // Profile, Global Rules & Multi-Persona Profiles
  app.get('/api/profile', (c) => {
    return c.json({
      profile: vault.getUserProfile(),
      rules: vault.getGlobalRules(),
      personas: vault.listPersonas(),
    });
  });

  app.put('/api/profile', async (c) => {
    const body = (await c.req.json()) as { content?: string; rules?: string };
    const profile =
      body.content !== undefined ? vault.updateUserProfile(body.content) : vault.getUserProfile();
    const rules =
      body.rules !== undefined ? vault.updateGlobalRules(body.rules) : vault.getGlobalRules();
    vault.logAudit({ actor: 'user', action: 'update_profile', resource: 'profile', via: 'web' });
    return c.json({ profile, rules });
  });

  app.get('/api/personas', (c) => c.json({ personas: vault.listPersonas() }));

  app.put('/api/personas/:name', async (c) => {
    const name = c.req.param('name');
    const body = (await c.req.json()) as { content: string };
    const persona = vault.upsertPersona(name, body.content ?? '');
    vault.logAudit({ actor: 'user', action: 'upsert_persona', resource: `persona:${persona.name}`, via: 'web' });
    return c.json({ persona });
  });

  app.delete('/api/personas/:name', (c) => {
    const deleted = vault.deletePersona(c.req.param('name'));
    return c.json({ deleted });
  });

  // Projects
  app.get('/api/projects', (c) => c.json({ projects: vault.listProjects() }));

  app.get('/api/projects/:slug', (c) => {
    const slug = c.req.param('slug');
    const project = vault.getProject(slug);
    if (!project) return c.json({ error: 'Project not found' }, 404);
    return c.json({
      project,
      tasks: vault.listTasks(slug),
      notes: vault.listNotes(slug, 30),
    });
  });

  app.put('/api/projects/:slug', async (c) => {
    const slug = c.req.param('slug');
    const body = (await c.req.json()) as {
      name?: string;
      status?: string;
      tags?: string[];
      repoPath?: string;
      codingAccess?: CodingAccessMode;
      content: string;
    };
    const project = vault.upsertProject(slug, body);
    vault.logAudit({ actor: 'user', action: 'upsert_project', resource: `project:${slug}`, via: 'web' });
    return c.json({ project });
  });

  app.post('/api/projects/:slug/decisions', async (c) => {
    const slug = c.req.param('slug');
    const body = (await c.req.json()) as { title: string; rationale: string; authorAgent?: string };
    try {
      const project = vault.appendDecision(
        slug,
        body.title,
        body.rationale,
        body.authorAgent ?? 'user'
      );
      return c.json({ project });
    } catch (err) {
      return c.json({ error: (err as Error).message }, 404);
    }
  });

  // Tasks
  app.get('/api/tasks', (c) => {
    const projectSlug = c.req.query('project') || undefined;
    const status = (c.req.query('status') as TaskStatus) || undefined;
    return c.json({ tasks: vault.listTasks(projectSlug, status) });
  });

  app.post('/api/tasks', async (c) => {
    const body = (await c.req.json()) as {
      projectSlug: string;
      title: string;
      priority?: TaskPriority;
      body?: string;
      createdBy?: string;
    };
    try {
      const task = vault.createTask(body);
      vault.logAudit({
        actor: body.createdBy ?? 'user',
        action: 'create_task',
        resource: `task:${task.projectSlug}/${task.id}`,
        via: 'web',
      });
      return c.json({ task }, 201);
    } catch (err) {
      return c.json({ error: (err as Error).message }, 400);
    }
  });

  app.post('/api/tasks/:projectSlug/:taskId/claim', async (c) => {
    const { projectSlug, taskId } = c.req.param();
    const body = (await c.req.json()) as { agentName: string; lockMinutes?: number };
    try {
      const task = vault.claimTask(projectSlug, taskId, body.agentName, body.lockMinutes);
      return c.json({ task });
    } catch (err) {
      return c.json({ error: (err as Error).message }, 409);
    }
  });

  app.patch('/api/tasks/:projectSlug/:taskId', async (c) => {
    const { projectSlug, taskId } = c.req.param();
    const body = (await c.req.json()) as {
      title?: string;
      status?: TaskStatus;
      priority?: TaskPriority;
      body?: string;
      releaseLock?: boolean;
    };
    try {
      const task = vault.updateTask(projectSlug, taskId, body);
      return c.json({ task });
    } catch (err) {
      return c.json({ error: (err as Error).message }, 404);
    }
  });

  // Handoff Notes
  app.get('/api/notes', (c) => {
    const projectSlug = c.req.query('project') || undefined;
    const limit = Number(c.req.query('limit') ?? 30);
    return c.json({ notes: vault.listNotes(projectSlug, limit) });
  });

  app.post('/api/notes', async (c) => {
    const body = (await c.req.json()) as {
      projectSlug: string;
      authorAgent: string;
      title: string;
      summary: string;
      nextSteps?: string[];
      relatedTaskId?: string;
      body?: string;
    };
    try {
      const note = vault.createNote(body);
      vault.logAudit({
        actor: body.authorAgent,
        action: 'leave_handoff_note',
        resource: `note:${note.projectSlug}/${note.id}`,
        via: 'web',
      });
      return c.json({ note }, 201);
    } catch (err) {
      return c.json({ error: (err as Error).message }, 400);
    }
  });

  // Skills & MCP Registry
  app.get('/api/skills', (c) => c.json({ skills: vault.listSkills() }));

  app.put('/api/skills/:name', async (c) => {
    const name = c.req.param('name');
    const body = (await c.req.json()) as { content: string; sourceAgent?: string };
    const skill = vault.upsertSkill(name, body.content, body.sourceAgent);
    return c.json({ skill });
  });

  app.delete('/api/skills/:name', (c) => {
    const deleted = vault.deleteSkill(c.req.param('name'));
    return c.json({ deleted });
  });

  app.get('/api/mcp-registry', (c) => c.json({ servers: vault.getMcpRegistry() }));

  // Search & Audit
  app.get('/api/search', (c) => {
    const q = c.req.query('q') ?? '';
    const limit = Number(c.req.query('limit') ?? 20);
    return c.json({ results: vault.search(q, limit) });
  });

  app.get('/api/audit', (c) => {
    const limit = Number(c.req.query('limit') ?? 50);
    return c.json({ logs: vault.getAuditLogs(limit) });
  });

  // Encrypted Credentials Vault (Private Network Only)
  app.get('/api/credentials', (c) => {
    return c.json({ credentials: vault.listCredentials() });
  });

  app.get('/api/credentials/:name/reveal', (c) => {
    const name = c.req.param('name');
    const cred = vault.getCredential(name);
    if (!cred) return c.json({ error: 'Credential not found' }, 404);
    vault.logAudit({
      actor: 'user',
      action: 'reveal_credential',
      resource: `credential:${cred.name}`,
      via: 'web',
    });
    return c.json({ credential: cred });
  });

  app.put('/api/credentials/:name', async (c) => {
    const name = c.req.param('name');
    const body = (await c.req.json()) as {
      value?: string;
      service?: string;
      envVar?: string;
      tags?: string[];
      allowAgentRead?: boolean;
      notes?: string;
    };
    try {
      const credential = vault.upsertCredential({
        name,
        ...body,
        addedBy: 'user',
      });
      vault.logAudit({
        actor: 'user',
        action: 'upsert_credential',
        resource: `credential:${credential.name}`,
        via: 'web',
      });
      return c.json({ credential });
    } catch (err) {
      return c.json({ error: (err as Error).message }, 400);
    }
  });

  app.delete('/api/credentials/:name', (c) => {
    const name = c.req.param('name');
    const deleted = vault.deleteCredential(name);
    if (deleted) {
      vault.logAudit({
        actor: 'user',
        action: 'delete_credential',
        resource: `credential:${name}`,
        via: 'web',
      });
    }
    return c.json({ deleted });
  });

  // Auto-Detected Connected Agents Registry & Generic Local Skills Sync
  app.get('/api/agents', (c) => {
    return c.json({ agents: vault.listConnectedAgents() });
  });

  app.delete('/api/agents/:id', (c) => {
    const id = decodeURIComponent(c.req.param('id'));
    const deleted = vault.removeConnectedAgent(id);
    return c.json({ deleted });
  });

  app.post('/api/skills/sync-dir', async (c) => {
    const body = (await c.req.json()) as {
      dir: string;
      direction: 'import' | 'export';
      dryRun?: boolean;
    };
    if (!body.dir?.trim()) {
      return c.json({ error: 'Skills directory path is required.' }, 400);
    }
    try {
      const result = syncSkillsDirectory(vault, body.dir, body.direction, {
        dryRun: body.dryRun,
      });
      if (!body.dryRun) {
        vault.logAudit({
          actor: 'user',
          action: `skills_${body.direction}`,
          resource: result.directory,
          via: 'web',
          details: `${result.actions.length} skill(s)`,
        });
      }
      return c.json(result);
    } catch (err) {
      return c.json({ error: (err as Error).message }, 400);
    }
  });

  // On-Demand Public Tunnel
  app.get('/api/tunnel', (c) => c.json(tunnel.getStatus()));

  app.post('/api/tunnel/start', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as {
      ttlMinutes?: number;
      scope?: TunnelScope;
      provider?: TunnelProvider;
    };
    try {
      const status = await tunnel.start({
        localPort: port,
        ttlMinutes: body.ttlMinutes ?? 30,
        scope: body.scope ?? 'read-only',
        provider: body.provider ?? 'cloudflared',
      });
      vault.logAudit({
        actor: 'user',
        action: 'tunnel_start',
        resource: status.publicUrl ?? 'tunnel',
        via: 'web',
        details: `scope=${status.scope}, expires=${status.expiresAt}`,
      });
      return c.json(status);
    } catch (err) {
      return c.json({ error: (err as Error).message }, 500);
    }
  });

  app.post('/api/tunnel/stop', (c) => {
    const status = tunnel.stop();
    vault.logAudit({ actor: 'user', action: 'tunnel_stop', resource: 'tunnel', via: 'web' });
    return c.json(status);
  });

  // Non-Agentic Web AI Bridge Export (Claude Chat & Gemini Web)
  app.get('/api/export', (c) => {
    const target = (c.req.query('target') as 'claude' | 'gemini' | 'generic') || 'claude';
    const projectSlug = c.req.query('project') || undefined;
    const includeSkills = c.req.query('skills') !== '0';
    const markdown = buildContextPack(vault, { projectSlug, target, includeSkills });
    return c.json({ target, projectSlug, markdown });
  });

  // Serve Web Dashboard static files if built
  if (staticDir && fs.existsSync(staticDir)) {
    app.use('/*', serveStatic({ root: staticDir }));
    app.get('*', (c) => {
      const indexHtml = path.join(staticDir, 'index.html');
      if (fs.existsSync(indexHtml)) {
        return c.html(fs.readFileSync(indexHtml, 'utf8'));
      }
      return c.notFound();
    });
  }

  return app;
}
