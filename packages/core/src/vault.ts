import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import matter from 'gray-matter';
import yaml from 'js-yaml';
import chokidar, { type FSWatcher } from 'chokidar';
import { VaultIndexDb } from './index-db.js';
import { redactEnvRecord } from './redact.js';
import type {
  AuditEntry,
  CodingAccessMode,
  HandoffNote,
  McpServerEntry,
  ProfileDocument,
  ProjectContext,
  ProjectSummary,
  SearchResult,
  SkillItem,
  TaskItem,
  TaskPriority,
  TaskStatus,
} from './types.js';

export function getDefaultVaultPath(): string {
  if (process.env.AGENT_COLAB_VAULT) {
    return path.resolve(process.env.AGENT_COLAB_VAULT);
  }
  return path.join(os.homedir(), '.agent-colab', 'vault');
}

export function sanitizeSlug(raw: string): string {
  const cleaned = raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (!cleaned) {
    throw new Error(`Invalid identifier: "${raw}"`);
  }
  return cleaned;
}

const DEFAULT_USER_PROFILE = `---
updatedAt: ${new Date().toISOString()}
---
# User Profile

## Working Style & Preferences
- Preferred language: English
- Communication style: Concise, direct, practical

## Primary Tech Stack
- TypeScript, Node.js, React, Docker

## Notes for AI Agents
- Always read the project context and latest handoff notes before starting work.
- Leave a concise handoff note when finishing a milestone or pausing work.
`;

const DEFAULT_GLOBAL_RULES = `---
updatedAt: ${new Date().toISOString()}
---
# Global Agent Rules

1. Never commit raw API keys, tokens, or secrets into the vault or repositories.
2. Check active tasks and locks before editing the same area another agent is working on.
3. Record important architectural decisions in \`decisions.md\`.
4. Keep handoff notes actionable: what was done, what remains, and any blockers.
`;

export class VaultManager {
  public readonly vaultPath: string;
  private indexDb: VaultIndexDb;
  private watcher?: FSWatcher;

  constructor(vaultPath?: string) {
    this.vaultPath = path.resolve(vaultPath ?? getDefaultVaultPath());
    this.indexDb = new VaultIndexDb(path.join(this.vaultPath, '.index', 'colab.sqlite'));
  }

  init(): void {
    const dirs = [
      this.vaultPath,
      path.join(this.vaultPath, 'profile'),
      path.join(this.vaultPath, 'projects'),
      path.join(this.vaultPath, 'skills'),
      path.join(this.vaultPath, 'configs'),
      path.join(this.vaultPath, '.index'),
    ];
    for (const dir of dirs) {
      fs.mkdirSync(dir, { recursive: true });
    }

    const userFile = this.userProfilePath();
    if (!fs.existsSync(userFile)) {
      fs.writeFileSync(userFile, DEFAULT_USER_PROFILE, 'utf8');
    }

    const rulesFile = this.globalRulesPath();
    if (!fs.existsSync(rulesFile)) {
      fs.writeFileSync(rulesFile, DEFAULT_GLOBAL_RULES, 'utf8');
    }

    const mcpFile = this.mcpRegistryPath();
    if (!fs.existsSync(mcpFile)) {
      fs.writeFileSync(mcpFile, yaml.dump({ servers: [] }), 'utf8');
    }

    const gitignoreFile = path.join(this.vaultPath, '.gitignore');
    if (!fs.existsSync(gitignoreFile)) {
      fs.writeFileSync(gitignoreFile, '.index/\n*.sqlite*\n', 'utf8');
    }

    this.rebuildIndex();
  }

  startWatcher(): void {
    if (this.watcher) return;
    this.watcher = chokidar.watch(this.vaultPath, {
      ignored: /(^|[/\\])(\.index|\.git)/,
      ignoreInitial: true,
      awaitWriteFinish: { stabilityThreshold: 200, pollInterval: 50 },
    });
    const onChange = () => {
      try {
        this.rebuildIndex();
      } catch {
        // Ignore transient write states
      }
    };
    this.watcher.on('add', onChange).on('change', onChange).on('unlink', onChange);
  }

