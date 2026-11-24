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

  const server = new McpServer({
    name: 'agent-colab',
    version: '0.1.0',
  });

  server.tool(
    'get_user_profile',
    'Read the user profile, working preferences, and global agent rules so you understand the user without asking them to repeat themselves.',
    {},
    async () => {
      vault.logAudit({ actor: 'mcp-client', action: 'read', resource: 'profile', via });
      return textResult({
        profile: vault.getUserProfile(),
        globalRules: vault.getGlobalRules(),
      });
    }
  );

  server.tool(
    'list_projects',
    'List all projects tracked in Agent Colab with their status, task count, and handoff note count.',
    {},
    async () => {
      return textResult(vault.listProjects());
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
      vault.logAudit({ actor: 'mcp-client', action: 'read', resource: `project:${projectSlug}`, via });
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
      agentName: z.string().default('unknown-agent'),
    },
    async ({ projectSlug, name, status, tags, repoPath, content, agentName }) => {
      if (readOnly) return errorResult('Forbidden: current connection is read-only.');
      const updated = vault.upsertProject(projectSlug, { name, status, tags, repoPath, content });
      vault.logAudit({ actor: agentName, action: 'update_project', resource: `project:${projectSlug}`, via });
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
      agentName: z.string().default('unknown-agent'),
    },
    async ({ projectSlug, title, rationale, agentName }) => {
      if (readOnly) return errorResult('Forbidden: current connection is read-only.');
      try {
        const updated = vault.appendDecision(projectSlug, title, rationale, agentName);
        vault.logAudit({ actor: agentName, action: 'append_decision', resource: `project:${projectSlug}`, via });
        return textResult({ ok: true, projectSlug: updated.slug, decisionTitle: title });
      } catch (err) {
        return errorResult((err as Error).message);
      }
    }
  );

  server.tool(
    'list_tasks',
    'List tasks across all projects or for a specific project, optionally filtered by status.',
    {
      projectSlug: z.string().optional(),
      status: z.enum(['todo', 'in_progress', 'handoff', 'blocked', 'done']).optional(),
    },
    async ({ projectSlug, status }) => {
      return textResult(vault.listTasks(projectSlug, status));
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
      agentName: z.string().default('unknown-agent'),
    },
    async ({ projectSlug, title, priority, body, agentName }) => {
      if (readOnly) return errorResult('Forbidden: current connection is read-only.');
      try {
        const task = vault.createTask({
          projectSlug,
          title,
          priority,
          body,
          createdBy: agentName,
        });
        vault.logAudit({ actor: agentName, action: 'create_task', resource: `task:${projectSlug}/${task.id}`, via });
        return textResult(task);
      } catch (err) {
        return errorResult((err as Error).message);
      }
    }
  );

  server.tool(
    'claim_task',
    'Claim and lock a task so other agents know you are actively working on it.',
    {
      projectSlug: z.string(),
      taskId: z.string(),
      agentName: z.string().describe('Your agent identifier, e.g. "antigravity" or "hermes"'),
      lockMinutes: z.number().int().min(5).max(240).optional().default(30),
    },
    async ({ projectSlug, taskId, agentName, lockMinutes }) => {
      if (readOnly) return errorResult('Forbidden: current connection is read-only.');
      try {
        const task = vault.claimTask(projectSlug, taskId, agentName, lockMinutes);
        vault.logAudit({ actor: agentName, action: 'claim_task', resource: `task:${projectSlug}/${taskId}`, via });
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
      agentName: z.string().default('unknown-agent'),
    },
    async ({ projectSlug, taskId, status, priority, body, releaseLock, agentName }) => {
      if (readOnly) return errorResult('Forbidden: current connection is read-only.');
      try {
        const task = vault.updateTask(projectSlug, taskId, { status, priority, body, releaseLock });
        vault.logAudit({ actor: agentName, action: 'update_task', resource: `task:${projectSlug}/${taskId}`, via });
        return textResult(task);
      } catch (err) {
        return errorResult((err as Error).message);
      }
    }
  );

  server.tool(
    'leave_handoff_note',
    'Leave a structured handoff note for the user or the next AI agent picking up this project.',
    {
      projectSlug: z.string(),
      agentName: z.string().describe('Your agent identifier, e.g. "antigravity", "hermes", "claude"'),
      title: z.string(),
      summary: z.string(),
      nextSteps: z.array(z.string()).optional().default([]),
      relatedTaskId: z.string().optional(),
      body: z.string().optional(),
    },
    async ({ projectSlug, agentName, title, summary, nextSteps, relatedTaskId, body }) => {
      if (readOnly) return errorResult('Forbidden: current connection is read-only.');
      try {
        const note = vault.createNote({
          projectSlug,
          authorAgent: agentName,
          title,
          summary,
          nextSteps,
          relatedTaskId,
          body,
        });
        vault.logAudit({ actor: agentName, action: 'leave_handoff_note', resource: `note:${projectSlug}/${note.id}`, via });
        return textResult(note);
      } catch (err) {
        return errorResult((err as Error).message);
      }
    }
  );

  server.tool(
    'read_handoff_notes',
    'Read recent handoff notes left by other agents on a project.',
    {
      projectSlug: z.string().optional(),
      limit: z.number().int().min(1).max(50).optional().default(10),
    },
    async ({ projectSlug, limit }) => {
      return textResult(vault.listNotes(projectSlug, limit));
    }
  );

  server.tool(
    'search_vault',
    'Full-text search across user profile, projects, tasks, handoff notes, and skills.',
    {
      query: z.string(),
      limit: z.number().int().min(1).max(50).optional().default(15),
    },
    async ({ query, limit }) => {
      return textResult(vault.search(query, limit));
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
      agentName: z.string().default('unknown-agent'),
    },
    async ({ projectSlug, filePath, content, agentName }) => {
      try {
        const repoPath = resolveWorkspace(projectSlug, 'write');
        const result = writeWorkspaceFile(repoPath, filePath, content);
        vault.logAudit({ actor: agentName, action: 'fs_write_file', resource: `${projectSlug}/${filePath}`, via });
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
      agentName: z.string().default('unknown-agent'),
    },
    async ({ projectSlug, filePath, target, replacement, agentName }) => {
      try {
        const repoPath = resolveWorkspace(projectSlug, 'write');
        const result = editWorkspaceFile(repoPath, filePath, target, replacement);
        vault.logAudit({ actor: agentName, action: 'fs_edit_file', resource: `${projectSlug}/${filePath}`, via });
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
      agentName: z.string().default('unknown-agent'),
    },
    async ({ projectSlug, filePath, agentName }) => {
      try {
        const repoPath = resolveWorkspace(projectSlug, 'write');
        const result = deleteWorkspaceFile(repoPath, filePath);
        vault.logAudit({ actor: agentName, action: 'fs_delete_file', resource: `${projectSlug}/${filePath}`, via });
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
      agentName: z.string().default('unknown-agent'),
    },
    async ({ projectSlug, command, timeoutMs, agentName }) => {
      try {
        const repoPath = resolveWorkspace(projectSlug, 'write');
        const result = runWorkspaceCommand(repoPath, command, timeoutMs);
        vault.logAudit({
          actor: agentName,
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
