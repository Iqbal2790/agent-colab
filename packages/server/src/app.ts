import fs from 'node:fs';
import path from 'node:path';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { serveStatic } from '@hono/node-server/serve-static';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {
  buildContextPack,
  type CodingAccessMode,
  type TaskPriority,
  type TaskStatus,
  type VaultManager,
} from '@agent-colab/core';
import {
  createAdapters,
  type AdapterRegistryOptions,
  type AgentAdapterId,
} from '@agent-colab/adapters';
import type { TunnelManager, TunnelProvider, TunnelScope } from '@agent-colab/tunnel';
import { createMcpServer } from './mcp.js';

export interface CreateAppOptions {
  vault: VaultManager;
  tunnel: TunnelManager;
  port: number;
  staticDir?: string;
  adapterOptions?: AdapterRegistryOptions;
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
  const { vault, tunnel, port, staticDir, adapterOptions } = options;
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

  // --- MCP Streamable HTTP Endpoint (/mcp) ---
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

    const mcpServer = createMcpServer(vault, {
      readOnly,
      via: viaTunnel ? 'tunnel' : 'mcp',
    });

    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });

    await mcpServer.connect(transport);

    // Bridge Hono Request -> Node IncomingMessage/ServerResponse via Web-compatible handling
    // Note: Hono's @hono/node-server exposes raw req/res on c.env.incoming / c.env.outgoing
    const env = c.env as { incoming?: unknown; outgoing?: unknown } | undefined;
    if (env?.incoming && env?.outgoing) {
      let body: unknown = undefined;
      if (c.req.method === 'POST') {
        try {
          body = await c.req.json();
        } catch {
          body = undefined;
        }
      }
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
      readOnly,
      hint: 'Connect using an MCP Streamable HTTP client.',
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

  // Profile & Global Rules
  app.get('/api/profile', (c) => {
    return c.json({
      profile: vault.getUserProfile(),
      rules: vault.getGlobalRules(),
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

  // Adapters & Sync (Antigravity & Hermes)
  app.get('/api/adapters', (c) => {
    const adapters = createAdapters(adapterOptions);
    return c.json({
      adapters: Object.values(adapters).map((a) => a.detect()),
    });
  });

  app.post('/api/sync', async (c) => {
    const body = (await c.req.json()) as {
      agent: AgentAdapterId;
      direction: 'import' | 'export';
      dryRun?: boolean;
    };
    const adapters = createAdapters(adapterOptions);
    const adapter = adapters[body.agent];
    if (!adapter) return c.json({ error: `Unknown agent adapter: ${body.agent}` }, 400);

    const result =
      body.direction === 'import'
        ? adapter.importToVault(vault, { dryRun: body.dryRun })
        : adapter.exportFromVault(vault, { dryRun: body.dryRun });

    if (!body.dryRun) {
      vault.logAudit({
        actor: 'user',
        action: `sync_${body.direction}`,
        resource: `adapter:${body.agent}`,
        via: 'web',
        details: `${result.actions.length} item(s)`,
      });
    }
    return c.json(result);
  });

  app.post('/api/connect', async (c) => {
    const body = (await c.req.json()) as {
      agent: AgentAdapterId;
      mode?: 'stdio' | 'http';
      serverUrl?: string;
      dryRun?: boolean;
    };
    const adapters = createAdapters(adapterOptions);
    const adapter = adapters[body.agent];
    if (!adapter) return c.json({ error: `Unknown agent adapter: ${body.agent}` }, 400);

    const result = adapter.connectAgentColab({
      mode: body.mode ?? 'http',
      serverUrl: body.serverUrl ?? `http://127.0.0.1:${port}/mcp`,
      vaultPath: vault.vaultPath,
      dryRun: body.dryRun,
    });
    return c.json(result);
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