  async stopWatcher(): Promise<void> {
    if (this.watcher) {
      await this.watcher.close();
      this.watcher = undefined;
    }
  }

  close(): void {
    void this.stopWatcher();
    this.indexDb.close();
  }

  // --- Path Helpers ---

  private userProfilePath(): string {
    return path.join(this.vaultPath, 'profile', 'user.md');
  }

  private globalRulesPath(): string {
    return path.join(this.vaultPath, 'profile', 'global-rules.md');
  }

  private mcpRegistryPath(): string {
    return path.join(this.vaultPath, 'configs', 'mcp-registry.yaml');
  }

  private projectDir(slug: string): string {
    return path.join(this.vaultPath, 'projects', sanitizeSlug(slug));
  }

  private skillDir(name: string): string {
    return path.join(this.vaultPath, 'skills', sanitizeSlug(name));
  }

  // --- Profile & Global Rules ---

  getUserProfile(): ProfileDocument {
    const file = this.userProfilePath();
    if (!fs.existsSync(file)) {
      return { content: '', updatedAt: new Date(0).toISOString() };
    }
    const raw = fs.readFileSync(file, 'utf8');
    const parsed = matter(raw);
    const stat = fs.statSync(file);
    return {
      content: parsed.content.trim(),
      updatedAt: String(parsed.data.updatedAt ?? stat.mtime.toISOString()),
    };
  }

  updateUserProfile(content: string): ProfileDocument {
    const updatedAt = new Date().toISOString();
    const out = matter.stringify(content.trim() + '\n', { updatedAt });
    fs.mkdirSync(path.dirname(this.userProfilePath()), { recursive: true });
    fs.writeFileSync(this.userProfilePath(), out, 'utf8');
    this.indexDb.upsertDocument({
      docId: 'profile:user',
      docType: 'profile',
      projectSlug: '',
      title: 'User Profile',
      body: content,
      relPath: 'profile/user.md',
    });
    return { content: content.trim(), updatedAt };
  }

  getGlobalRules(): ProfileDocument {
    const file = this.globalRulesPath();
    if (!fs.existsSync(file)) {
      return { content: '', updatedAt: new Date(0).toISOString() };
    }
    const raw = fs.readFileSync(file, 'utf8');
    const parsed = matter(raw);
    const stat = fs.statSync(file);
    return {
      content: parsed.content.trim(),
      updatedAt: String(parsed.data.updatedAt ?? stat.mtime.toISOString()),
    };
  }

  updateGlobalRules(content: string): ProfileDocument {
    const updatedAt = new Date().toISOString();
    const out = matter.stringify(content.trim() + '\n', { updatedAt });
    fs.mkdirSync(path.dirname(this.globalRulesPath()), { recursive: true });
    fs.writeFileSync(this.globalRulesPath(), out, 'utf8');
    this.indexDb.upsertDocument({
      docId: 'profile:global-rules',
      docType: 'profile',
      projectSlug: '',
      title: 'Global Agent Rules',
      body: content,
      relPath: 'profile/global-rules.md',
    });
    return { content: content.trim(), updatedAt };
  }

  // --- Projects ---

  listProjects(): ProjectSummary[] {
    const root = path.join(this.vaultPath, 'projects');
    if (!fs.existsSync(root)) return [];

    const entries = fs.readdirSync(root, { withFileTypes: true });
    const summaries: ProjectSummary[] = [];

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const project = this.getProject(entry.name);
      if (!project) continue;
      const tasks = this.listTasks(project.slug);
      const notes = this.listNotes(project.slug, 1000);
      summaries.push({
        slug: project.slug,
        name: project.name,
        status: project.status,
        tags: project.tags,
        repoPath: project.repoPath,
        codingAccess: project.codingAccess,
        updatedAt: project.updatedAt,
        taskCount: tasks.length,
        noteCount: notes.length,
      });
    }

