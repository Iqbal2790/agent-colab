export type TaskStatus = 'todo' | 'in_progress' | 'handoff' | 'blocked' | 'done';
export type TaskPriority = 'low' | 'medium' | 'high' | 'urgent';
export type CodingAccessMode = 'disabled' | 'read-only' | 'full';

export interface ProfileDocument {
  content: string;
  updatedAt: string;
}

export interface PersonaProfile {
  name: string;
  content: string;
  updatedAt: string;
}

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
  status: TaskStatus;
  priority: TaskPriority;
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

export interface McpServerEntry {
  name: string;
  transport: 'stdio' | 'http';
  command?: string;
  args?: string[];
  url?: string;
  env?: Record<string, string>;
  headers?: Record<string, string>;
  enabled?: boolean;
  sourceAgent?: string;
}

export interface SearchResult {
  id: string;
  type: 'profile' | 'project' | 'task' | 'note' | 'skill';
  projectSlug?: string;
  title: string;
  snippet: string;
  path: string;
  rank: number;
}

export interface AuditEntry {
  id: number;
  timestamp: string;
  actor: string;
  action: string;
  resource: string;
  via: 'local' | 'mcp' | 'web' | 'tunnel' | 'cli';
  details?: string;
}

export interface ConnectedAgent {
  id: string;
  clientName: string;
  clientVersion?: string;
  persona?: string;
  tagScope?: string;
  via: 'mcp' | 'tunnel';
  firstSeen: string;
  lastSeen: string;
  requestCount: number;
}

export interface ContextPackOptions {
  projectSlug?: string;
  target: 'claude' | 'gemini' | 'generic';
  includeSkills?: boolean;
  noteLimit?: number;
}
