export type CodingAccessMode = 'disabled' | 'read-only' | 'full';

export interface ProjectSummary {
  slug: string;
  name: string;
  status: string;
  tags: string[];
  repoPath?: string;
  codingAccess: CodingAccessMode;
  updatedAt: string;
  taskCount: number;
  noteCount: number;
}

export interface ProjectContext {
  slug: string;
  name: string;
  status: string;
  tags: string[];
  repoPath?: string;
  codingAccess: CodingAccessMode;
  content: string;
  decisions: string;
  updatedAt: string;
}

export interface TaskItem {
  id: string;
  projectSlug: string;
  title: string;
  status: 'todo' | 'in_progress' | 'handoff' | 'blocked' | 'done';
  priority: 'low' | 'medium' | 'high' | 'urgent';
  claimedBy?: string;
  lockUntil?: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  body: string;
}

export interface HandoffNote {
  id: string;
  projectSlug: string;
  authorAgent: string;
  title: string;
  summary: string;
  nextSteps: string[];
  relatedTaskId?: string;
  createdAt: string;
  body: string;
}

export interface SkillItem {
  name: string;
  description: string;
  content: string;
  sourceAgent?: string;
  updatedAt: string;
}

export type AgentAdapterId = 'antigravity' | 'hermes' | 'claude-code' | 'openclaw' | 'cursor';

export interface AdapterInfo {
  agent: AgentAdapterId;
  displayName: string;
  installed: boolean;
  skillsDir: string;
  configPath: string;
}

export interface SyncAction {
  kind: 'skill' | 'mcp';
  name: string;
  operation: 'create' | 'update' | 'skip';
  targetPath: string;
  redactedKeys?: string[];
}

export interface SyncResult {
  agent: AgentAdapterId;
  direction: 'import' | 'export';
  dryRun: boolean;
  actions: SyncAction[];
  backupPath?: string;
}

export interface TunnelStatus {
  active: boolean;
  provider: 'cloudflared' | 'mock';
  publicUrl?: string;
  token?: string;
  scope?: 'read-only' | 'read-write';
  startedAt?: string;
  expiresAt?: string;
  error?: string;
}

export interface PersonaProfile {
  name: string;
  content: string;
  updatedAt: string;
}

export interface SearchResult {
  id: string;
  type: 'profile' | 'project' | 'task' | 'note' | 'skill';
  projectSlug?: string;
  title: string;
  snippet: string;
  path: string;
}

async function req<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    ...init,
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data?.error || `Request failed (${res.status})`);
  }
  return data as T;
}

export const api = {
  health: () =>
    req<{ ok: boolean; version: string; vaultPath: string; tunnelActive: boolean }>('/api/health'),
  getProfile: () =>
    req<{
      profile: { content: string; updatedAt: string };
      rules: { content: string; updatedAt: string };
      personas: PersonaProfile[];
    }>('/api/profile'),
  updateProfile: (payload: { content?: string; rules?: string }) =>
    req('/api/profile', { method: 'PUT', body: JSON.stringify(payload) }),
  upsertPersona: (name: string, content: string) =>
    req<{ persona: PersonaProfile }>(`/api/personas/${encodeURIComponent(name)}`, {
      method: 'PUT',
      body: JSON.stringify({ content }),
    }),
  deletePersona: (name: string) =>
    req<{ deleted: boolean }>(`/api/personas/${encodeURIComponent(name)}`, { method: 'DELETE' }),
  listProjects: () => req<{ projects: ProjectSummary[] }>('/api/projects'),
  getProject: (slug: string) =>
    req<{ project: ProjectContext; tasks: TaskItem[]; notes: HandoffNote[] }>(`/api/projects/${slug}`),
  upsertProject: (
    slug: string,
    payload: {
      name?: string;
      status?: string;
      tags?: string[];
      repoPath?: string;
      codingAccess?: CodingAccessMode;
      content: string;
    }
  ) => req<{ project: ProjectContext }>(`/api/projects/${slug}`, { method: 'PUT', body: JSON.stringify(payload) }),
  listTasks: (projectSlug?: string) =>
    req<{ tasks: TaskItem[] }>(projectSlug ? `/api/tasks?project=${encodeURIComponent(projectSlug)}` : '/api/tasks'),
  createTask: (payload: { projectSlug: string; title: string; priority?: string; body?: string }) =>
    req<{ task: TaskItem }>('/api/tasks', { method: 'POST', body: JSON.stringify(payload) }),
  updateTask: (projectSlug: string, taskId: string, payload: { status?: string; releaseLock?: boolean }) =>
    req<{ task: TaskItem }>(`/api/tasks/${projectSlug}/${taskId}`, { method: 'PATCH', body: JSON.stringify(payload) }),
  listNotes: (projectSlug?: string) =>
    req<{ notes: HandoffNote[] }>(projectSlug ? `/api/notes?project=${encodeURIComponent(projectSlug)}` : '/api/notes'),
  createNote: (payload: {
    projectSlug: string;
    authorAgent: string;
    title: string;
    summary: string;
    nextSteps?: string[];
  }) => req<{ note: HandoffNote }>('/api/notes', { method: 'POST', body: JSON.stringify(payload) }),
  listSkills: () => req<{ skills: SkillItem[] }>('/api/skills'),
  listAdapters: () => req<{ adapters: AdapterInfo[] }>('/api/adapters'),
  syncAdapter: (payload: { agent: AgentAdapterId; direction: 'import' | 'export'; dryRun?: boolean }) =>
    req<SyncResult>('/api/sync', { method: 'POST', body: JSON.stringify(payload) }),
  connectAdapter: (payload: { agent: AgentAdapterId; mode: 'http' | 'stdio'; dryRun?: boolean }) =>
    req<{ agent: string; configPath: string; backupPath?: string; dryRun: boolean; entry: unknown }>('/api/connect', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  getTunnel: () => req<TunnelStatus>('/api/tunnel'),
  startTunnel: (payload: { ttlMinutes: number; scope: 'read-only' | 'read-write'; provider?: 'cloudflared' | 'mock' }) =>
    req<TunnelStatus>('/api/tunnel/start', { method: 'POST', body: JSON.stringify(payload) }),
  stopTunnel: () => req<TunnelStatus>('/api/tunnel/stop', { method: 'POST' }),
  exportContext: (target: 'claude' | 'gemini' | 'generic', projectSlug?: string) =>
    req<{ markdown: string }>(
      `/api/export?target=${target}${projectSlug ? `&project=${encodeURIComponent(projectSlug)}` : ''}`
    ),
  search: (q: string) => req<{ results: SearchResult[] }>(`/api/search?q=${encodeURIComponent(q)}`),
};