    return summaries.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  getProject(slug: string): ProjectContext | null {
    const safeSlug = sanitizeSlug(slug);
    const dir = this.projectDir(safeSlug);
    const contextFile = path.join(dir, 'context.md');
    if (!fs.existsSync(contextFile)) return null;

    const parsed = matter(fs.readFileSync(contextFile, 'utf8'));
    const stat = fs.statSync(contextFile);
    const decisionsFile = path.join(dir, 'decisions.md');
    const decisions = fs.existsSync(decisionsFile)
      ? fs.readFileSync(decisionsFile, 'utf8').trim()
      : '';

    const rawAccess = parsed.data.codingAccess;
    const codingAccess: CodingAccessMode =
      rawAccess === 'read-only' || rawAccess === 'full' ? rawAccess : 'disabled';

    return {
      slug: safeSlug,
      name: String(parsed.data.name ?? safeSlug),
      status: String(parsed.data.status ?? 'active'),
      tags: Array.isArray(parsed.data.tags) ? parsed.data.tags.map(String) : [],
      repoPath: parsed.data.repoPath ? String(parsed.data.repoPath) : undefined,
      codingAccess,
      content: parsed.content.trim(),
      decisions,
      updatedAt: String(parsed.data.updatedAt ?? stat.mtime.toISOString()),
    };
  }

  upsertProject(
    slug: string,
    data: {
      name?: string;
      status?: string;
      tags?: string[];
      repoPath?: string;
      codingAccess?: CodingAccessMode;
      content: string;
    }
  ): ProjectContext {
    const safeSlug = sanitizeSlug(slug);
    const dir = this.projectDir(safeSlug);
    fs.mkdirSync(path.join(dir, 'tasks'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'notes'), { recursive: true });

    const existing = this.getProject(safeSlug);
    const updatedAt = new Date().toISOString();
    const frontmatter: Record<string, unknown> = {
      name: data.name ?? existing?.name ?? safeSlug,
      status: data.status ?? existing?.status ?? 'active',
      tags: data.tags ?? existing?.tags ?? [],
      codingAccess: data.codingAccess ?? existing?.codingAccess ?? 'disabled',
      updatedAt,
    };
    const nextRepoPath = data.repoPath !== undefined ? data.repoPath.trim() : existing?.repoPath;
    if (nextRepoPath) {
      frontmatter.repoPath = nextRepoPath;
    }

    const out = matter.stringify(data.content.trim() + '\n', frontmatter);
    fs.writeFileSync(path.join(dir, 'context.md'), out, 'utf8');

    const decisionsFile = path.join(dir, 'decisions.md');
    if (!fs.existsSync(decisionsFile)) {
      fs.writeFileSync(decisionsFile, `# Decisions Log — ${frontmatter.name}\n\n`, 'utf8');
    }

    this.indexDb.upsertDocument({
      docId: `project:${safeSlug}`,
      docType: 'project',
      projectSlug: safeSlug,
      title: String(frontmatter.name),
      body: data.content,
      relPath: `projects/${safeSlug}/context.md`,
    });

    return this.getProject(safeSlug)!;
  }

  appendDecision(
    slug: string,
    title: string,
    rationale: string,
    authorAgent: string
  ): ProjectContext {
    const project = this.getProject(slug);
    if (!project) {
      throw new Error(`Project not found: ${slug}`);
    }
    const decisionsFile = path.join(this.projectDir(project.slug), 'decisions.md');
    const date = new Date().toISOString().slice(0, 10);
    const entry = `\n## ${date} — ${title}\n- **Recorded by**: ${authorAgent}\n\n${rationale.trim()}\n`;
    fs.appendFileSync(decisionsFile, entry, 'utf8');

    const updated = this.getProject(project.slug)!;
    this.indexDb.upsertDocument({
      docId: `project:${project.slug}:decisions`,
      docType: 'project',
      projectSlug: project.slug,
      title: `${project.name} Decisions`,
      body: updated.decisions,
      relPath: `projects/${project.slug}/decisions.md`,
    });
    return updated;
  }

  // --- Tasks ---

