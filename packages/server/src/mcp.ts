import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import {
  deleteWorkspaceFile,
  editWorkspaceFile,
  getWorkspaceGitDiff,
  getWorkspaceGitStatus,
  listWorkspaceFiles,
  readWorkspaceFile,
  runWorkspaceCommand,
  searchWorkspaceCode,
  writeWorkspaceFile,
  type VaultManager,
} from '@agent-colab/core';

export interface CreateMcpOptions {
  readOnly?: boolean;
  via?: 'mcp' | 'tunnel';
  /** Default agent+device identity, e.g. "antigravity@laptop" or "hermes:work@vps" */
  defaultAgent?: string;
  /** Optional persona profile name to include in get_user_profile, e.g. "work" or "personal" */
  persona?: string;
  /** Optional tag allowlist to scope projects/tasks/notes/search, e.g. ["work"] */
  allowedTags?: string[];
}

function textResult(data: unknown) {
  return {
    content: [
      {
        type: 'text' as const,
        text: typeof data === 'string' ? data : JSON.stringify(data, null, 2),
      },
    ],
  };
}

function errorResult(message: string) {
  return {
    isError: true,
    content: [{ type: 'text' as const, text: message }],
  };
}

export function createMcpServer(vault: VaultManager, options?: CreateMcpOptions): McpServer {
  const readOnly = options?.readOnly ?? false;
  const via = options?.via ?? 'mcp';
  const defaultAgent = options?.defaultAgent?.trim() || 'mcp-client';
  const activePersona = options?.persona?.trim() || undefined;
  const allowedTags =
    options?.allowedTags && options.allowedTags.length > 0
      ? options.allowedTags.map((t) => t.trim().toLowerCase()).filter(Boolean)
      : undefined;

  function resolveActor(agentName?: string): string {
    const cleaned = agentName?.trim();
    if (!cleaned || cleaned === 'unknown-agent') return defaultAgent;
    // If connection carries a device suffix (e.g. antigravity@laptop) and caller only sent "antigravity", preserve device identity
    if (defaultAgent.includes('@') && !cleaned.includes('@') && defaultAgent.startsWith(cleaned)) {
      return defaultAgent;
    }
    return cleaned;
  }

  function isProjectAllowed(tags: string[]): boolean {
    if (!allowedTags || allowedTags.length === 0) return true;
    const lowered = new Set(tags.map((t) => t.toLowerCase()));
    return allowedTags.some((t) => lowered.has(t));
  }

  function assertProjectAllowed(projectSlug: string): void {
    if (!allowedTags) return;
    const proj = vault.getProject(projectSlug);
    if (!proj) throw new Error(`Project "${projectSlug}" not found.`);
    if (!isProjectAllowed(proj.tags)) {
      throw new Error(
        `Access denied: project "${projectSlug}" is outside this connection's tag scope (${allowedTags.join(', ')}).`
      );
    }
  }

  const server = new McpServer({
    name: 'agent-colab',
    version: '0.1.0',
  });

  server.tool(
    'get_user_profile',
    'Read the user profile, working preferences, global agent rules, and active persona (if configured for this device/profile).',
    {
      persona: z.string().optional().describe('Optional persona name override, e.g. "work" or "personal"'),
    },
    async ({ persona }) => {
      const targetPersona = persona?.trim() || activePersona;
      const personaDoc = targetPersona ? vault.getPersona(targetPersona) : null;
      vault.logAudit({ actor: defaultAgent, action: 'read', resource: 'profile', via });
      return textResult({
        identity: defaultAgent,
        tagScope: allowedTags ?? 'all',
        profile: vault.getUserProfile(),
        globalRules: vault.getGlobalRules(),
        ...(personaDoc ? { persona: personaDoc } : {}),
        availablePersonas: vault.listPersonas().map((p) => p.name),
      });
    }
  );

  server.tool(
    'list_projects',
    'List all projects tracked in Agent Colab (filtered by tag scope if configured on this connection).',
    {},
    async () => {
      const projects = vault.listProjects().filter((p) => isProjectAllowed(p.tags));
      return textResult(projects);
    }
  );

  server.tool(
    'get_project_context',
    'Get full context for a project: overview, technical decisions, active tasks, and recent agent handoff notes.',
    {
      projectSlug: z.string().describe('Project slug identifier, e.g. "my-app"'),
      noteLimit: z.number().int().min(1).max(30).optional().default(5),
    },
    async ({ projectSlug, noteLimit }) => {
      const project = vault.getProject(projectSlug);
      if (!project) return errorResult(`Project "${projectSlug}" not found.`);
      if (!isProjectAllowed(project.tags)) {
        return errorResult(
          `Access denied: project "${projectSlug}" is outside this connection's tag scope (${allowedTags?.join(', ')}).`
        );
      }
      vault.logAudit({ actor: defaultAgent, action: 'read', resource: `project:${projectSlug}`, via });
      return textResult({
        project,
        tasks: vault.listTasks(projectSlug),
        recentNotes: vault.listNotes(projectSlug, noteLimit),
      });
    }
  );

  server.tool(
    'update_project_context',
    'Create or update a project context document in the shared Vault.',
    {
      projectSlug: z.string(),
      name: z.string().optional(),
      status: z.string().optional(),
      tags: z.array(z.string()).optional(),
      repoPath: z.string().optional(),
      content: z.string().describe('Markdown summary of project architecture, goals, and current status'),
      agentName: z.string().optional(),
    },
    async ({ projectSlug, name, status, tags, repoPath, content, agentName }) => {
      if (readOnly) return errorResult('Forbidden: current connection is read-only.');
      const existing = vault.getProject(projectSlug);
      if (existing && !isProjectAllowed(existing.tags)) {
        return errorResult(`Access denied: project "${projectSlug}" is outside your tag scope.`);
      }
      const mergedTags =
        tags ?? (existing ? existing.tags : allowedTags ? [...allowedTags] : []);
      const actor = resolveActor(agentName);
      const updated = vault.upsertProject(projectSlug, {
        name,
        status,
        tags: mergedTags,
        repoPath,
        content,
      });
      vault.logAudit({ actor, action: 'update_project', resource: `project:${projectSlug}`, via });
      return textResult(updated);
    }
  );

  server.tool(
    'append_decision',
    'Record an architectural or technical decision in the project decisions log.',
    {
      projectSlug: z.string(),
      title: z.string(),
      rationale: z.string(),
      agentName: z.string().optional(),
    },
    async ({ projectSlug, title, rationale, agentName }) => {
      if (readOnly) return errorResult('Forbidden: current connection is read-only.');
      try {
        assertProjectAllowed(projectSlug);
        const actor = resolveActor(agentName);
        const updated = vault.appendDecision(projectSlug, title, rationale, actor);
        vault.logAudit({ actor, action: 'append_decision', resource: `project:${projectSlug}`, via });
        return textResult({ ok: true, projectSlug: updated.slug, decisionTitle: title, recordedBy: actor });
      } catch (err) {
        return errorResult((err as Error).message);
      }
    }
  );

  server.tool(
    'list_tasks',
    'List tasks across all accessible projects or for a specific project, optionally filtered by status.',
    {
      projectSlug: z.string().optional(),
      status: z.enum(['todo', 'in_progress', 'handoff', 'blocked', 'done']).optional(),
    },
    async ({ projectSlug, status }) => {
      try {
        if (projectSlug) assertProjectAllowed(projectSlug);
        const allowedSlugs = new Set(
          vault.listProjects().filter((p) => isProjectAllowed(p.tags)).map((p) => p.slug)
        );
        const tasks = vault
          .listTasks(projectSlug, status)
          .filter((t) => allowedSlugs.has(t.projectSlug));
        return textResult(tasks);
      } catch (err) {
        return errorResult((err as Error).message);
      }
    }
  );

  server.tool(
    'create_task',
    'Create a new collaborative task under a project.',
    {
      projectSlug: z.string(),
      title: z.string(),
      priority: z.enum(['low', 'medium', 'high', 'urgent']).optional(),
      body: z.string().optional(),
      agentName: z.string().optional(),
    },
    async ({ projectSlug, title, priority, body, agentName }) => {
      if (readOnly) return errorResult('Forbidden: current connection is read-only.');
      try {
        assertProjectAllowed(projectSlug);
        const actor = resolveActor(agentName);
        const task = vault.createTask({
          projectSlug,
          title,
          priority,
          body,
          createdBy: actor,
        });
        vault.logAudit({ actor, action: 'create_task', resource: `task:${projectSlug}/${task.id}`, via });
        return textResult(task);
      } catch (err) {
        return errorResult((err as Error).message);
      }
    }
  );

  server.tool(
    'claim_task',
    'Claim and lock a task so other agents/devices know you are actively working on it.',
    {
      projectSlug: z.string(),
      taskId: z.string(),
      agentName: z.string().optional().describe('Optional agent@device identifier (defaults to connection identity)'),
      lockMinutes: z.number().int().min(5).max(240).optional().default(30),
    },
    async ({ projectSlug, taskId, agentName, lockMinutes }) => {
      if (readOnly) return errorResult('Forbidden: current connection is read-only.');
      try {
        assertProjectAllowed(projectSlug);
        const actor = resolveActor(agentName);
        const task = vault.claimTask(projectSlug, taskId, actor, lockMinutes);
        vault.logAudit({ actor, action: 'claim_task', resource: `task:${projectSlug}/${taskId}`, via });
        return textResult(task);
      } catch (err) {
        return errorResult((err as Error).message);
      }
    }
  );

  server.tool(
    'update_task',
    'Update task status, details, or release a lock (setting status to "handoff" or "done" automatically releases the lock).',
    {
      projectSlug: z.string(),
      taskId: z.string(),
      status: z.enum(['todo', 'in_progress', 'handoff', 'blocked', 'done']).optional(),
      priority: z.enum(['low', 'medium', 'high', 'urgent']).optional(),
      body: z.string().optional(),
      releaseLock: z.boolean().optional(),
      agentName: z.string().optional(),
    },
    async ({ projectSlug, taskId, status, priority, body, releaseLock, agentName }) => {
      if (readOnly) return errorResult('Forbidden: current connection is read-only.');
      try {
        assertProjectAllowed(projectSlug);
        const actor = resolveActor(agentName);
        const task = vault.updateTask(projectSlug, taskId, { status, priority, body, releaseLock });
        vault.logAudit({ actor, action: 'update_task', resource: `task:${projectSlug}/${taskId}`, via });
        return textResult(task);
      } catch (err) {
        return errorResult((err as Error).message);
      }
    }
  );

  server.tool(
    'leave_handoff_note',
    'Leave a structured handoff note for the user or the next AI agent/device picking up this project.',
    {
      projectSlug: z.string(),
      agentName: z.string().optional().describe('Optional agent@device identifier (defaults to connection identity)'),
      title: z.string(),
      summary: z.string(),
      nextSteps: z.array(z.string()).optional().default([]),
      relatedTaskId: z.string().optional(),
      body: z.string().optional(),
    },
    async ({ projectSlug, agentName, title, summary, nextSteps, relatedTaskId, body }) => {
      if (readOnly) return errorResult('Forbidden: current connection is read-only.');
      try {
        assertProjectAllowed(projectSlug);
        const actor = resolveActor(agentName);
        const note = vault.createNote({
          projectSlug,
          authorAgent: actor,
          title,
          summary,
          nextSteps,
          relatedTaskId,
          body,
        });
        vault.logAudit({ actor, action: 'leave_handoff_note', resource: `note:${projectSlug}/${note.id}`, via });
        return textResult(note);
      } catch (err) {
        return errorResult((err as Error).message);
      }
    }
  );

  server.tool(
    'read_handoff_notes',
    'Read recent handoff notes left by other agents/devices on accessible projects.',
    {
      projectSlug: z.string().optional(),
      limit: z.number().int().min(1).max(50).optional().default(10),
    },
    async ({ projectSlug, limit }) => {
      try {
        if (projectSlug) assertProjectAllowed(projectSlug);
        const allowedSlugs = new Set(
          vault.listProjects().filter((p) => isProjectAllowed(p.tags)).map((p) => p.slug)
        );
        const notes = vault
          .listNotes(projectSlug, limit)
          .filter((n) => allowedSlugs.has(n.projectSlug));
        return textResult(notes);
      } catch (err) {
        return errorResult((err as Error).message);
      }
    }
  );

  server.tool(
    'search_vault',
    'Full-text search across user profile, accessible projects, tasks, handoff notes, and skills.',
    {
      query: z.string(),
      limit: z.number().int().min(1).max(50).optional().default(15),
    },
    async ({ query, limit }) => {
      const allowedSlugs = new Set(
        vault.listProjects().filter((p) => isProjectAllowed(p.tags)).map((p) => p.slug)
      );
      const results = vault
        .search(query, limit)
        .filter((r) => !r.projectSlug || allowedSlugs.has(r.projectSlug));
      return textResult(results);
    }
  );

  server.tool(
    'list_skills',
    'List all shared skills stored in the Agent Colab Vault.',
    {},
    async () => {
      return textResult(
        vault.listSkills().map((s) => ({
          name: s.name,
          description: s.description,
          sourceAgent: s.sourceAgent,
          updatedAt: s.updatedAt,
        }))
      );
    }
  );

  server.tool(
    'get_skill',
    'Read the full SKILL.md instructions for a specific skill.',
    {
      name: z.string(),
    },
    async ({ name }) => {
      const skill = vault.getSkill(name);
      if (!skill) return errorResult(`Skill "${name}" not found.`);
      return textResult(skill);
    }
  );

  // --- Workspace Coding Tools (Gated by per-project codingAccess + tunnel scope) ---

  function resolveWorkspace(projectSlug: string, mode: 'read' | 'write'): string {
    const project = vault.getProject(projectSlug);
    if (!project) {
      throw new Error(`Project "${projectSlug}" not found.`);
    }
    if (!isProjectAllowed(project.tags)) {
      throw new Error(
        `Access denied: project "${projectSlug}" is outside this connection's tag scope (${allowedTags?.join(', ')}).`
      );
    }
    if (!project.repoPath) {
      throw new Error(
        `Project "${projectSlug}" has no repoPath configured. Set a local folder path in Agent Colab Dashboard.`
      );
    }
    if (project.codingAccess === 'disabled') {
      throw new Error(
        `Coding access is disabled for project "${projectSlug}". Grant "read-only" or "full" permission in Agent Colab Dashboard first.`
      );
    }
    if (mode === 'write') {
      if (project.codingAccess !== 'full') {
        throw new Error(
          `Project "${projectSlug}" only permits "read-only" coding access. Change it to "full" in Agent Colab Dashboard to allow edits or commands.`
        );
      }
      if (readOnly) {
        throw new Error(
          'Forbidden: current connection/tunnel is read-only. Restart the tunnel with "read-write" scope to allow edits or commands.'
        );
      }
    }
    return project.repoPath;
  }

  server.tool(
    'fs_list_files',
    'List files and directories inside a project workspace (requires codingAccess: read-only or full).',
    {
      projectSlug: z.string(),
      dirPath: z.string().optional().default(''),
      maxDepth: z.number().int().min(1).max(8).optional().default(4),
    },
    async ({ projectSlug, dirPath, maxDepth }) => {
      try {
        const repoPath = resolveWorkspace(projectSlug, 'read');
        const files = listWorkspaceFiles(repoPath, dirPath, maxDepth);
        vault.logAudit({ actor: 'mcp-client', action: 'fs_list_files', resource: `${projectSlug}/${dirPath}`, via });
        return textResult({ projectSlug, dirPath, count: files.length, files });
      } catch (err) {
        return errorResult((err as Error).message);
      }
    }
  );

  server.tool(
    'fs_read_file',
    'Read a source code file inside a project workspace with line numbers (requires codingAccess: read-only or full).',
    {
      projectSlug: z.string(),
      filePath: z.string(),
      startLine: z.number().int().min(1).optional(),
      endLine: z.number().int().min(1).optional(),
    },
    async ({ projectSlug, filePath, startLine, endLine }) => {
      try {
        const repoPath = resolveWorkspace(projectSlug, 'read');
        const result = readWorkspaceFile(repoPath, filePath, startLine, endLine);
        vault.logAudit({ actor: 'mcp-client', action: 'fs_read_file', resource: `${projectSlug}/${filePath}`, via });
        return textResult(result);
      } catch (err) {
        return errorResult((err as Error).message);
      }
    }
  );

  server.tool(
    'fs_search_code',
    'Search for a text or symbol across source files in a project workspace (requires codingAccess: read-only or full).',
    {
      projectSlug: z.string(),
      query: z.string(),
      maxResults: z.number().int().min(1).max(100).optional().default(40),
    },
    async ({ projectSlug, query, maxResults }) => {
      try {
        const repoPath = resolveWorkspace(projectSlug, 'read');
        const matches = searchWorkspaceCode(repoPath, query, maxResults);
        vault.logAudit({ actor: 'mcp-client', action: 'fs_search_code', resource: `${projectSlug}:${query}`, via });
        return textResult({ projectSlug, query, count: matches.length, matches });
      } catch (err) {
        return errorResult((err as Error).message);
      }
    }
  );

  server.tool(
    'git_status',
    'Check git branch and modified files in a project workspace (requires codingAccess: read-only or full).',
    {
      projectSlug: z.string(),
    },
    async ({ projectSlug }) => {
      try {
        const repoPath = resolveWorkspace(projectSlug, 'read');
        const status = getWorkspaceGitStatus(repoPath);
        return textResult(status || '(clean working tree)');
      } catch (err) {
        return errorResult((err as Error).message);
      }
    }
  );

  server.tool(
    'git_diff',
    'Inspect unstaged git diff in a project workspace (requires codingAccess: read-only or full).',
    {
      projectSlug: z.string(),
      filePath: z.string().optional(),
    },
    async ({ projectSlug, filePath }) => {
      try {
        const repoPath = resolveWorkspace(projectSlug, 'read');
        const diff = getWorkspaceGitDiff(repoPath, filePath);
        return textResult(diff);
      } catch (err) {
        return errorResult((err as Error).message);
      }
    }
  );

  server.tool(
    'fs_write_file',
    'Create or overwrite a file inside a project workspace (requires codingAccess: full & read-write connection).',
    {
      projectSlug: z.string(),
      filePath: z.string(),
      content: z.string(),
      agentName: z.string().optional(),
    },
    async ({ projectSlug, filePath, content, agentName }) => {
      try {
        const repoPath = resolveWorkspace(projectSlug, 'write');
        const result = writeWorkspaceFile(repoPath, filePath, content);
        vault.logAudit({ actor: resolveActor(agentName), action: 'fs_write_file', resource: `${projectSlug}/${filePath}`, via });
        return textResult(result);
      } catch (err) {
        return errorResult((err as Error).message);
      }
    }
  );

  server.tool(
    'fs_edit_file',
    'Replace an exact snippet inside a project file (requires codingAccess: full & read-write connection).',
    {
      projectSlug: z.string(),
      filePath: z.string(),
      target: z.string(),
      replacement: z.string(),
      agentName: z.string().optional(),
    },
    async ({ projectSlug, filePath, target, replacement, agentName }) => {
      try {
        const repoPath = resolveWorkspace(projectSlug, 'write');
        const result = editWorkspaceFile(repoPath, filePath, target, replacement);
        vault.logAudit({ actor: resolveActor(agentName), action: 'fs_edit_file', resource: `${projectSlug}/${filePath}`, via });
        return textResult(result);
      } catch (err) {
        return errorResult((err as Error).message);
      }
    }
  );

  server.tool(
    'fs_delete_file',
    'Delete a file inside a project workspace (requires codingAccess: full & read-write connection).',
    {
      projectSlug: z.string(),
      filePath: z.string(),
      agentName: z.string().optional(),
    },
    async ({ projectSlug, filePath, agentName }) => {
      try {
        const repoPath = resolveWorkspace(projectSlug, 'write');
        const result = deleteWorkspaceFile(repoPath, filePath);
        vault.logAudit({ actor: resolveActor(agentName), action: 'fs_delete_file', resource: `${projectSlug}/${filePath}`, via });
        return textResult(result);
      } catch (err) {
        return errorResult((err as Error).message);
      }
    }
  );

  server.tool(
    'run_project_command',
    'Run a shell command inside a project workspace directory, e.g. tests or build (requires codingAccess: full & read-write connection).',
    {
      projectSlug: z.string(),
      command: z.string(),
      timeoutMs: z.number().int().min(1000).max(120000).optional().default(30000),
      agentName: z.string().optional(),
    },
    async ({ projectSlug, command, timeoutMs, agentName }) => {
      try {
        const repoPath = resolveWorkspace(projectSlug, 'write');
        const result = runWorkspaceCommand(repoPath, command, timeoutMs);
        vault.logAudit({
          actor: resolveActor(agentName),
          action: 'run_project_command',
          resource: `${projectSlug}`,
          via,
          details: `${command} (exit=${result.exitCode})`,
        });
        return textResult(result);
      } catch (err) {
        return errorResult((err as Error).message);
      }
    }
  );

  return server;
}