  listTasks(projectSlug?: string, statusFilter?: TaskStatus): TaskItem[] {
    const slugs = projectSlug
      ? [sanitizeSlug(projectSlug)]
      : this.listProjects().map((p) => p.slug);

    const tasks: TaskItem[] = [];
    for (const slug of slugs) {
      const tasksDir = path.join(this.projectDir(slug), 'tasks');
      if (!fs.existsSync(tasksDir)) continue;
      for (const file of fs.readdirSync(tasksDir)) {
        if (!file.endsWith('.md')) continue;
        const id = file.replace(/\.md$/, '');
        const task = this.getTask(slug, id);
        if (!task) continue;
        if (statusFilter && task.status !== statusFilter) continue;
        tasks.push(task);
      }
    }

    return tasks.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  getTask(projectSlug: string, taskId: string): TaskItem | null {
    const safeSlug = sanitizeSlug(projectSlug);
    const safeId = sanitizeSlug(taskId);
    const file = path.join(this.projectDir(safeSlug), 'tasks', `${safeId}.md`);
    if (!fs.existsSync(file)) return null;

    const parsed = matter(fs.readFileSync(file, 'utf8'));
    const stat = fs.statSync(file);

    return {
      id: safeId,
      projectSlug: safeSlug,
      title: String(parsed.data.title ?? safeId),
      status: (parsed.data.status as TaskStatus) ?? 'todo',
      priority: (parsed.data.priority as TaskPriority) ?? 'medium',
      claimedBy: parsed.data.claimedBy ? String(parsed.data.claimedBy) : undefined,
      lockUntil: parsed.data.lockUntil ? String(parsed.data.lockUntil) : undefined,
      createdBy: String(parsed.data.createdBy ?? 'user'),
      createdAt: String(parsed.data.createdAt ?? stat.birthtime.toISOString()),
      updatedAt: String(parsed.data.updatedAt ?? stat.mtime.toISOString()),
      body: parsed.content.trim(),
    };
  }

  createTask(input: {
    projectSlug: string;
    id?: string;
    title: string;
    priority?: TaskPriority;
    status?: TaskStatus;
    createdBy?: string;
    body?: string;
  }): TaskItem {
    const safeSlug = sanitizeSlug(input.projectSlug);
    if (!this.getProject(safeSlug)) {
      throw new Error(`Project not found: ${safeSlug}`);
    }
    const id = input.id
      ? sanitizeSlug(input.id)
      : `${sanitizeSlug(input.title).slice(0, 32)}-${Date.now().toString(36).slice(-4)}`;
    const now = new Date().toISOString();
    const task: TaskItem = {
      id,
      projectSlug: safeSlug,
      title: input.title,
      status: input.status ?? 'todo',
      priority: input.priority ?? 'medium',
      createdBy: input.createdBy ?? 'user',
      createdAt: now,
      updatedAt: now,
      body: input.body?.trim() ?? '',
    };
    this.writeTask(task);
    return task;
  }

  claimTask(
    projectSlug: string,
    taskId: string,
    agentName: string,
    lockMinutes = 30
  ): TaskItem {
    const task = this.getTask(projectSlug, taskId);
    if (!task) {
      throw new Error(`Task not found: ${projectSlug}/${taskId}`);
    }

    const now = new Date();
    if (
      task.claimedBy &&
      task.claimedBy !== agentName &&
      task.lockUntil &&
      new Date(task.lockUntil) > now
    ) {
      throw new Error(
        `Task "${task.id}" is currently locked by "${task.claimedBy}" until ${task.lockUntil}`
      );
    }

    task.claimedBy = agentName;
    task.lockUntil = new Date(now.getTime() + lockMinutes * 60_000).toISOString();
    if (task.status === 'todo' || task.status === 'handoff') {
      task.status = 'in_progress';
    }
    task.updatedAt = now.toISOString();
    this.writeTask(task);
    return task;
  }

  updateTask(
    projectSlug: string,
    taskId: string,
    patch: {
      title?: string;
      status?: TaskStatus;
      priority?: TaskPriority;
      body?: string;
      releaseLock?: boolean;
    }
  ): TaskItem {
    const task = this.getTask(projectSlug, taskId);
    if (!task) {
      throw new Error(`Task not found: ${projectSlug}/${taskId}`);
    }

    if (patch.title !== undefined) task.title = patch.title;
    if (patch.status !== undefined) task.status = patch.status;
    if (patch.priority !== undefined) task.priority = patch.priority;
    if (patch.body !== undefined) task.body = patch.body.trim();
    if (patch.releaseLock || patch.status === 'handoff' || patch.status === 'done') {
      task.claimedBy = undefined;
      task.lockUntil = undefined;
    }
    task.updatedAt = new Date().toISOString();
    this.writeTask(task);
    return task;
  }

  private writeTask(task: TaskItem): void {
    const dir = path.join(this.projectDir(task.projectSlug), 'tasks');
    fs.mkdirSync(dir, { recursive: true });
    const fm: Record<string, unknown> = {
      title: task.title,
      status: task.status,
      priority: task.priority,
      createdBy: task.createdBy,
      createdAt: task.createdAt,
      updatedAt: task.updatedAt,
    };
    if (task.claimedBy) fm.claimedBy = task.claimedBy;
    if (task.lockUntil) fm.lockUntil = task.lockUntil;

    const out = matter.stringify((task.body || '') + '\n', fm);
    fs.writeFileSync(path.join(dir, `${task.id}.md`), out, 'utf8');

    this.indexDb.upsertDocument({
      docId: `task:${task.projectSlug}:${task.id}`,
      docType: 'task',
      projectSlug: task.projectSlug,
      title: task.title,
      body: `${task.status} ${task.claimedBy ?? ''} ${task.body}`,
      relPath: `projects/${task.projectSlug}/tasks/${task.id}.md`,
    });
  }

  // --- Handoff Notes ---

  listNotes(projectSlug?: string, limit = 20): HandoffNote[] {
    const slugs = projectSlug
      ? [sanitizeSlug(projectSlug)]
      : this.listProjects().map((p) => p.slug);

    const notes: HandoffNote[] = [];
    for (const slug of slugs) {
      const notesDir = path.join(this.projectDir(slug), 'notes');
      if (!fs.existsSync(notesDir)) continue;
      for (const file of fs.readdirSync(notesDir)) {
        if (!file.endsWith('.md')) continue;
        const full = path.join(notesDir, file);
        const parsed = matter(fs.readFileSync(full, 'utf8'));
        const stat = fs.statSync(full);
        const id = file.replace(/\.md$/, '');
        notes.push({
          id,
          projectSlug: slug,
          authorAgent: String(parsed.data.authorAgent ?? 'unknown'),
          title: String(parsed.data.title ?? id),
          summary: String(parsed.data.summary ?? ''),
          nextSteps: Array.isArray(parsed.data.nextSteps)
            ? parsed.data.nextSteps.map(String)
            : [],
          relatedTaskId: parsed.data.relatedTaskId
            ? String(parsed.data.relatedTaskId)
            : undefined,
          createdAt: String(parsed.data.createdAt ?? stat.mtime.toISOString()),
          body: parsed.content.trim(),
        });
      }
    }

    return notes
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, limit);
  }

  createNote(input: {
    projectSlug: string;
    authorAgent: string;
    title: string;
    summary: string;
    nextSteps?: string[];
    relatedTaskId?: string;
    body?: string;
  }): HandoffNote {
    const safeSlug = sanitizeSlug(input.projectSlug);
    if (!this.getProject(safeSlug)) {
      throw new Error(`Project not found: ${safeSlug}`);
    }
    const createdAt = new Date().toISOString();
    const stamp = createdAt.replace(/[:.]/g, '-').slice(0, 19);
    const id = `${stamp}_${sanitizeSlug(input.authorAgent)}_${Math.random().toString(36).slice(2, 6)}`;
    const notesDir = path.join(this.projectDir(safeSlug), 'notes');
    fs.mkdirSync(notesDir, { recursive: true });

    const note: HandoffNote = {
      id,
      projectSlug: safeSlug,
      authorAgent: input.authorAgent,
      title: input.title,
      summary: input.summary,
      nextSteps: input.nextSteps ?? [],
      relatedTaskId: input.relatedTaskId,
      createdAt,
      body: input.body?.trim() ?? '',
    };

    const fm: Record<string, unknown> = {
      authorAgent: note.authorAgent,
      title: note.title,
      summary: note.summary,
      nextSteps: note.nextSteps,
      createdAt: note.createdAt,
    };
    if (note.relatedTaskId) fm.relatedTaskId = note.relatedTaskId;

    const out = matter.stringify((note.body || note.summary) + '\n', fm);
    fs.writeFileSync(path.join(notesDir, `${id}.md`), out, 'utf8');

    this.indexDb.upsertDocument({
      docId: `note:${safeSlug}:${id}`,
      docType: 'note',
      projectSlug: safeSlug,
      title: note.title,
      body: `${note.authorAgent} ${note.summary} ${note.nextSteps.join(' ')} ${note.body}`,
      relPath: `projects/${safeSlug}/notes/${id}.md`,
    });

    return note;
  }

  // --- Skills ---

  listSkills(): SkillItem[] {
    const root = path.join(this.vaultPath, 'skills');
    if (!fs.existsSync(root)) return [];

    const skills: SkillItem[] = [];
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const skill = this.getSkill(entry.name);
      if (skill) skills.push(skill);
    }
    return skills.sort((a, b) => a.name.localeCompare(b.name));
  }

  getSkill(name: string): SkillItem | null {
    const safeName = sanitizeSlug(name);
    const file = path.join(this.skillDir(safeName), 'SKILL.md');
    if (!fs.existsSync(file)) return null;

    const raw = fs.readFileSync(file, 'utf8');
    const parsed = matter(raw);
    const stat = fs.statSync(file);

    return {
      name: String(parsed.data.name ?? safeName),
      description: String(parsed.data.description ?? ''),
      content: raw,
      sourceAgent: parsed.data.sourceAgent ? String(parsed.data.sourceAgent) : undefined,
      updatedAt: stat.mtime.toISOString(),
    };
  }

  upsertSkill(name: string, rawSkillMd: string, sourceAgent?: string): SkillItem {
    const safeName = sanitizeSlug(name);
    const dir = this.skillDir(safeName);
    fs.mkdirSync(dir, { recursive: true });

    let contentToWrite = rawSkillMd;
    const parsed = matter(rawSkillMd);
    if (!parsed.data.name) {
      contentToWrite = matter.stringify(parsed.content, {
        ...parsed.data,
        name: safeName,
        ...(sourceAgent ? { sourceAgent } : {}),
      });
    }

    fs.writeFileSync(path.join(dir, 'SKILL.md'), contentToWrite, 'utf8');
    const saved = this.getSkill(safeName)!;

    this.indexDb.upsertDocument({
      docId: `skill:${safeName}`,
      docType: 'skill',
      projectSlug: '',
      title: saved.name,
      body: `${saved.description} ${saved.content}`,
      relPath: `skills/${safeName}/SKILL.md`,
    });

    return saved;
  }

  deleteSkill(name: string): boolean {
    const safeName = sanitizeSlug(name);
    const dir = this.skillDir(safeName);
    if (!fs.existsSync(dir)) return false;
    fs.rmSync(dir, { recursive: true, force: true });
    this.indexDb.removeDocument(`skill:${safeName}`);
    return true;
  }

  // --- MCP Registry ---

  getMcpRegistry(): McpServerEntry[] {
    const file = this.mcpRegistryPath();
    if (!fs.existsSync(file)) return [];
    const parsed = yaml.load(fs.readFileSync(file, 'utf8')) as {
      servers?: McpServerEntry[];
    } | null;
    return Array.isArray(parsed?.servers) ? parsed.servers : [];
  }

  upsertMcpServer(entry: McpServerEntry): { entry: McpServerEntry; redactedKeys: string[] } {
    const envRes = redactEnvRecord(entry.env);
    const headersRes = redactEnvRecord(entry.headers);
    const sanitized: McpServerEntry = {
      ...entry,
      env: envRes.value,
      headers: headersRes.value,
      enabled: entry.enabled ?? true,
    };

    const current = this.getMcpRegistry().filter((s) => s.name !== sanitized.name);
    current.push(sanitized);
    current.sort((a, b) => a.name.localeCompare(b.name));

    fs.mkdirSync(path.dirname(this.mcpRegistryPath()), { recursive: true });
    fs.writeFileSync(this.mcpRegistryPath(), yaml.dump({ servers: current }), 'utf8');

    return {
      entry: sanitized,
      redactedKeys: [...envRes.redactedKeys, ...headersRes.redactedKeys],
    };
  }

  removeMcpServer(name: string): boolean {
    const current = this.getMcpRegistry();
    const next = current.filter((s) => s.name !== name);
    if (next.length === current.length) return false;
    fs.writeFileSync(this.mcpRegistryPath(), yaml.dump({ servers: next }), 'utf8');
    return true;
  }

  // --- Indexing, Search & Audit ---

  rebuildIndex(): void {
    this.indexDb.clearDocuments();

    const profile = this.getUserProfile();
    if (profile.content) {
      this.indexDb.upsertDocument({
        docId: 'profile:user',
        docType: 'profile',
        projectSlug: '',
        title: 'User Profile',
        body: profile.content,
        relPath: 'profile/user.md',
      });
    }

    const rules = this.getGlobalRules();
    if (rules.content) {
      this.indexDb.upsertDocument({
        docId: 'profile:global-rules',
        docType: 'profile',
        projectSlug: '',
        title: 'Global Agent Rules',
        body: rules.content,
        relPath: 'profile/global-rules.md',
      });
    }

    const projectsRoot = path.join(this.vaultPath, 'projects');
    if (fs.existsSync(projectsRoot)) {
      for (const entry of fs.readdirSync(projectsRoot, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const proj = this.getProject(entry.name);
        if (!proj) continue;
        this.indexDb.upsertDocument({
          docId: `project:${proj.slug}`,
          docType: 'project',
          projectSlug: proj.slug,
          title: proj.name,
          body: `${proj.content}\n${proj.decisions}`,
          relPath: `projects/${proj.slug}/context.md`,
        });

        for (const task of this.listTasks(proj.slug)) {
          this.indexDb.upsertDocument({
            docId: `task:${proj.slug}:${task.id}`,
            docType: 'task',
            projectSlug: proj.slug,
            title: task.title,
            body: `${task.status} ${task.claimedBy ?? ''} ${task.body}`,
            relPath: `projects/${proj.slug}/tasks/${task.id}.md`,
          });
        }

        for (const note of this.listNotes(proj.slug, 500)) {
          this.indexDb.upsertDocument({
            docId: `note:${proj.slug}:${note.id}`,
            docType: 'note',
            projectSlug: proj.slug,
            title: note.title,
            body: `${note.authorAgent} ${note.summary} ${note.nextSteps.join(' ')} ${note.body}`,
            relPath: `projects/${proj.slug}/notes/${note.id}.md`,
          });
        }
      }
    }

    for (const skill of this.listSkills()) {
      this.indexDb.upsertDocument({
        docId: `skill:${skill.name}`,
        docType: 'skill',
        projectSlug: '',
        title: skill.name,
        body: `${skill.description} ${skill.content}`,
        relPath: `skills/${skill.name}/SKILL.md`,
      });
    }
  }

  search(query: string, limit = 20): SearchResult[] {
    return this.indexDb.search(query, limit);
  }

  logAudit(entry: Omit<AuditEntry, 'id' | 'timestamp'>): void {
    this.indexDb.logAudit(entry);
  }

  getAuditLogs(limit = 50): AuditEntry[] {
    return this.indexDb.getAuditLogs(limit);
  }
}
