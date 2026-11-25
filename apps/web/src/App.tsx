import { useEffect, useState } from 'react';
import {
  Activity,
  ArrowUpRight,
  Check,
  Copy,
  Cpu,
  Download,
  Eye,
  FolderGit2,
  Globe,
  Home,
  KeyRound,
  Layers,
  Lock,
  Menu,
  MessageSquare,
  Plus,
  RefreshCw,
  Search,
  Settings,
  Shield,
  SlidersHorizontal,
  Upload,
  User,
  X,
} from 'lucide-react';
import {
  api,
  type AuditEntry,
  type CodingAccessMode,
  type ConnectedAgent,
  type CredentialMeta,
  type HandoffNote,
  type PersonaProfile,
  type ProjectContext,
  type ProjectSummary,
  type SearchResult,
  type SkillItem,
  type SkillSyncResult,
  type TaskItem,
  type TunnelStatus,
} from './api';

type ViewId = 'dashboard' | 'agents' | 'collab' | 'sync' | 'credentials' | 'bridge' | 'search' | 'profile';

export default function App() {
  const [view, setView] = useState<ViewId>('dashboard');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [newProjectModal, setNewProjectModal] = useState(false);
  const [connectorUrl, setConnectorUrl] = useState(() =>
    typeof window !== 'undefined' ? `${window.location.origin}/mcp` : 'http://127.0.0.1:4242/mcp'
  );
  const [connectorIdentity, setConnectorIdentity] = useState('');
  const [connectorPersona, setConnectorPersona] = useState('');
  const [connectorTags, setConnectorTags] = useState('');
  const [snippetFormat, setSnippetFormat] = useState<'json' | 'yaml'>('json');
  const [skillsSyncDir, setSkillsSyncDir] = useState('');

  const [vaultPath, setVaultPath] = useState('');
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [selectedSlug, setSelectedSlug] = useState('');
  const [projectDetail, setProjectDetail] = useState<ProjectContext | null>(null);
  const [allTasks, setAllTasks] = useState<TaskItem[]>([]);
  const [allNotes, setAllNotes] = useState<HandoffNote[]>([]);
  const [projectTasks, setProjectTasks] = useState<TaskItem[]>([]);
  const [projectNotes, setProjectNotes] = useState<HandoffNote[]>([]);
  const [profileText, setProfileText] = useState('');
  const [rulesText, setRulesText] = useState('');
  const [personas, setPersonas] = useState<PersonaProfile[]>([]);
  const [newPersonaName, setNewPersonaName] = useState('');
  const [newPersonaContent, setNewPersonaContent] = useState('');
  const [skills, setSkills] = useState<SkillItem[]>([]);
  const [connectedAgents, setConnectedAgents] = useState<ConnectedAgent[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditEntry[]>([]);
  const [credentials, setCredentials] = useState<CredentialMeta[]>([]);
  const [credName, setCredName] = useState('');
  const [credService, setCredService] = useState('');
  const [credEnvVar, setCredEnvVar] = useState('');
  const [credValue, setCredValue] = useState('');
  const [credTags, setCredTags] = useState('');
  const [credNotes, setCredNotes] = useState('');
  const [revealedSecrets, setRevealedSecrets] = useState<Record<string, string>>({});
  const [tunnel, setTunnel] = useState<TunnelStatus>({ active: false, provider: 'cloudflared' });
  const [statusMsg, setStatusMsg] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  // Search
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);

  // Forms
  const [newProjSlug, setNewProjSlug] = useState('');
  const [newProjName, setNewProjName] = useState('');
  const [newProjTags, setNewProjTags] = useState('');
  const [newProjRepoPath, setNewProjRepoPath] = useState('');
  const [newProjCodingAccess, setNewProjCodingAccess] = useState<CodingAccessMode>('disabled');
  const [newProjDesc, setNewProjDesc] = useState('');
  const [projContentDraft, setProjContentDraft] = useState('');
  const [projTagsDraft, setProjTagsDraft] = useState('');
  const [projRepoDraft, setProjRepoDraft] = useState('');
  const [projAccessDraft, setProjAccessDraft] = useState<CodingAccessMode>('disabled');

  const [newTaskTitle, setNewTaskTitle] = useState('');
  const [newNoteAgent, setNewNoteAgent] = useState('antigravity');
  const [newNoteTitle, setNewNoteTitle] = useState('');
  const [newNoteSummary, setNewNoteSummary] = useState('');
  const [newNoteNext, setNewNoteNext] = useState('');

  // Sync & Bridge
  const [syncPreview, setSyncPreview] = useState<SkillSyncResult | null>(null);
  const [tunnelTtl, setTunnelTtl] = useState(30);
  const [tunnelScope, setTunnelScope] = useState<'read-only' | 'read-write'>('read-only');
  const [tunnelBusy, setTunnelBusy] = useState(false);
  const [exportTarget, setExportTarget] = useState<'claude' | 'gemini'>('claude');
  const [exportMarkdown, setExportMarkdown] = useState('');
  const [copiedKey, setCopiedKey] = useState('');

  function flash(msg: string) {
    setErrorMsg('');
    setStatusMsg(msg);
    setTimeout(() => setStatusMsg(''), 4000);
  }

  function fail(err: unknown) {
    setErrorMsg(err instanceof Error ? err.message : String(err));
  }

  async function loadAll() {
    try {
      const [h, prof, projList, tasksRes, notesRes, sk, agentsRes, auditRes, credsRes, tun] =
        await Promise.all([
          api.health(),
          api.getProfile(),
          api.listProjects(),
          api.listTasks(),
          api.listNotes(),
          api.listSkills(),
          api.listConnectedAgents(),
          api.getAuditLogs(60),
          api.listCredentials(),
          api.getTunnel(),
        ]);
      setVaultPath(h.vaultPath);
      setProfileText(prof.profile.content);
      setRulesText(prof.rules.content);
      setPersonas(prof.personas ?? []);
      setProjects(projList.projects);
      setAllTasks(tasksRes.tasks);
      setAllNotes(notesRes.notes);
      setSkills(sk.skills);
      setConnectedAgents(agentsRes.agents);
      setAuditLogs(auditRes.logs);
      setCredentials(credsRes.credentials);
      setTunnel(tun);

      if (projList.projects.length > 0 && !selectedSlug) {
        setSelectedSlug(projList.projects[0].slug);
      }
    } catch (err) {
      fail(err);
    }
  }

  async function loadProject(slug: string) {
    if (!slug) {
      setProjectDetail(null);
      setProjectTasks([]);
      setProjectNotes([]);
      return;
    }
    try {
      const detail = await api.getProject(slug);
      setProjectDetail(detail.project);
      setProjContentDraft(detail.project.content);
      setProjTagsDraft((detail.project.tags ?? []).join(', '));
      setProjRepoDraft(detail.project.repoPath ?? '');
      setProjAccessDraft(detail.project.codingAccess ?? 'disabled');
      setProjectTasks(detail.tasks);
      setProjectNotes(detail.notes);
    } catch (err) {
      fail(err);
    }
  }

  useEffect(() => {
    void loadAll();
  }, []);

  useEffect(() => {
    void loadProject(selectedSlug);
  }, [selectedSlug]);

  useEffect(() => {
    if (view === 'bridge') {
      void api
        .exportContext(exportTarget, selectedSlug || undefined)
        .then((res) => setExportMarkdown(res.markdown))
        .catch(fail);
    }
  }, [view, exportTarget, selectedSlug]);

  async function handleSearch(q: string) {
    setSearchQuery(q);
    if (!q.trim()) {
      setSearchResults([]);
      return;
    }
    try {
      const res = await api.search(q);
      setSearchResults(res.results);
    } catch (err) {
      fail(err);
    }
  }

  async function handleCreateProject(e: React.FormEvent) {
    e.preventDefault();
    if (!newProjSlug.trim()) return;
    try {
      const parsedTags = newProjTags
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean);
      const res = await api.upsertProject(newProjSlug.trim(), {
        name: newProjName.trim() || newProjSlug.trim(),
        status: 'active',
        tags: parsedTags,
        repoPath: newProjRepoPath.trim() || undefined,
        codingAccess: newProjCodingAccess,
        content:
          newProjDesc.trim() ||
          '# Overview\n\nDescribe architecture, goals, and current status so any agent can pick up immediately.',
      });
      setNewProjSlug('');
      setNewProjName('');
      setNewProjTags('');
      setNewProjRepoPath('');
      setNewProjCodingAccess('disabled');
      setNewProjDesc('');
      setNewProjectModal(false);
      await loadAll();
      setSelectedSlug(res.project.slug);
      flash(`Project "${res.project.name}" added to Vault.`);
    } catch (err) {
      fail(err);
    }
  }

  async function handleSaveProject() {
    if (!projectDetail) return;
    try {
      const parsedTags = projTagsDraft
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean);
      await api.upsertProject(projectDetail.slug, {
        name: projectDetail.name,
        status: projectDetail.status,
        tags: parsedTags,
        repoPath: projRepoDraft.trim(),
        codingAccess: projAccessDraft,
        content: projContentDraft,
      });
      await Promise.all([loadAll(), loadProject(projectDetail.slug)]);
      flash('Project context & workspace permissions saved.');
    } catch (err) {
      fail(err);
    }
  }

  async function handleSavePersona(e: React.FormEvent) {
    e.preventDefault();
    if (!newPersonaName.trim() || !newPersonaContent.trim()) return;
    try {
      await api.upsertPersona(newPersonaName.trim(), newPersonaContent.trim());
      setNewPersonaName('');
      setNewPersonaContent('');
      await loadAll();
      flash('Persona profile saved.');
    } catch (err) {
      fail(err);
    }
  }

  async function handleDeletePersona(name: string) {
    try {
      await api.deletePersona(name);
      await loadAll();
      flash(`Persona "${name}" deleted.`);
    } catch (err) {
      fail(err);
    }
  }

  async function handleSaveProfile() {
    try {
      await api.updateProfile({ content: profileText, rules: rulesText });
      flash('User profile & global agent rules saved.');
    } catch (err) {
      fail(err);
    }
  }

  async function handleCreateTask(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedSlug || !newTaskTitle.trim()) return;
    try {
      await api.createTask({ projectSlug: selectedSlug, title: newTaskTitle.trim() });
      setNewTaskTitle('');
      await Promise.all([loadAll(), loadProject(selectedSlug)]);
      flash('Task created.');
    } catch (err) {
      fail(err);
    }
  }

  async function handleTaskStatus(task: TaskItem, status: TaskItem['status']) {
    try {
      await api.updateTask(task.projectSlug, task.id, { status });
      await Promise.all([loadAll(), loadProject(task.projectSlug)]);
    } catch (err) {
      fail(err);
    }
  }

  async function handleCreateNote(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedSlug || !newNoteTitle.trim() || !newNoteSummary.trim()) return;
    try {
      const nextSteps = newNoteNext
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean);
      await api.createNote({
        projectSlug: selectedSlug,
        authorAgent: newNoteAgent.trim() || 'user',
        title: newNoteTitle.trim(),
        summary: newNoteSummary.trim(),
        nextSteps,
      });
      setNewNoteTitle('');
      setNewNoteSummary('');
      setNewNoteNext('');
      await Promise.all([loadAll(), loadProject(selectedSlug)]);
      flash('Handoff note recorded.');
    } catch (err) {
      fail(err);
    }
  }

  async function handleSyncDir(direction: 'import' | 'export', dryRun: boolean) {
    if (!skillsSyncDir.trim()) {
      fail('Enter a local skills directory path first (e.g. ~/.gemini/config/skills).');
      return;
    }
    try {
      const res = await api.syncSkillsDir({ dir: skillsSyncDir.trim(), direction, dryRun });
      setSyncPreview(res);
      if (!dryRun) {
        await loadAll();
        flash(`Skills ${direction} completed (${res.actions.length} item(s)).`);
      } else {
        flash(`Dry-run preview ready (${res.actions.length} skill(s)).`);
      }
    } catch (err) {
      fail(err);
    }
  }

  async function handleRemoveAgent(id: string) {
    try {
      await api.removeConnectedAgent(id);
      await loadAll();
      flash(`Removed "${id}" from connected agents list.`);
    } catch (err) {
      fail(err);
    }
  }

  async function handleSaveCredential(e: React.FormEvent) {
    e.preventDefault();
    if (!credName.trim() || !credValue.trim()) return;
    try {
      const tags = credTags
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean);
      await api.upsertCredential(credName.trim(), {
        value: credValue.trim(),
        service: credService.trim() || credName.trim(),
        envVar: credEnvVar.trim() || undefined,
        tags,
        notes: credNotes.trim() || undefined,
        allowAgentRead: true,
      });
      setCredName('');
      setCredService('');
      setCredEnvVar('');
      setCredValue('');
      setCredTags('');
      setCredNotes('');
      await loadAll();
      flash('Credential encrypted & saved to Vault.');
    } catch (err) {
      fail(err);
    }
  }

  async function handleToggleCredentialAccess(c: CredentialMeta) {
    try {
      await api.upsertCredential(c.name, { allowAgentRead: !c.allowAgentRead });
      await loadAll();
      flash(
        `Credential "${c.name}" is now ${!c.allowAgentRead ? 'readable by private agents' : 'locked'}.`
      );
    } catch (err) {
      fail(err);
    }
  }

  async function handleRevealCredential(name: string) {
    if (revealedSecrets[name]) {
      setRevealedSecrets((prev) => {
        const copy = { ...prev };
        delete copy[name];
        return copy;
      });
      return;
    }
    try {
      const res = await api.revealCredential(name);
      setRevealedSecrets((prev) => ({ ...prev, [name]: res.credential.value }));
    } catch (err) {
      fail(err);
    }
  }

  async function handleDeleteCredential(name: string) {
    try {
      await api.deleteCredential(name);
      await loadAll();
      flash(`Credential "${name}" deleted.`);
    } catch (err) {
      fail(err);
    }
  }

  async function handleStartTunnel() {
    setTunnelBusy(true);
    setErrorMsg('');
    try {
      const res = await api.startTunnel({
        ttlMinutes: tunnelTtl,
        scope: tunnelScope,
        provider: 'cloudflared',
      });
      setTunnel(res);
      flash(`Tunnel active until ${new Date(res.expiresAt ?? '').toLocaleTimeString()}.`);
    } catch (err) {
      fail(err);
    } finally {
      setTunnelBusy(false);
    }
  }

  async function handleStopTunnel() {
    try {
      const res = await api.stopTunnel();
      setTunnel(res);
      flash('Tunnel closed and ephemeral token revoked.');
    } catch (err) {
      fail(err);
    }
  }

  async function copyText(key: string, text: string) {
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
      } else {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.setAttribute('readonly', '');
        ta.style.position = 'fixed';
        ta.style.top = '-9999px';
        ta.style.left = '-9999px';
        document.body.appendChild(ta);
        ta.focus();
        ta.select();
        const ok = document.execCommand('copy');
        document.body.removeChild(ta);
        if (!ok) throw new Error('Clipboard copy failed');
      }
      setCopiedKey(key);
      setTimeout(() => setCopiedKey(''), 2000);
    } catch {
      fail('Browser blocked automatic copy — please select and press Ctrl+C.');
    }
  }

  function downloadMarkdown(filename: string, content: string) {
    const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  const activeTasksCount = allTasks.filter((t) => t.status !== 'done').length;

  const universalMcpUrl = (() => {
    const base = connectorUrl.trim() || 'http://127.0.0.1:4242/mcp';
    try {
      const u = new URL(base);
      if (connectorIdentity.trim()) u.searchParams.set('agent', connectorIdentity.trim());
      if (connectorPersona.trim()) u.searchParams.set('persona', connectorPersona.trim());
      if (connectorTags.trim()) u.searchParams.set('tags', connectorTags.trim());
      return u.toString();
    } catch {
      return base;
    }
  })();

  const universalSnippet =
    snippetFormat === 'yaml'
      ? `mcp_servers:\n  agent-colab:\n    url: "${universalMcpUrl}"`
      : JSON.stringify({ mcpServers: { 'agent-colab': { url: universalMcpUrl } } }, null, 2);

  const shareUrl =
    tunnel.active && tunnel.publicUrl && tunnel.token
      ? `${tunnel.publicUrl}/share/${tunnel.token}/context.md?target=${exportTarget}${
          selectedSlug ? `&project=${encodeURIComponent(selectedSlug)}` : ''
        }`
      : '';

  const remoteMcpUrl =
    tunnel.active && tunnel.publicUrl && tunnel.token
      ? `${tunnel.publicUrl}/mcp?token=${tunnel.token}`
      : '';

  function openView(next: ViewId) {
    setView(next);
    setDrawerOpen(false);
  }

  return (
    <div className="min-h-screen lg:h-screen w-full bg-[#F7F6F3] flex flex-col lg:overflow-hidden relative">
      {/* EXPANDABLE SLIDEBAR DRAWER */}
        {drawerOpen && (
          <div
            onClick={() => setDrawerOpen(false)}
            className="fixed inset-0 bg-slate-950/30 backdrop-blur-[2px] z-40"
          />
        )}
        <aside
          className={`fixed lg:absolute top-0 left-0 bottom-0 w-72 bg-[#F7F6F3] border-r border-white/90 shadow-2xl z-50 transition-transform duration-300 ease-out flex flex-col justify-between p-5 select-none ${
            drawerOpen ? 'translate-x-0' : '-translate-x-full'
          }`}
        >
          <div>
            <div className="flex items-center justify-between pb-4 border-b border-slate-200/70">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-white shadow-pill flex items-center justify-center">
                  <svg width="20" height="20" viewBox="0 0 22 22" fill="none">
                    <circle cx="5.5" cy="14.5" r="3" fill="#F59E0B" />
                    <rect x="10.5" y="6" width="3.5" height="9.5" rx="1.2" fill="#4F46E5" />
                    <rect x="15.5" y="4" width="3.8" height="14" rx="1.2" fill="#111827" />
                  </svg>
                </div>
                <div>
                  <div className="text-[17px] tracking-tight font-bold text-slate-900 leading-none">
                    Agent<span className="text-[#4F46E5]">Colab</span>
                  </div>
                  <span className="text-[10px] font-semibold text-slate-400">
                    Private Vault Hub
                  </span>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setDrawerOpen(false)}
                className="w-8 h-8 rounded-full bg-[#EFECE7] hover:bg-white text-slate-600 flex items-center justify-center saas-transition"
                aria-label="Close sidebar"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Dark Indigo Network Summary Card inside Drawer */}
            <div className="mt-4 bg-[#1E1B4B] text-white rounded-[20px] p-4 shadow-md">
              <div className="flex items-center justify-between text-[10px] text-indigo-200 font-semibold uppercase tracking-wider">
                <span>Network Mode</span>
                <span
                  className={`px-2 py-0.5 rounded-full ${
                    tunnel.active
                      ? 'bg-emerald-500/20 text-emerald-300'
                      : 'bg-white/10 text-amber-300'
                  }`}
                >
                  {tunnel.active ? 'Tunnel Live' : 'Private'}
                </span>
              </div>
              <p className="text-base font-bold tracking-tight mt-1.5">
                {projects.length} Projects · {skills.length} Skills
              </p>
              <div className="mt-2.5 pt-2 border-t border-white/10 flex items-center justify-between text-[11px] text-indigo-200">
                <span>{activeTasksCount} Open Tasks</span>
                <button
                  type="button"
                  onClick={() => openView('bridge')}
                  className="text-white font-semibold hover:underline"
                >
                  Tunnel →
                </button>
              </div>
            </div>

            {/* Slidebar Nav Items */}
            <div className="mt-4 space-y-1">
              <p className="px-2.5 text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">
                Workspace
              </p>
              {(
                [
                  ['dashboard', 'Overview & Context', Home, `${projects.length}`],
                  ['agents', 'Connected Agents', Cpu, `${connectedAgents.length}`],
                  ['credentials', 'Credentials Vault', KeyRound, `${credentials.length}`],
                  ['collab', 'Collaboration & Handoffs', MessageSquare, `${allNotes.length}`],
                  ['sync', 'Universal Connector', Layers, `${skills.length}`],
                  ['bridge', 'Web Bridge & Tunnel', Globe, tunnel.active ? 'ON' : 'OFF'],
                  ['search', 'Vault Search (FTS5)', Search, '/'],
                  ['profile', 'User Profile & Rules', Settings, 'Vault'],
                ] as const
              ).map(([id, label, Icon, badge]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => openView(id)}
                  className={`w-full flex items-center justify-between px-3 py-2.5 rounded-2xl text-xs font-semibold saas-transition ${
                    view === id
                      ? 'bg-slate-900 text-white'
                      : 'text-slate-700 hover:bg-white'
                  }`}
                >
                  <span className="flex items-center gap-2.5">
                    <Icon
                      className={`w-4 h-4 ${
                        view === id ? 'text-white' : 'text-[#4F46E5]'
                      }`}
                    />
                    <span>{label}</span>
                  </span>
                  <span
                    className={`text-[10px] px-2 py-0.5 rounded-full ${
                      view === id
                        ? 'bg-white/20 text-white'
                        : 'bg-[#EFECE7] text-slate-600'
                    }`}
                  >
                    {badge}
                  </span>
                </button>
              ))}
            </div>
          </div>

          <div className="pt-3 border-t border-slate-200/70">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
              Vault Path
            </p>
            <p className="mt-1 text-[11px] font-mono text-slate-600 break-all">
              {vaultPath || '~/.agent-colab/vault'}
            </p>
          </div>
        </aside>

        {/* STICKY TOP NAVIGATION BAR */}
        <header className="sticky top-0 z-30 bg-[#F7F6F3]/95 backdrop-blur-md px-4 sm:px-7 pt-4 pb-3 flex items-center justify-between gap-3">
          {/* Left: Mobile trigger + Logo + Brand */}
          <div className="flex items-center gap-3 shrink-0">
            <button
              type="button"
              onClick={() => setDrawerOpen(true)}
              className="lg:hidden w-10 h-10 rounded-full bg-[#EFECE7] hover:bg-white flex items-center justify-center text-slate-700 shadow-pill saas-transition"
              aria-label="Open menu"
            >
              <Menu className="w-5 h-5" />
            </button>

            <button
              type="button"
              onClick={() => openView('dashboard')}
              className="w-11 h-11 rounded-full bg-white shadow-pill flex items-center justify-center hover:scale-105 saas-transition"
              title="Agent Colab Home"
            >
              <svg width="20" height="20" viewBox="0 0 22 22" fill="none">
                <circle cx="5.5" cy="14.5" r="3" fill="#F59E0B" />
                <rect x="10.5" y="6" width="3.5" height="9.5" rx="1.2" fill="#4F46E5" />
                <rect x="15.5" y="4" width="3.8" height="14" rx="1.2" fill="#111827" />
              </svg>
            </button>

            <button
              type="button"
              onClick={() => openView('dashboard')}
              className="text-[19px] tracking-tight font-semibold text-slate-900 flex items-center select-none"
            >
              <span>Agent</span>
              <span className="text-[#4F46E5] font-bold">Colab</span>
            </button>
          </div>

          {/* Center: 4 Floating Pill Tabs */}
          <nav className="hidden md:flex items-center gap-2.5" aria-label="Main">
            {(
              [
                ['dashboard', 'Dashboard', Home],
                ['agents', 'Agents', Cpu],
                ['collab', 'Collaboration', MessageSquare],
                ['sync', 'Connector & Skills', Layers],
                ['bridge', 'Web Bridge', Globe],
              ] as const
            ).map(([id, label, Icon]) => {
              const active = view === id;
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => openView(id)}
                  className={`rounded-full pl-1.5 pr-4 py-1.5 flex items-center gap-2.5 text-[13px] saas-transition ${
                    active
                      ? 'bg-white text-slate-900 font-semibold shadow-pill'
                      : 'bg-[#EFECE7] hover:bg-white/80 text-slate-600 font-medium'
                  }`}
                >
                  <span
                    className={`w-7 h-7 rounded-full flex items-center justify-center saas-transition ${
                      active
                        ? 'bg-slate-900 text-white'
                        : 'bg-white text-slate-700 shadow-sm'
                    }`}
                  >
                    <Icon className="w-3.5 h-3.5" />
                  </span>
                  <span>{label}</span>
                </button>
              );
            })}
          </nav>

          {/* Right: Network status pill + Refresh + Profile */}
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => openView('bridge')}
              className={`hidden sm:flex items-center gap-2 rounded-full px-3.5 py-2 text-xs font-semibold saas-transition ${
                tunnel.active
                  ? 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200'
                  : 'bg-[#EFECE7] text-slate-700 hover:bg-white'
              }`}
            >
              <span
                className={`w-2 h-2 rounded-full ${
                  tunnel.active ? 'bg-emerald-500' : 'bg-slate-400'
                }`}
              />
              <span>{tunnel.active ? 'Tunnel Live' : 'Private Net'}</span>
            </button>

            <button
              type="button"
              onClick={() => void loadAll()}
              className="w-10 h-10 rounded-full bg-[#EFECE7] hover:bg-white flex items-center justify-center text-slate-700 hover:text-[#4F46E5] saas-transition"
              title="Refresh vault"
            >
              <RefreshCw className="w-4 h-4" />
            </button>

            <button
              type="button"
              onClick={() => openView('profile')}
              className={`w-10 h-10 rounded-full flex items-center justify-center text-xs font-bold saas-transition ${
                view === 'profile'
                  ? 'bg-[#4F46E5] text-white shadow-indigo-glow'
                  : 'bg-slate-900 text-white hover:bg-[#4F46E5]'
              }`}
              title="User Profile & Global Rules"
              aria-label="User Profile & Global Rules"
            >
              <User className="w-4 h-4" />
            </button>
          </div>
        </header>

        {/* WORKSPACE BODY: LEFT FLOATING SIDEBAR RAIL + SCROLLABLE CONTENT */}
        <div className="flex-1 flex overflow-hidden px-4 sm:px-7 pb-5 pt-2 gap-4 lg:gap-6 relative">
          {/* LEFT FLOATING SIDEBAR RAIL */}
          <aside className="hidden lg:flex w-12 shrink-0 flex-col items-center justify-between py-1 select-none z-20">
            {/* Top Hamburger */}
            <button
              type="button"
              onClick={() => setDrawerOpen(true)}
              className="w-11 h-11 rounded-full bg-[#EFECE7] hover:bg-white text-slate-700 hover:text-[#4F46E5] flex items-center justify-center shadow-sm saas-transition relative group"
              title="Open Slidebar Menu"
            >
              <Menu className="w-[18px] h-[18px]" />
              <span className="pointer-events-none opacity-0 group-hover:opacity-100 absolute left-14 bg-slate-900 text-white text-[11px] font-semibold px-2.5 py-1 rounded-lg whitespace-nowrap shadow-md saas-transition z-40">
                Slidebar Menu
              </span>
            </button>

            {/* Middle Vertical Pill Capsule */}
            <div className="bg-[#EFECE7] p-1.5 rounded-full shadow-inner">
              <div className="bg-white rounded-full py-2.5 px-1.5 flex flex-col items-center gap-3 shadow-pill">
                {(
                  [
                    ['search', 'Vault Search (FTS5)', Search],
                    ['agents', 'Connected Agents', Cpu],
                    ['credentials', 'Credentials Vault', KeyRound],
                    ['collab', 'Agent Handoffs', MessageSquare],
                    ['dashboard', 'Project Contexts', FolderGit2],
                    ['sync', 'Universal Connector', Layers],
                    ['bridge', 'Tunnel & Security', Shield],
                  ] as const
                ).map(([id, title, Icon]) => {
                  const active = view === id;
                  return (
                    <button
                      key={id}
                      type="button"
                      onClick={() => openView(id)}
                      className={`w-8 h-8 rounded-full flex items-center justify-center saas-transition relative group ${
                        active
                          ? 'bg-[#4F46E5] text-white shadow-sm'
                          : 'text-slate-600 hover:bg-indigo-50 hover:text-[#4F46E5]'
                      }`}
                      title={title}
                    >
                      <Icon className="w-4 h-4" />
                      <span className="pointer-events-none opacity-0 group-hover:opacity-100 absolute left-12 bg-slate-900 text-white text-[11px] font-semibold px-2.5 py-1 rounded-lg whitespace-nowrap shadow-md saas-transition z-40">
                        {title}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Bottom Profile / Rules Button */}
            <button
              type="button"
              onClick={() => openView('profile')}
              className={`w-11 h-11 rounded-full flex items-center justify-center shadow-sm saas-transition relative group ${
                view === 'profile'
                  ? 'bg-slate-900 text-white'
                  : 'bg-[#EFECE7] hover:bg-white text-slate-700 hover:text-[#4F46E5]'
              }`}
              title="User Profile & Global Rules"
            >
              <Settings className="w-[18px] h-[18px]" />
              <span className="pointer-events-none opacity-0 group-hover:opacity-100 absolute left-14 bg-slate-900 text-white text-[11px] font-semibold px-2.5 py-1 rounded-lg whitespace-nowrap shadow-md saas-transition z-40">
                Profile & Rules
              </span>
            </button>
          </aside>

          {/* MAIN SCROLLABLE CONTENT */}
          <main className="flex-1 overflow-y-auto pr-0.5 sm:pr-1.5 space-y-5">
            {(statusMsg || errorMsg) && (
              <div
                className={`rounded-[18px] px-4 py-3 text-xs font-medium flex items-center justify-between ${
                  errorMsg
                    ? 'bg-rose-50 text-rose-800 border border-rose-200'
                    : 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                }`}
              >
                <span>{errorMsg || statusMsg}</span>
                <button
                  type="button"
                  onClick={() => {
                    setStatusMsg('');
                    setErrorMsg('');
                  }}
                  className="ml-4 opacity-70 hover:opacity-100"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            )}

            {/* ============================================================= */}
            {/* VIEW 1: MAIN DASHBOARD OVERVIEW                               */}
            {/* ============================================================= */}
            {view === 'dashboard' && (
              <div className="space-y-5">
                {/* Hero Header Row */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pt-1">
                  <div>
                    <h1 className="text-2xl sm:text-[28px] font-bold tracking-tight text-slate-900">
                      Agent Colab Hub
                    </h1>
                    <p className="text-xs sm:text-[13px] text-slate-500 mt-0.5">
                      Centralized context, handoffs, and skill sync across Antigravity, Hermes,
                      Claude Code, OpenClaw, Cursor & Web AI.
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2.5">
                    <button
                      type="button"
                      onClick={() => openView('search')}
                      className="rounded-full bg-white hover:bg-[#EFECE7] text-slate-700 px-4 py-2.5 text-xs font-semibold shadow-pill flex items-center gap-2 saas-transition"
                    >
                      <SlidersHorizontal className="w-3.5 h-3.5" />
                      <span>Search Vault</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => openView('bridge')}
                      className="rounded-full bg-white hover:bg-[#EFECE7] text-slate-700 px-4 py-2.5 text-xs font-semibold shadow-pill flex items-center gap-2 saas-transition"
                    >
                      <Download className="w-3.5 h-3.5" />
                      <span>Export Pack</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setNewProjectModal(true)}
                      className="rounded-full bg-[#4F46E5] hover:bg-[#4338CA] text-white px-5 py-2.5 text-xs font-semibold shadow-indigo-glow flex items-center gap-1.5 saas-transition"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>New Project</span>
                    </button>
                  </div>
                </div>

                {/* 2-Column Asymmetric Grid matching HeroesIQ rhythm */}
                <div className="grid grid-cols-1 xl:grid-cols-12 gap-5">
                  {/* LEFT COLUMN (5 cols): Active Project Context + Agent Adapter Cards */}
                  <div className="xl:col-span-5 space-y-5">
                    {/* Summary / Context Card */}
                    <div className="bg-[#EFECE7] rounded-[26px] p-5">
                      <div className="flex items-center justify-between gap-2 mb-4">
                        <div>
                          <h2 className="text-[15px] font-bold text-slate-900">Project Context</h2>
                          <p className="text-xs text-slate-500">
                            Shared Markdown loaded by every connected agent.
                          </p>
                        </div>
                        <select
                          value={selectedSlug}
                          onChange={(e) => setSelectedSlug(e.target.value)}
                          className="rounded-full bg-white px-3.5 py-1.5 text-xs font-semibold text-slate-700 shadow-pill focus:outline-none"
                        >
                          {projects.length === 0 && <option value="">No projects</option>}
                          {projects.map((p) => (
                            <option key={p.slug} value={p.slug}>
                              {p.name}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div className="bg-white rounded-[20px] p-4 shadow-sm">
                        {projectDetail ? (
                          <>
                            <div className="flex items-center justify-between pb-3 mb-3 border-b border-slate-100">
                              <div>
                                <span className="text-[11px] font-medium text-slate-400">
                                  projects/{projectDetail.slug}/context.md
                                </span>
                                <p className="text-sm font-bold text-slate-900">
                                  {projectDetail.name}
                                </p>
                              </div>
                              <button
                                type="button"
                                onClick={() => void handleSaveProject()}
                                className="rounded-full bg-slate-900 hover:bg-[#4F46E5] text-white px-3.5 py-1.5 text-[11px] font-semibold saas-transition"
                              >
                                Save
                              </button>
                            </div>
                            <div className="mb-3 space-y-2.5 pb-3 border-b border-slate-100">
                              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                <div>
                                  <label className="block text-[11px] font-semibold text-slate-500 mb-1">
                                    Workspace Folder (repoPath)
                                  </label>
                                  <input
                                    type="text"
                                    value={projRepoDraft}
                                    onChange={(e) => setProjRepoDraft(e.target.value)}
                                    placeholder="e.g. /srv/repos/my-app"
                                    className="w-full rounded-xl bg-[#F7F6F3] px-3 py-2 font-mono text-[11px] text-slate-800 focus:outline-none focus:ring-2 focus:ring-[#4F46E5]/30"
                                  />
                                </div>
                                <div>
                                  <label className="block text-[11px] font-semibold text-slate-500 mb-1">
                                    Tags (for multi-profile scope)
                                  </label>
                                  <input
                                    type="text"
                                    value={projTagsDraft}
                                    onChange={(e) => setProjTagsDraft(e.target.value)}
                                    placeholder="e.g. work, backend"
                                    className="w-full rounded-xl bg-[#F7F6F3] px-3 py-2 text-[11px] text-slate-800 focus:outline-none focus:ring-2 focus:ring-[#4F46E5]/30"
                                  />
                                </div>
                              </div>
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <span className="text-[11px] font-semibold text-slate-500">
                                  AI Coding Permission
                                </span>
                                <div className="inline-flex rounded-full bg-[#EFECE7] p-0.5">
                                  {(
                                    [
                                      ['disabled', 'Disabled'],
                                      ['read-only', 'Read-Only'],
                                      ['full', 'Full Access'],
                                    ] as const
                                  ).map(([mode, label]) => (
                                    <button
                                      key={mode}
                                      type="button"
                                      onClick={() => setProjAccessDraft(mode)}
                                      className={`rounded-full px-2.5 py-1 text-[11px] font-semibold saas-transition ${
                                        projAccessDraft === mode
                                          ? mode === 'full'
                                            ? 'bg-[#4F46E5] text-white'
                                            : 'bg-slate-900 text-white'
                                          : 'text-slate-600 hover:text-slate-900'
                                      }`}
                                    >
                                      {label}
                                    </button>
                                  ))}
                                </div>
                              </div>
                            </div>

                            <textarea
                              value={projContentDraft}
                              onChange={(e) => setProjContentDraft(e.target.value)}
                              rows={6}
                              className="w-full bg-[#F7F6F3] rounded-2xl p-3 font-mono text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-[#4F46E5]/30"
                            />
                          </>
                        ) : (
                          <div className="py-8 text-center">
                            <p className="text-sm font-semibold text-slate-700">
                              No projects in your Vault yet
                            </p>
                            <p className="text-xs text-slate-500 mt-1">
                              Create a project so Antigravity, Hermes, Claude, and Gemini share the
                              same context.
                            </p>
                            <button
                              type="button"
                              onClick={() => setNewProjectModal(true)}
                              className="mt-4 rounded-full bg-[#4F46E5] text-white px-4 py-2 text-xs font-semibold shadow-indigo-glow"
                            >
                              + Create First Project
                            </button>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* 2 Universal Connector Mini-Cards */}
                    <div className="grid grid-cols-2 gap-4">
                      <button
                        type="button"
                        onClick={() => openView('sync')}
                        className="bg-[#EFECE7] hover:bg-[#E8E5DF] rounded-[24px] p-4 text-left saas-transition"
                      >
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-semibold text-slate-600">
                            Universal MCP
                          </span>
                          <span className="w-2.5 h-2.5 rounded-full bg-[#10B981]" />
                        </div>
                        <p className="mt-3 text-lg font-bold text-slate-900">1 Endpoint</p>
                        <p className="text-[11px] text-slate-500 mt-0.5">
                          Auto-detects any agent →
                        </p>
                      </button>

                      <button
                        type="button"
                        onClick={() => openView('agents')}
                        className="bg-[#EFECE7] hover:bg-[#E8E5DF] rounded-[24px] p-4 text-left saas-transition"
                      >
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-semibold text-slate-600">
                            Connected Agents
                          </span>
                          <span
                            className={`w-2.5 h-2.5 rounded-full ${
                              connectedAgents.length > 0 ? 'bg-[#4F46E5]' : 'bg-slate-300'
                            }`}
                          />
                        </div>
                        <p className="mt-3 text-lg font-bold text-slate-900">
                          {connectedAgents.length} Detected
                        </p>
                        <p className="text-[11px] text-slate-500 mt-0.5">
                          View live registry →
                        </p>
                      </button>
                    </div>

                    {/* Bottom Quick Action Pill Banner */}
                    <div className="bg-[#EFECE7] rounded-[24px] p-2">
                      <div className="bg-white rounded-[18px] px-4 py-3.5 flex items-center justify-between gap-3">
                        <p className="text-xs font-semibold text-slate-700">
                          Switching to Claude Chat or Gemini Web? Export a 1-click Context Pack.
                        </p>
                        <button
                          type="button"
                          onClick={() => openView('bridge')}
                          className="shrink-0 w-8 h-8 rounded-full bg-[#EFECE7] hover:bg-[#4F46E5] hover:text-white text-slate-700 flex items-center justify-center saas-transition"
                          aria-label="Open Web Bridge"
                        >
                          <ArrowUpRight className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* RIGHT COLUMN (7 cols): 3-Card Status Strip + Handoff Activity Table */}
                  <div className="xl:col-span-7 space-y-5">
                    {/* 3-Card Activity & Network Strip */}
                    <div className="bg-[#EFECE7] rounded-[26px] p-5">
                      <div className="flex items-center justify-between mb-4">
                        <div>
                          <h2 className="text-[15px] font-bold text-slate-900">
                            Workspace Activity
                          </h2>
                          <p className="text-xs text-slate-500">
                            Live counts from your local Markdown Vault and SQLite FTS5 index.
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => openView('collab')}
                          className="w-9 h-9 rounded-full bg-white hover:bg-slate-900 hover:text-white text-slate-700 flex items-center justify-center shadow-pill saas-transition"
                          title="Open Collaboration Board"
                        >
                          <ArrowUpRight className="w-4 h-4" />
                        </button>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
                        {/* Card 1: Projects & Tasks */}
                        <button
                          type="button"
                          onClick={() => openView('collab')}
                          className="bg-white rounded-[20px] p-4 text-left shadow-sm hover:shadow-md saas-transition flex flex-col justify-between min-h-[148px]"
                        >
                          <div className="flex items-center gap-2 text-xs font-semibold text-slate-600">
                            <span className="w-7 h-7 rounded-full bg-[#EFECE7] flex items-center justify-center text-slate-700">
                              <FolderGit2 className="w-3.5 h-3.5" />
                            </span>
                            <span>Active Tasks</span>
                          </div>
                          <div>
                            <p className="text-2xl font-bold text-slate-900">{activeTasksCount}</p>
                            <p className="text-[11px] text-slate-500 mt-1">
                              Across {projects.length} project(s)
                            </p>
                          </div>
                        </button>

                        {/* Card 2: Shared Skills */}
                        <button
                          type="button"
                          onClick={() => openView('sync')}
                          className="bg-white rounded-[20px] p-4 text-left shadow-sm hover:shadow-md saas-transition flex flex-col justify-between min-h-[148px]"
                        >
                          <div className="flex items-center gap-2 text-xs font-semibold text-slate-600">
                            <span className="w-7 h-7 rounded-full bg-[#EFECE7] flex items-center justify-center text-slate-700">
                              <Layers className="w-3.5 h-3.5" />
                            </span>
                            <span>Vault Skills</span>
                          </div>
                          <div>
                            <p className="text-2xl font-bold text-slate-900">{skills.length}</p>
                            <p className="text-[11px] text-slate-500 mt-1">
                              Shared SKILL.md bundles
                            </p>
                          </div>
                        </button>

                        {/* Card 3: Dark Indigo Featured Card — On-Demand Tunnel */}
                        <button
                          type="button"
                          onClick={() => openView('bridge')}
                          className="bg-[#1E1B4B] text-white rounded-[20px] p-4 text-left shadow-md hover:brightness-110 saas-transition flex flex-col justify-between min-h-[148px]"
                        >
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2 text-xs font-semibold text-indigo-100">
                              <span className="w-7 h-7 rounded-full bg-white/10 flex items-center justify-center">
                                <Globe className="w-3.5 h-3.5 text-amber-400" />
                              </span>
                              <span>Public Tunnel</span>
                            </div>
                          </div>
                          <div>
                            <p className="text-xl font-bold">
                              {tunnel.active ? 'Active' : 'Private Only'}
                            </p>
                            <p className="text-[11px] text-indigo-200 mt-1">
                              {tunnel.active
                                ? `Scope: ${tunnel.scope}`
                                : 'Off by default · Click to open'}
                            </p>
                          </div>
                        </button>
                      </div>
                    </div>

                    {/* Recent Handoff Notes & Activity Table */}
                    <div className="bg-[#EFECE7] rounded-[26px] p-5">
                      <div className="flex items-center justify-between mb-4">
                        <div>
                          <h2 className="text-[15px] font-bold text-slate-900">
                            Recent Agent Handoffs
                          </h2>
                          <p className="text-xs text-slate-500">
                            Latest notes left by Antigravity, Hermes, or manual updates.
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => openView('collab')}
                          className="rounded-full bg-white hover:bg-slate-900 hover:text-white text-slate-700 px-3.5 py-1.5 text-xs font-semibold shadow-pill saas-transition"
                        >
                          + Add Note
                        </button>
                      </div>

                      <div className="bg-white rounded-[20px] overflow-hidden shadow-sm">
                        {allNotes.length === 0 ? (
                          <div className="p-8 text-center">
                            <p className="text-sm font-semibold text-slate-700">
                              No handoff notes yet
                            </p>
                            <p className="text-xs text-slate-500 mt-1">
                              When an agent calls{' '}
                              <code className="bg-[#F7F6F3] px-1.5 py-0.5 rounded">
                                leave_handoff_note
                              </code>{' '}
                              or you post one in Collaboration, it appears here.
                            </p>
                          </div>
                        ) : (
                          <div className="overflow-x-auto">
                            <table className="w-full text-left text-xs">
                              <thead className="border-b border-slate-100 text-[11px] text-slate-400 font-semibold">
                                <tr>
                                  <th className="py-3 px-4">Agent & Note</th>
                                  <th className="py-3 px-4">Project</th>
                                  <th className="py-3 px-4">Next Steps</th>
                                  <th className="py-3 px-4 text-right">Time</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-slate-100">
                                {allNotes.slice(0, 6).map((note) => (
                                  <tr
                                    key={note.id}
                                    className="hover:bg-[#F7F6F3]/70 saas-transition"
                                  >
                                    <td className="py-3 px-4">
                                      <p className="font-semibold text-slate-900">{note.title}</p>
                                      <p className="text-[11px] text-slate-500 line-clamp-1">
                                        {note.summary}
                                      </p>
                                    </td>
                                    <td className="py-3 px-4">
                                      <span className="inline-flex items-center gap-1.5 rounded-full bg-indigo-50 text-[#4F46E5] px-2.5 py-0.5 font-semibold text-[11px]">
                                        {note.projectSlug}
                                      </span>
                                    </td>
                                    <td className="py-3 px-4">
                                      <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 text-emerald-700 px-2.5 py-0.5 font-semibold text-[11px]">
                                        {note.authorAgent}
                                      </span>
                                    </td>
                                    <td className="py-3 px-4 text-right text-slate-500 whitespace-nowrap">
                                      {new Date(note.createdAt).toLocaleDateString()}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* ============================================================= */}
            {/* VIEW 1.5: DEDICATED CONNECTED AGENTS PAGE                     */}
            {/* ============================================================= */}
            {view === 'agents' && (() => {
              const nowMs = Date.now();
              const isRecent = (iso: string) => nowMs - new Date(iso).getTime() < 15 * 60_000;
              const activeNowCount = connectedAgents.filter((a) => isRecent(a.lastSeen)).length;
              const totalReqs = connectedAgents.reduce((acc, a) => acc + a.requestCount, 0);
              const viaTunnelCount = connectedAgents.filter((a) => a.via === 'tunnel').length;

              return (
                <div className="space-y-5">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <h1 className="text-2xl font-bold tracking-tight text-slate-900">
                        Connected Agents
                      </h1>
                      <p className="text-xs text-slate-500">
                        Every AI agent & device automatically detected through the Universal MCP
                        endpoint.
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => void loadAll()}
                        className="rounded-full bg-white hover:bg-[#EFECE7] text-slate-700 px-4 py-2 text-xs font-semibold shadow-pill flex items-center gap-1.5 saas-transition"
                      >
                        <RefreshCw className="w-3.5 h-3.5" />
                        Refresh
                      </button>
                      <button
                        type="button"
                        onClick={() => openView('sync')}
                        className="rounded-full bg-[#4F46E5] hover:bg-[#4338CA] text-white px-4 py-2 text-xs font-semibold shadow-indigo-glow saas-transition"
                      >
                        + Connect New Agent
                      </button>
                    </div>
                  </div>

                  {/* Summary Strip */}
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <div className="bg-[#EFECE7] rounded-[24px] p-4">
                      <div className="bg-white rounded-[18px] p-4 shadow-sm">
                        <span className="text-xs font-semibold text-slate-500">
                          Auto-Detected Agents
                        </span>
                        <p className="mt-2 text-2xl font-bold text-slate-900">
                          {connectedAgents.length}
                        </p>
                        <p className="text-[11px] text-emerald-700 mt-0.5">
                          {activeNowCount} active in last 15 min
                        </p>
                      </div>
                    </div>

                    <div className="bg-[#EFECE7] rounded-[24px] p-4">
                      <div className="bg-white rounded-[18px] p-4 shadow-sm">
                        <span className="text-xs font-semibold text-slate-500">
                          Total MCP Requests
                        </span>
                        <p className="mt-2 text-2xl font-bold text-slate-900">{totalReqs}</p>
                        <p className="text-[11px] text-slate-500 mt-0.5">
                          Recorded across all devices
                        </p>
                      </div>
                    </div>

                    <div className="bg-[#EFECE7] rounded-[24px] p-4">
                      <div className="bg-[#1E1B4B] text-white rounded-[18px] p-4 shadow-sm">
                        <span className="text-xs font-semibold text-indigo-200">
                          Transport Breakdown
                        </span>
                        <p className="mt-2 text-2xl font-bold">
                          {connectedAgents.length - viaTunnelCount} Private · {viaTunnelCount}{' '}
                          Tunnel
                        </p>
                        <p className="text-[11px] text-indigo-200 mt-0.5">
                          Tailnet / LAN vs On-Demand Tunnel
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* Connected Agents Grid */}
                  <div className="bg-[#EFECE7] rounded-[26px] p-5 space-y-4">
                    <h2 className="text-[15px] font-bold text-slate-900">
                      Registered Agents & Devices ({connectedAgents.length})
                    </h2>

                    {connectedAgents.length === 0 ? (
                      <div className="bg-white rounded-[20px] p-8 text-center shadow-sm">
                        <p className="text-sm font-bold text-slate-800">
                          No agents connected yet
                        </p>
                        <p className="text-xs text-slate-500 mt-1 max-w-md mx-auto">
                          Point Antigravity, Hermes, Claude Code, OpenClaw, Cursor, or any MCP
                          client to your Universal MCP URL. As soon as it connects, it appears here
                          automatically.
                        </p>
                        <button
                          type="button"
                          onClick={() => openView('sync')}
                          className="mt-4 rounded-full bg-[#4F46E5] text-white px-5 py-2 text-xs font-semibold shadow-indigo-glow"
                        >
                          Open Universal Connector
                        </button>
                      </div>
                    ) : (
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {connectedAgents.map((ag) => {
                          const recent = isRecent(ag.lastSeen);
                          const agentLogs = auditLogs
                            .filter((l) => l.actor === ag.id || l.actor === ag.clientName)
                            .slice(0, 3);
                          return (
                            <div
                              key={ag.id}
                              className="bg-white rounded-[20px] p-5 shadow-sm flex flex-col justify-between gap-3"
                            >
                              <div>
                                <div className="flex items-start justify-between gap-2">
                                  <div className="min-w-0">
                                    <div className="flex items-center gap-2 flex-wrap">
                                      <span
                                        className={`w-2.5 h-2.5 rounded-full shrink-0 ${
                                          recent ? 'bg-[#10B981]' : 'bg-slate-300'
                                        }`}
                                      />
                                      <h3 className="text-sm font-bold text-slate-900 break-all">
                                        {ag.id}
                                      </h3>
                                      {ag.clientVersion && (
                                        <span className="text-[11px] font-mono text-slate-400">
                                          v{ag.clientVersion}
                                        </span>
                                      )}
                                    </div>
                                    <p className="text-[11px] text-slate-500 mt-0.5">
                                      Client: <span className="font-mono">{ag.clientName}</span> ·{' '}
                                      {recent ? 'Active recently' : 'Idle'}
                                    </p>
                                  </div>
                                  <button
                                    type="button"
                                    onClick={() => void handleRemoveAgent(ag.id)}
                                    className="p-1.5 rounded-full text-slate-400 hover:text-rose-600 hover:bg-rose-50 shrink-0"
                                    title="Remove agent"
                                  >
                                    <X className="w-4 h-4" />
                                  </button>
                                </div>

                                <div className="mt-3 flex flex-wrap gap-1.5 text-[11px]">
                                  <span className="rounded-full bg-emerald-50 text-emerald-700 px-2.5 py-0.5 font-semibold">
                                    via: {ag.via}
                                  </span>
                                  <span className="rounded-full bg-[#F7F6F3] text-slate-700 px-2.5 py-0.5 font-semibold">
                                    {ag.requestCount} requests
                                  </span>
                                  {ag.persona && (
                                    <span className="rounded-full bg-indigo-50 text-[#4F46E5] px-2.5 py-0.5 font-semibold">
                                      persona: {ag.persona}
                                    </span>
                                  )}
                                  {ag.tagScope && (
                                    <span className="rounded-full bg-amber-50 text-amber-700 px-2.5 py-0.5 font-semibold">
                                      tags: {ag.tagScope}
                                    </span>
                                  )}
                                </div>

                                {agentLogs.length > 0 && (
                                  <div className="mt-3 pt-3 border-t border-slate-100 space-y-1">
                                    <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                                      Recent Activity
                                    </p>
                                    {agentLogs.map((log) => (
                                      <p
                                        key={log.id}
                                        className="text-[11px] text-slate-600 truncate"
                                      >
                                        <span className="font-mono text-[#4F46E5]">
                                          {log.action}
                                        </span>{' '}
                                        · {log.resource}
                                      </p>
                                    ))}
                                  </div>
                                )}
                              </div>

                              <div className="pt-2 border-t border-slate-100 flex items-center justify-between text-[11px] text-slate-400">
                                <span>First: {new Date(ag.firstSeen).toLocaleDateString()}</span>
                                <span>Last: {new Date(ag.lastSeen).toLocaleString()}</span>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  {/* Live Global Activity Feed */}
                  <div className="bg-[#EFECE7] rounded-[26px] p-5 space-y-3">
                    <div className="flex items-center gap-2">
                      <Activity className="w-4 h-4 text-[#4F46E5]" />
                      <h2 className="text-[15px] font-bold text-slate-900">
                        Live Agent Activity Log ({auditLogs.length})
                      </h2>
                    </div>
                    <div className="bg-white rounded-[20px] overflow-hidden shadow-sm">
                      {auditLogs.length === 0 ? (
                        <p className="p-6 text-xs text-slate-500 text-center">
                          No agent activity recorded yet.
                        </p>
                      ) : (
                        <div className="overflow-x-auto">
                          <table className="w-full text-left text-xs">
                            <thead className="border-b border-slate-100 text-[11px] text-slate-400 font-semibold">
                              <tr>
                                <th className="py-2.5 px-4">Actor</th>
                                <th className="py-2.5 px-4">Action</th>
                                <th className="py-2.5 px-4">Resource</th>
                                <th className="py-2.5 px-4">Via</th>
                                <th className="py-2.5 px-4 text-right">Time</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                              {auditLogs.slice(0, 15).map((log) => (
                                <tr key={log.id} className="hover:bg-[#F7F6F3]/60">
                                  <td className="py-2.5 px-4 font-semibold text-slate-900">
                                    {log.actor}
                                  </td>
                                  <td className="py-2.5 px-4 font-mono text-[11px] text-[#4F46E5]">
                                    {log.action}
                                  </td>
                                  <td className="py-2.5 px-4 text-slate-600">{log.resource}</td>
                                  <td className="py-2.5 px-4">
                                    <span className="rounded-full bg-[#F7F6F3] px-2 py-0.5 text-[10px] font-semibold text-slate-600">
                                      {log.via}
                                    </span>
                                  </td>
                                  <td className="py-2.5 px-4 text-right text-slate-400 whitespace-nowrap">
                                    {new Date(log.timestamp).toLocaleTimeString()}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })()}

            {/* ============================================================= */}
            {/* VIEW 2: COLLABORATION (TASKS & HANDOFF NOTES)                 */}
            {/* ============================================================= */}
            {view === 'collab' && (
              <div className="space-y-5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h1 className="text-2xl font-bold tracking-tight text-slate-900">
                      Collaboration & Handoffs
                    </h1>
                    <p className="text-xs text-slate-500">
                      Shared task locks and chronological handoff notes between agents.
                    </p>
                  </div>
                  <select
                    value={selectedSlug}
                    onChange={(e) => setSelectedSlug(e.target.value)}
                    className="rounded-full bg-white px-4 py-2 text-xs font-semibold text-slate-800 shadow-pill"
                  >
                    {projects.length === 0 && <option value="">No projects yet</option>}
                    {projects.map((p) => (
                      <option key={p.slug} value={p.slug}>
                        {p.name} ({p.slug})
                      </option>
                    ))}
                  </select>
                </div>

                {!selectedSlug ? (
                  <div className="bg-[#EFECE7] rounded-[26px] p-8 text-center">
                    <p className="text-sm font-semibold text-slate-700">
                      Create a project first to collaborate on tasks and handoff notes.
                    </p>
                    <button
                      type="button"
                      onClick={() => setNewProjectModal(true)}
                      className="mt-3 rounded-full bg-[#4F46E5] text-white px-5 py-2 text-xs font-semibold shadow-indigo-glow"
                    >
                      + New Project
                    </button>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
                    {/* Tasks */}
                    <div className="lg:col-span-5 bg-[#EFECE7] rounded-[26px] p-5 space-y-4">
                      <h2 className="text-[15px] font-bold text-slate-900">
                        Shared Tasks ({projectTasks.length})
                      </h2>
                      <form onSubmit={(e) => void handleCreateTask(e)} className="flex gap-2">
                        <input
                          type="text"
                          value={newTaskTitle}
                          onChange={(e) => setNewTaskTitle(e.target.value)}
                          placeholder="Add task for Antigravity or Hermes..."
                          className="min-w-0 flex-1 rounded-full bg-white px-4 py-2.5 text-xs text-slate-800 shadow-sm focus:outline-none focus:ring-2 focus:ring-[#4F46E5]/30"
                        />
                        <button
                          type="submit"
                          className="rounded-full bg-[#4F46E5] hover:bg-[#4338CA] text-white px-4 py-2.5 text-xs font-semibold shadow-indigo-glow"
                        >
                          Add
                        </button>
                      </form>

                      <div className="space-y-2.5">
                        {projectTasks.length === 0 ? (
                          <div className="bg-white rounded-[18px] p-5 text-xs text-slate-500">
                            No tasks yet for this project.
                          </div>
                        ) : (
                          projectTasks.map((t) => (
                            <div
                              key={t.id}
                              className="bg-white rounded-[18px] p-3.5 shadow-sm flex items-start justify-between gap-2"
                            >
                              <div>
                                <p className="text-xs font-semibold text-slate-900">{t.title}</p>
                                <div className="mt-1 flex items-center gap-2 text-[11px] text-slate-500">
                                  <span className="font-mono">{t.id}</span>
                                  {t.claimedBy && (
                                    <span className="inline-flex items-center gap-1 text-[#4F46E5] font-semibold">
                                      <Lock className="w-3 h-3" />
                                      {t.claimedBy}
                                    </span>
                                  )}
                                </div>
                              </div>
                              <select
                                value={t.status}
                                onChange={(e) =>
                                  void handleTaskStatus(t, e.target.value as TaskItem['status'])
                                }
                                className="rounded-full bg-[#F7F6F3] px-2.5 py-1 text-[11px] font-semibold text-slate-700"
                              >
                                <option value="todo">todo</option>
                                <option value="in_progress">in_progress</option>
                                <option value="handoff">handoff</option>
                                <option value="blocked">blocked</option>
                                <option value="done">done</option>
                              </select>
                            </div>
                          ))
                        )}
                      </div>
                    </div>

                    {/* Handoff Composer + Feed */}
                    <div className="lg:col-span-7 space-y-5">
                      <div className="bg-[#EFECE7] rounded-[26px] p-5">
                        <h2 className="text-[15px] font-bold text-slate-900 mb-3">
                          Post Handoff Note
                        </h2>
                        <form
                          onSubmit={(e) => void handleCreateNote(e)}
                          className="bg-white rounded-[20px] p-4 space-y-3 shadow-sm"
                        >
                          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                            <input
                              type="text"
                              value={newNoteAgent}
                              onChange={(e) => setNewNoteAgent(e.target.value)}
                              placeholder="Agent (e.g. antigravity)"
                              className="rounded-xl bg-[#F7F6F3] px-3 py-2 text-xs text-slate-800"
                            />
                            <input
                              type="text"
                              value={newNoteTitle}
                              onChange={(e) => setNewNoteTitle(e.target.value)}
                              placeholder="Handoff title"
                              className="sm:col-span-2 rounded-xl bg-[#F7F6F3] px-3 py-2 text-xs text-slate-800"
                            />
                          </div>
                          <textarea
                            value={newNoteSummary}
                            onChange={(e) => setNewNoteSummary(e.target.value)}
                            rows={3}
                            placeholder="Summary of completed work and context for the next agent..."
                            className="w-full rounded-xl bg-[#F7F6F3] p-3 text-xs text-slate-800"
                          />
                          <textarea
                            value={newNoteNext}
                            onChange={(e) => setNewNoteNext(e.target.value)}
                            rows={2}
                            placeholder="Next steps (one per line, optional)"
                            className="w-full rounded-xl bg-[#F7F6F3] p-3 text-xs text-slate-800"
                          />
                          <button
                            type="submit"
                            className="rounded-full bg-[#4F46E5] hover:bg-[#4338CA] text-white px-5 py-2 text-xs font-semibold shadow-indigo-glow"
                          >
                            Save Handoff Note
                          </button>
                        </form>
                      </div>

                      <div className="bg-[#EFECE7] rounded-[26px] p-5 space-y-3">
                        <h2 className="text-[15px] font-bold text-slate-900">
                          Handoff Timeline ({projectNotes.length})
                        </h2>
                        {projectNotes.length === 0 ? (
                          <div className="bg-white rounded-[18px] p-5 text-xs text-slate-500">
                            No handoff notes yet for this project.
                          </div>
                        ) : (
                          projectNotes.map((n) => (
                            <article
                              key={n.id}
                              className="bg-white rounded-[20px] p-4 shadow-sm space-y-2"
                            >
                              <div className="flex items-center justify-between gap-2">
                                <h3 className="text-sm font-bold text-slate-900">{n.title}</h3>
                                <span className="rounded-full bg-indigo-50 text-[#4F46E5] px-2.5 py-0.5 text-[11px] font-semibold">
                                  {n.authorAgent}
                                </span>
                              </div>
                              <p className="text-xs text-slate-600">{n.summary}</p>
                              {n.nextSteps.length > 0 && (
                                <ul className="list-disc pl-4 text-xs text-slate-600 space-y-0.5">
                                  {n.nextSteps.map((s, i) => (
                                    <li key={i}>{s}</li>
                                  ))}
                                </ul>
                              )}
                              <p className="text-[11px] text-slate-400">
                                {new Date(n.createdAt).toLocaleString()}
                              </p>
                            </article>
                          ))
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* ============================================================= */}
            {/* VIEW 3: UNIVERSAL MCP CONNECTOR & SKILLS SYNC                 */}
            {/* ============================================================= */}
            {view === 'sync' && (
              <div className="space-y-5">
                <div>
                  <h1 className="text-2xl font-bold tracking-tight text-slate-900">
                    Universal MCP Connector & Skills
                  </h1>
                  <p className="text-xs text-slate-500">
                    One universal MCP endpoint for every AI agent (Antigravity, Hermes, Claude
                    Code, OpenClaw, Cursor, or any future MCP client). Connected clients are
                    auto-detected automatically.
                  </p>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
                  {/* Left: 1 Universal MCP Connector */}
                  <div className="lg:col-span-7 bg-[#EFECE7] rounded-[26px] p-5 space-y-4">
                    <div className="bg-white rounded-[20px] p-5 shadow-sm space-y-4">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <h2 className="text-base font-bold text-slate-900">
                            Universal MCP Endpoint
                          </h2>
                          <p className="text-xs text-slate-500">
                            Paste into any MCP-compatible agent. No per-agent adapter required.
                          </p>
                        </div>
                        <div className="inline-flex rounded-full bg-[#EFECE7] p-1">
                          {(['json', 'yaml'] as const).map((fmt) => (
                            <button
                              key={fmt}
                              type="button"
                              onClick={() => setSnippetFormat(fmt)}
                              className={`rounded-full px-3 py-1 text-[11px] font-semibold uppercase saas-transition ${
                                snippetFormat === fmt
                                  ? 'bg-slate-900 text-white'
                                  : 'text-slate-600 hover:text-slate-900'
                              }`}
                            >
                              {fmt}
                            </button>
                          ))}
                        </div>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                        <div className="sm:col-span-2">
                          <label className="block text-[11px] font-semibold text-slate-500 mb-1">
                            Server MCP URL (auto-follows VPS / Tailscale / LAN origin)
                          </label>
                          <input
                            type="text"
                            value={connectorUrl}
                            onChange={(e) => setConnectorUrl(e.target.value)}
                            className="w-full rounded-xl bg-[#F7F6F3] px-3 py-2 font-mono text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#4F46E5]/30"
                          />
                        </div>
                        <div>
                          <label className="block text-[11px] font-semibold text-slate-500 mb-1">
                            Device / Profile Label (optional)
                          </label>
                          <input
                            type="text"
                            value={connectorIdentity}
                            onChange={(e) => setConnectorIdentity(e.target.value)}
                            placeholder="e.g. antigravity@laptop or hermes:work"
                            className="w-full rounded-xl bg-[#F7F6F3] px-3 py-2 text-xs text-slate-900 focus:outline-none"
                          />
                        </div>
                        <div>
                          <label className="block text-[11px] font-semibold text-slate-500 mb-1">
                            Tag Scope Filter (optional)
                          </label>
                          <input
                            type="text"
                            value={connectorTags}
                            onChange={(e) => setConnectorTags(e.target.value)}
                            placeholder="e.g. work, backend"
                            className="w-full rounded-xl bg-[#F7F6F3] px-3 py-2 text-xs text-slate-900 focus:outline-none"
                          />
                        </div>
                        <div className="sm:col-span-2">
                          <label className="block text-[11px] font-semibold text-slate-500 mb-1">
                            Persona Profile (optional)
                          </label>
                          <select
                            value={connectorPersona}
                            onChange={(e) => setConnectorPersona(e.target.value)}
                            className="w-full rounded-xl bg-[#F7F6F3] px-3 py-2 text-xs text-slate-900 focus:outline-none"
                          >
                            <option value="">None (global profile only)</option>
                            {personas.map((per) => (
                              <option key={per.name} value={per.name}>
                                {per.name}
                              </option>
                            ))}
                          </select>
                        </div>
                      </div>

                      {/* Copyable Final URL */}
                      <div className="rounded-xl bg-[#1E1B4B] text-white p-3.5 flex items-center justify-between gap-2">
                        <code className="break-all font-mono text-[11px] text-emerald-300">
                          {universalMcpUrl}
                        </code>
                        <button
                          type="button"
                          onClick={() => copyText('universal-url', universalMcpUrl)}
                          className="shrink-0 rounded-full bg-white/10 hover:bg-white/20 px-3 py-1.5 text-[11px] font-semibold flex items-center gap-1"
                        >
                          {copiedKey === 'universal-url' ? (
                            <Check className="w-3.5 h-3.5 text-emerald-300" />
                          ) : (
                            <Copy className="w-3.5 h-3.5" />
                          )}
                          {copiedKey === 'universal-url' ? 'Copied' : 'Copy URL'}
                        </button>
                      </div>

                      {/* Copyable JSON / YAML Snippet */}
                      <div className="space-y-1.5">
                        <div className="flex items-center justify-between">
                          <span className="text-[11px] font-semibold text-slate-500">
                            Universal {snippetFormat.toUpperCase()} Config Snippet
                          </span>
                          <button
                            type="button"
                            onClick={() => copyText('universal-snippet', universalSnippet)}
                            className="rounded-full bg-[#EFECE7] hover:bg-[#4F46E5] hover:text-white text-slate-700 px-3 py-1 text-[11px] font-semibold flex items-center gap-1 saas-transition"
                          >
                            {copiedKey === 'universal-snippet' ? (
                              <Check className="w-3 h-3" />
                            ) : (
                              <Copy className="w-3 h-3" />
                            )}
                            {copiedKey === 'universal-snippet' ? 'Copied' : 'Copy Snippet'}
                          </button>
                        </div>
                        <pre className="rounded-xl bg-[#F7F6F3] p-3 font-mono text-[11px] text-slate-800 overflow-x-auto">
                          {universalSnippet}
                        </pre>
                      </div>
                    </div>
                  </div>

                  {/* Right: Auto-Detected Connected Agents Registry */}
                  <div className="lg:col-span-5 bg-[#EFECE7] rounded-[26px] p-5 space-y-3">
                    <div className="flex items-center justify-between">
                      <div>
                        <h2 className="text-[15px] font-bold text-slate-900">
                          Auto-Detected Agents ({connectedAgents.length})
                        </h2>
                        <p className="text-xs text-slate-500">
                          Automatically discovered from MCP client handshake.
                        </p>
                      </div>
                    </div>

                    <div className="bg-white rounded-[20px] p-4 shadow-sm">
                      {connectedAgents.length === 0 ? (
                        <div className="py-8 text-center">
                          <p className="text-xs font-semibold text-slate-700">
                            Waiting for first agent connection
                          </p>
                          <p className="text-[11px] text-slate-500 mt-1">
                            Paste the Universal MCP URL into any agent. As soon as it connects, it
                            appears here automatically.
                          </p>
                        </div>
                      ) : (
                        <ul className="divide-y divide-slate-100">
                          {connectedAgents.map((ag) => (
                            <li key={ag.id} className="py-3 flex items-start justify-between gap-2">
                              <div className="min-w-0">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <span className="text-xs font-bold text-slate-900 break-all">
                                    {ag.id}
                                  </span>
                                  {ag.clientVersion && (
                                    <span className="text-[10px] font-mono text-slate-400">
                                      v{ag.clientVersion}
                                    </span>
                                  )}
                                  <span className="rounded-full bg-emerald-50 text-emerald-700 px-2 py-0.5 text-[10px] font-semibold">
                                    {ag.via}
                                  </span>
                                </div>
                                <div className="mt-1 flex flex-wrap gap-1.5 text-[10px] text-slate-500">
                                  <span>{ag.requestCount} reqs</span>
                                  {ag.persona && (
                                    <span className="rounded-full bg-indigo-50 text-[#4F46E5] px-2 py-0.5 font-semibold">
                                      persona:{ag.persona}
                                    </span>
                                  )}
                                  {ag.tagScope && (
                                    <span className="rounded-full bg-amber-50 text-amber-700 px-2 py-0.5 font-semibold">
                                      tags:{ag.tagScope}
                                    </span>
                                  )}
                                </div>
                                <p className="text-[10px] text-slate-400 mt-1">
                                  Last seen: {new Date(ag.lastSeen).toLocaleString()}
                                </p>
                              </div>
                              <button
                                type="button"
                                onClick={() => void handleRemoveAgent(ag.id)}
                                className="p-1.5 rounded-full text-slate-400 hover:text-rose-600 hover:bg-rose-50"
                                title="Remove from registry"
                              >
                                <X className="w-3.5 h-3.5" />
                              </button>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </div>
                </div>

                {/* Generic Local Skills Folder Sync (works with ANY agent) */}
                <div className="bg-[#EFECE7] rounded-[26px] p-5 space-y-4">
                  <div>
                    <h2 className="text-[15px] font-bold text-slate-900">
                      Universal Skills Sync & Vault Library ({skills.length})
                    </h2>
                    <p className="text-xs text-slate-500">
                      Import or export standard <code>SKILL.md</code> folders from any local agent
                      skills directory.
                    </p>
                  </div>

                  <div className="bg-white rounded-[20px] p-4 shadow-sm space-y-3">
                    <div className="flex flex-wrap gap-2">
                      <input
                        type="text"
                        value={skillsSyncDir}
                        onChange={(e) => setSkillsSyncDir(e.target.value)}
                        placeholder="Local skills directory, e.g. ~/.gemini/config/skills or ~/.hermes/skills"
                        className="min-w-0 flex-1 rounded-full bg-[#F7F6F3] px-4 py-2 font-mono text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-[#4F46E5]/30"
                      />
                      <button
                        type="button"
                        onClick={() => void handleSyncDir('import', true)}
                        className="rounded-full bg-[#EFECE7] hover:bg-slate-200 text-slate-700 px-3.5 py-2 text-xs font-semibold"
                      >
                        Preview
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleSyncDir('import', false)}
                        className="rounded-full bg-white border border-slate-200 hover:border-[#4F46E5] text-slate-700 px-3.5 py-2 text-xs font-semibold flex items-center gap-1.5"
                      >
                        <Download className="w-3.5 h-3.5" />
                        Import
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleSyncDir('export', false)}
                        className="rounded-full bg-[#4F46E5] hover:bg-[#4338CA] text-white px-4 py-2 text-xs font-semibold shadow-indigo-glow flex items-center gap-1.5"
                      >
                        <Upload className="w-3.5 h-3.5" />
                        Export
                      </button>
                    </div>

                    {syncPreview && (
                      <div className="rounded-xl bg-[#F7F6F3] p-3 text-xs">
                        <p className="font-bold text-slate-800">
                          {syncPreview.dryRun ? 'Dry Run' : 'Applied'}: {syncPreview.direction} (
                          {syncPreview.actions.length} skill(s))
                        </p>
                        {syncPreview.actions.length > 0 && (
                          <ul className="mt-1.5 space-y-1">
                            {syncPreview.actions.map((act, i) => (
                              <li key={i} className="font-mono text-[11px] text-slate-600">
                                <span className="text-[#4F46E5] font-bold">
                                  [{act.operation.toUpperCase()}]
                                </span>{' '}
                                {act.name}
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    )}

                    {skills.length === 0 ? (
                      <p className="text-xs text-slate-500 pt-2">
                        No skills stored in the Vault yet. Enter any local skills path above and
                        click Import.
                      </p>
                    ) : (
                      <ul className="divide-y divide-slate-100 pt-2">
                        {skills.map((s) => (
                          <li key={s.name} className="py-2.5 flex items-center justify-between">
                            <div>
                              <p className="text-xs font-bold text-slate-900">{s.name}</p>
                              <p className="text-[11px] text-slate-500">
                                {s.description || 'No description'}
                              </p>
                            </div>
                            {s.sourceAgent && (
                              <span className="rounded-full bg-[#F7F6F3] px-2.5 py-0.5 text-[11px] font-semibold text-slate-600">
                                {s.sourceAgent}
                              </span>
                            )}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* ============================================================= */}
            {/* VIEW 3.5: ENCRYPTED CREDENTIALS VAULT                         */}
            {/* ============================================================= */}
            {view === 'credentials' && (
              <div className="space-y-5">
                <div>
                  <h1 className="text-2xl font-bold tracking-tight text-slate-900">
                    Encrypted Credentials Vault
                  </h1>
                  <p className="text-xs text-slate-500">
                    Store API keys & tokens once (encrypted with AES-256-GCM in{' '}
                    <code>.secrets/</code>, gitignored). Private-network agents can request keys
                    via MCP (<code>get_credential</code>) so you never have to copy-paste them
                    again. Strictly blocked over public tunnels.
                  </p>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
                  {/* Add / Update Credential Form */}
                  <div className="lg:col-span-5 bg-[#EFECE7] rounded-[26px] p-5">
                    <h2 className="text-[15px] font-bold text-slate-900 mb-3">
                      Add / Update Credential
                    </h2>
                    <form
                      onSubmit={(e) => void handleSaveCredential(e)}
                      className="bg-white rounded-[20px] p-4 shadow-sm space-y-2.5"
                    >
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        <input
                          type="text"
                          required
                          value={credName}
                          onChange={(e) => setCredName(e.target.value)}
                          placeholder="Key slug (e.g. instabox)"
                          className="rounded-xl bg-[#F7F6F3] px-3 py-2 text-xs text-slate-900 focus:outline-none"
                        />
                        <input
                          type="text"
                          value={credService}
                          onChange={(e) => setCredService(e.target.value)}
                          placeholder="Service (e.g. InstaBox)"
                          className="rounded-xl bg-[#F7F6F3] px-3 py-2 text-xs text-slate-900 focus:outline-none"
                        />
                      </div>
                      <input
                        type="text"
                        value={credEnvVar}
                        onChange={(e) => setCredEnvVar(e.target.value)}
                        placeholder="Env var name (e.g. INSTABOX_API_KEY)"
                        className="w-full rounded-xl bg-[#F7F6F3] px-3 py-2 font-mono text-xs text-slate-900 focus:outline-none"
                      />
                      <input
                        type="password"
                        required
                        value={credValue}
                        onChange={(e) => setCredValue(e.target.value)}
                        placeholder="Secret / API key value"
                        className="w-full rounded-xl bg-[#F7F6F3] px-3 py-2 font-mono text-xs text-slate-900 focus:outline-none"
                      />
                      <input
                        type="text"
                        value={credTags}
                        onChange={(e) => setCredTags(e.target.value)}
                        placeholder="Optional tag scope (e.g. work, infra)"
                        className="w-full rounded-xl bg-[#F7F6F3] px-3 py-2 text-xs text-slate-900 focus:outline-none"
                      />
                      <input
                        type="text"
                        value={credNotes}
                        onChange={(e) => setCredNotes(e.target.value)}
                        placeholder="Notes (optional)"
                        className="w-full rounded-xl bg-[#F7F6F3] px-3 py-2 text-xs text-slate-900 focus:outline-none"
                      />
                      <button
                        type="submit"
                        className="w-full rounded-full bg-[#4F46E5] hover:bg-[#4338CA] text-white py-2.5 text-xs font-semibold shadow-indigo-glow saas-transition"
                      >
                        Encrypt & Save Credential
                      </button>
                    </form>
                  </div>

                  {/* Stored Credentials List */}
                  <div className="lg:col-span-7 bg-[#EFECE7] rounded-[26px] p-5 space-y-3">
                    <h2 className="text-[15px] font-bold text-slate-900">
                      Stored Credentials ({credentials.length})
                    </h2>
                    <div className="bg-white rounded-[20px] p-4 shadow-sm">
                      {credentials.length === 0 ? (
                        <p className="text-xs text-slate-500 py-8 text-center">
                          No credentials stored yet. Add an API key on the left or let a connected
                          agent save one via <code>store_credential</code>.
                        </p>
                      ) : (
                        <ul className="divide-y divide-slate-100">
                          {credentials.map((c) => {
                            const revealed = revealedSecrets[c.name];
                            return (
                              <li key={c.name} className="py-3.5 space-y-2">
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                  <div>
                                    <div className="flex items-center gap-2 flex-wrap">
                                      <span className="text-sm font-bold text-slate-900">
                                        {c.service}
                                      </span>
                                      <span className="font-mono text-[11px] text-slate-500">
                                        ({c.name})
                                      </span>
                                      {c.envVar && (
                                        <span className="rounded-full bg-[#F7F6F3] px-2 py-0.5 font-mono text-[10px] text-slate-700">
                                          {c.envVar}
                                        </span>
                                      )}
                                    </div>
                                    <p className="mt-1 font-mono text-xs text-slate-600 break-all">
                                      {revealed || c.maskedValue}
                                    </p>
                                  </div>

                                  <div className="flex items-center gap-1.5 flex-wrap">
                                    <button
                                      type="button"
                                      onClick={() => void handleRevealCredential(c.name)}
                                      className="rounded-full bg-[#EFECE7] hover:bg-slate-200 text-slate-700 px-2.5 py-1 text-[11px] font-semibold flex items-center gap-1"
                                    >
                                      <Eye className="w-3 h-3" />
                                      {revealed ? 'Hide' : 'Reveal'}
                                    </button>
                                    {revealed && (
                                      <button
                                        type="button"
                                        onClick={() => copyText(`cred-${c.name}`, revealed)}
                                        className="rounded-full bg-[#EFECE7] hover:bg-[#4F46E5] hover:text-white text-slate-700 px-2.5 py-1 text-[11px] font-semibold"
                                      >
                                        {copiedKey === `cred-${c.name}` ? 'Copied' : 'Copy'}
                                      </button>
                                    )}
                                    <button
                                      type="button"
                                      onClick={() => void handleToggleCredentialAccess(c)}
                                      className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${
                                        c.allowAgentRead
                                          ? 'bg-emerald-50 text-emerald-700'
                                          : 'bg-amber-50 text-amber-700'
                                      }`}
                                    >
                                      {c.allowAgentRead ? 'Agent Access: ON' : 'Locked'}
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => void handleDeleteCredential(c.name)}
                                      className="rounded-full bg-rose-50 hover:bg-rose-100 text-rose-700 px-2.5 py-1 text-[11px] font-semibold"
                                    >
                                      Delete
                                    </button>
                                  </div>
                                </div>
                                <div className="flex flex-wrap items-center gap-2 text-[10px] text-slate-400">
                                  <span>Added by: {c.addedBy}</span>
                                  {c.tags.length > 0 && <span>· tags: {c.tags.join(', ')}</span>}
                                  {c.notes && <span>· {c.notes}</span>}
                                </div>
                              </li>
                            );
                          })}
                        </ul>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* ============================================================= */}
            {/* VIEW 4: WEB BRIDGE & ON-DEMAND TUNNEL                         */}
            {/* ============================================================= */}
            {view === 'bridge' && (
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
                <div className="lg:col-span-5 bg-[#EFECE7] rounded-[26px] p-5">
                  <div className="bg-[#1E1B4B] text-white rounded-[22px] p-5 shadow-md">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold uppercase tracking-wider text-indigo-200">
                        On-Demand Public Tunnel
                      </span>
                      <span
                        className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${
                          tunnel.active
                            ? 'bg-emerald-500/20 text-emerald-300'
                            : 'bg-white/10 text-amber-300'
                        }`}
                      >
                        {tunnel.active ? 'ACTIVE' : 'OFF'}
                      </span>
                    </div>
                    <p className="mt-2 text-xs text-indigo-200 leading-relaxed">
                      Off by default. Open temporarily when Claude Chat or Gemini Web needs to fetch
                      your context. Management API remains blocked over public traffic.
                    </p>

                    {!tunnel.active ? (
                      <div className="mt-5 space-y-4">
                        <div>
                          <label className="block text-[11px] font-semibold text-indigo-200 mb-1.5">
                            Access Scope
                          </label>
                          <div className="inline-flex rounded-full bg-white/10 p-1">
                            {(['read-only', 'read-write'] as const).map((sc) => (
                              <button
                                key={sc}
                                type="button"
                                onClick={() => setTunnelScope(sc)}
                                className={`rounded-full px-3.5 py-1.5 text-xs font-semibold saas-transition ${
                                  tunnelScope === sc
                                    ? 'bg-white text-slate-900'
                                    : 'text-indigo-200 hover:text-white'
                                }`}
                              >
                                {sc}
                              </button>
                            ))}
                          </div>
                        </div>

                        <div>
                          <label className="block text-[11px] font-semibold text-indigo-200 mb-1.5">
                            Auto-Shutdown TTL
                          </label>
                          <select
                            value={tunnelTtl}
                            onChange={(e) => setTunnelTtl(Number(e.target.value))}
                            className="w-full rounded-xl bg-white/10 px-3 py-2.5 text-xs text-white focus:outline-none"
                          >
                            <option className="text-slate-900" value={15}>
                              15 minutes
                            </option>
                            <option className="text-slate-900" value={30}>
                              30 minutes
                            </option>
                            <option className="text-slate-900" value={60}>
                              1 hour
                            </option>
                            <option className="text-slate-900" value={180}>
                              3 hours
                            </option>
                          </select>
                        </div>

                        <button
                          type="button"
                          disabled={tunnelBusy}
                          onClick={() => void handleStartTunnel()}
                          className="w-full rounded-full bg-[#4F46E5] hover:bg-[#6366F1] text-white py-2.5 text-xs font-semibold shadow-indigo-glow disabled:opacity-50 saas-transition"
                        >
                          {tunnelBusy ? 'Starting Cloudflare Tunnel...' : 'Start On-Demand Tunnel'}
                        </button>
                      </div>
                    ) : (
                      <div className="mt-4 space-y-3">
                        <div className="rounded-xl bg-white/10 p-3 text-xs">
                          <p className="text-indigo-200 text-[11px]">
                            Remote MCP URL (Claude Chat & Gemini Web):
                          </p>
                          <div className="mt-1 flex items-center justify-between gap-2">
                            <code className="break-all text-emerald-300 text-[11px]">
                              {remoteMcpUrl}
                            </code>
                            <button
                              type="button"
                              onClick={() => copyText('mcp', remoteMcpUrl)}
                              className="p-1.5 rounded-full bg-white/10 hover:bg-white/20"
                              title="Copy Remote MCP URL"
                            >
                              {copiedKey === 'mcp' ? (
                                <Check className="w-3.5 h-3.5 text-emerald-300" />
                              ) : (
                                <Copy className="w-3.5 h-3.5" />
                              )}
                            </button>
                          </div>
                        </div>

                        <div className="rounded-xl bg-white/10 p-3 text-xs">
                          <p className="text-indigo-200 text-[11px]">
                            Base MCP URL + Bearer Token (Setelan Tambahan / Header):
                          </p>
                          <div className="mt-1 flex items-center justify-between gap-2">
                            <code className="break-all text-white text-[11px]">
                              {tunnel.publicUrl}/mcp
                            </code>
                            <button
                              type="button"
                              onClick={() => copyText('mcp-base', `${tunnel.publicUrl}/mcp`)}
                              className="p-1.5 rounded-full bg-white/10 hover:bg-white/20"
                              title="Copy Base MCP URL"
                            >
                              {copiedKey === 'mcp-base' ? (
                                <Check className="w-3.5 h-3.5 text-emerald-300" />
                              ) : (
                                <Copy className="w-3.5 h-3.5" />
                              )}
                            </button>
                          </div>
                          <div className="mt-1.5 flex items-center justify-between gap-2 border-t border-white/10 pt-1.5">
                            <code className="break-all text-amber-300 text-[11px]">
                              Bearer {tunnel.token}
                            </code>
                            <button
                              type="button"
                              onClick={() => copyText('bearer', `Bearer ${tunnel.token}`)}
                              className="p-1.5 rounded-full bg-white/10 hover:bg-white/20"
                              title="Copy Authorization Bearer Header"
                            >
                              {copiedKey === 'bearer' ? (
                                <Check className="w-3.5 h-3.5 text-emerald-300" />
                              ) : (
                                <Copy className="w-3.5 h-3.5" />
                              )}
                            </button>
                          </div>
                        </div>

                        <div className="rounded-xl bg-white/10 p-3 text-xs">
                          <p className="text-indigo-200 text-[11px]">
                            Ephemeral Markdown Context URL (Fallback / Gems):
                          </p>
                          <div className="mt-1 flex items-center justify-between gap-2">
                            <code className="break-all text-white text-[11px]">{shareUrl}</code>
                            <button
                              type="button"
                              onClick={() => copyText('share', shareUrl)}
                              className="p-1.5 rounded-full bg-white/10 hover:bg-white/20"
                              title="Copy Ephemeral Share URL"
                            >
                              {copiedKey === 'share' ? (
                                <Check className="w-3.5 h-3.5 text-emerald-300" />
                              ) : (
                                <Copy className="w-3.5 h-3.5" />
                              )}
                            </button>
                          </div>
                        </div>

                        <button
                          type="button"
                          onClick={() => void handleStopTunnel()}
                          className="w-full rounded-full bg-rose-500 hover:bg-rose-600 text-white py-2.5 text-xs font-semibold saas-transition"
                        >
                          Kill Tunnel Immediately
                        </button>
                      </div>
                    )}
                  </div>
                </div>

                {/* Context Pack Generator */}
                <div className="lg:col-span-7 bg-[#EFECE7] rounded-[26px] p-5">
                  <div className="bg-white rounded-[20px] p-5 shadow-sm">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <h2 className="text-base font-bold text-slate-900">
                          Context Pack (Claude Chat & Gemini Web)
                        </h2>
                        <p className="text-xs text-slate-500">
                          Copy or download Markdown snapshot for Claude Projects or Gemini Gems.
                        </p>
                      </div>

                      <div className="inline-flex rounded-full bg-[#EFECE7] p-1">
                        {(['claude', 'gemini'] as const).map((t) => (
                          <button
                            key={t}
                            type="button"
                            onClick={() => setExportTarget(t)}
                            className={`rounded-full px-3.5 py-1.5 text-xs font-semibold saas-transition ${
                              exportTarget === t
                                ? 'bg-slate-900 text-white'
                                : 'text-slate-600 hover:text-slate-900'
                            }`}
                          >
                            {t === 'claude' ? 'Claude Chat' : 'Gemini Web / Gems'}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
                      <select
                        value={selectedSlug}
                        onChange={(e) => setSelectedSlug(e.target.value)}
                        className="rounded-full bg-[#F7F6F3] px-3.5 py-2 text-xs font-semibold text-slate-700"
                      >
                        <option value="">All Projects Overview</option>
                        {projects.map((p) => (
                          <option key={p.slug} value={p.slug}>
                            Project: {p.name}
                          </option>
                        ))}
                      </select>

                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => copyText('pack', exportMarkdown)}
                          className="rounded-full bg-[#4F46E5] hover:bg-[#4338CA] text-white px-4 py-2 text-xs font-semibold shadow-indigo-glow flex items-center gap-1.5"
                        >
                          {copiedKey === 'pack' ? (
                            <Check className="w-3.5 h-3.5" />
                          ) : (
                            <Copy className="w-3.5 h-3.5" />
                          )}
                          {copiedKey === 'pack' ? 'Copied' : 'Copy Pack'}
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            downloadMarkdown(
                              `agent-colab-${exportTarget}-${selectedSlug || 'overview'}.md`,
                              exportMarkdown
                            )
                          }
                          className="rounded-full bg-[#EFECE7] hover:bg-slate-200 text-slate-800 px-4 py-2 text-xs font-semibold flex items-center gap-1.5"
                        >
                          <Download className="w-3.5 h-3.5" />
                          Download .md
                        </button>
                      </div>
                    </div>

                    <pre className="mt-4 max-h-[420px] overflow-auto rounded-2xl bg-[#F7F6F3] p-4 font-mono text-xs leading-relaxed text-slate-700">
                      {exportMarkdown || 'Generating context pack...'}
                    </pre>
                  </div>
                </div>
              </div>
            )}

            {/* ============================================================= */}
            {/* VIEW 5: SMART VAULT SEARCH (FTS5)                             */}
            {/* ============================================================= */}
            {view === 'search' && (
              <div className="bg-[#EFECE7] rounded-[26px] p-5 space-y-4">
                <div>
                  <h1 className="text-xl font-bold text-slate-900">Smart Vault Search (SQLite FTS5)</h1>
                  <p className="text-xs text-slate-500">
                    Instant full-text search across user profile, projects, tasks, handoff notes, and skills.
                  </p>
                </div>
                <div className="relative">
                  <Search className="w-4 h-4 text-slate-400 absolute left-4 top-3.5" />
                  <input
                    type="search"
                    value={searchQuery}
                    onChange={(e) => void handleSearch(e.target.value)}
                    placeholder="Type a keyword (e.g. auth, docker, hermes, handoff)..."
                    className="w-full rounded-full bg-white pl-11 pr-4 py-3 text-sm text-slate-900 shadow-pill focus:outline-none focus:ring-2 focus:ring-[#4F46E5]/30"
                  />
                </div>
                <div className="bg-white rounded-[20px] p-4 shadow-sm">
                  {searchResults.length === 0 ? (
                    <p className="text-xs text-slate-500 py-4 text-center">
                      {searchQuery
                        ? `No matches for "${searchQuery}".`
                        : 'Start typing above to search across your entire Vault.'}
                    </p>
                  ) : (
                    <ul className="divide-y divide-slate-100">
                      {searchResults.map((r) => (
                        <li key={r.id} className="py-3">
                          <button
                            type="button"
                            onClick={() => {
                              if (r.projectSlug) setSelectedSlug(r.projectSlug);
                              openView('dashboard');
                            }}
                            className="w-full text-left hover:text-[#4F46E5]"
                          >
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-sm font-bold text-slate-900">{r.title}</span>
                              <span className="rounded-full bg-[#EFECE7] px-2.5 py-0.5 text-[11px] font-semibold text-slate-600">
                                {r.type}
                              </span>
                            </div>
                            <p className="text-xs text-slate-500 mt-1">{r.snippet}</p>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            )}

            {/* ============================================================= */}
            {/* VIEW 6: USER PROFILE & GLOBAL AGENT RULES                     */}
            {/* ============================================================= */}
            {view === 'profile' && (
              <div className="bg-[#EFECE7] rounded-[26px] p-5 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h1 className="text-xl font-bold text-slate-900">
                      User Profile & Global Agent Rules
                    </h1>
                    <p className="text-xs text-slate-500">
                      Shared automatically with every connected agent so you never repeat your preferences.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => void handleSaveProfile()}
                    className="rounded-full bg-[#4F46E5] hover:bg-[#4338CA] text-white px-5 py-2.5 text-xs font-semibold shadow-indigo-glow"
                  >
                    Save Profile & Rules
                  </button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="bg-white rounded-[20px] p-4 shadow-sm">
                    <label className="block text-xs font-bold text-slate-700 mb-2">
                      profile/user.md
                    </label>
                    <textarea
                      value={profileText}
                      onChange={(e) => setProfileText(e.target.value)}
                      rows={12}
                      className="w-full rounded-xl bg-[#F7F6F3] p-3 font-mono text-xs text-slate-800 focus:outline-none"
                    />
                  </div>
                  <div className="bg-white rounded-[20px] p-4 shadow-sm">
                    <label className="block text-xs font-bold text-slate-700 mb-2">
                      profile/global-rules.md
                    </label>
                    <textarea
                      value={rulesText}
                      onChange={(e) => setRulesText(e.target.value)}
                      rows={12}
                      className="w-full rounded-xl bg-[#F7F6F3] p-3 font-mono text-xs text-slate-800 focus:outline-none"
                    />
                  </div>
                </div>

                {/* Multi-Persona Profiles (for multi-profile Hermes & multi-device setups) */}
                <div className="pt-4 border-t border-slate-200/70 space-y-3">
                  <div>
                    <h2 className="text-base font-bold text-slate-900">
                      Multi-Persona Profiles ({personas.length})
                    </h2>
                    <p className="text-xs text-slate-500">
                      Create separate persona rules (e.g. <code>work</code>, <code>personal</code>,{' '}
                      <code>research</code>) and load them via <code>?persona=work</code> on any
                      device or Hermes profile.
                    </p>
                  </div>

                  <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
                    <form
                      onSubmit={(e) => void handleSavePersona(e)}
                      className="lg:col-span-5 bg-white rounded-[20px] p-4 shadow-sm space-y-2.5"
                    >
                      <input
                        type="text"
                        value={newPersonaName}
                        onChange={(e) => setNewPersonaName(e.target.value)}
                        placeholder="Persona name (e.g. work, personal)"
                        className="w-full rounded-xl bg-[#F7F6F3] px-3 py-2 text-xs text-slate-800 focus:outline-none"
                      />
                      <textarea
                        value={newPersonaContent}
                        onChange={(e) => setNewPersonaContent(e.target.value)}
                        rows={5}
                        placeholder="Persona instructions, tone, or work-specific rules..."
                        className="w-full rounded-xl bg-[#F7F6F3] p-3 font-mono text-xs text-slate-800 focus:outline-none"
                      />
                      <button
                        type="submit"
                        className="rounded-full bg-[#4F46E5] hover:bg-[#4338CA] text-white px-4 py-2 text-xs font-semibold shadow-indigo-glow"
                      >
                        Save Persona
                      </button>
                    </form>

                    <div className="lg:col-span-7 bg-white rounded-[20px] p-4 shadow-sm">
                      {personas.length === 0 ? (
                        <p className="text-xs text-slate-500 py-6 text-center">
                          No personas yet. Add one on the left (e.g. <code>work</code> or{' '}
                          <code>personal</code>) for multi-profile Hermes or multi-device setups.
                        </p>
                      ) : (
                        <ul className="divide-y divide-slate-100">
                          {personas.map((per) => (
                            <li key={per.name} className="py-3 flex items-start justify-between gap-3">
                              <div className="min-w-0">
                                <p className="text-xs font-bold text-slate-900">
                                  profile/personas/{per.name}.md
                                </p>
                                <p className="mt-1 text-[11px] text-slate-600 whitespace-pre-wrap line-clamp-3">
                                  {per.content}
                                </p>
                              </div>
                              <div className="flex items-center gap-1.5 shrink-0">
                                <button
                                  type="button"
                                  onClick={() => {
                                    setNewPersonaName(per.name);
                                    setNewPersonaContent(per.content);
                                  }}
                                  className="rounded-full bg-[#EFECE7] px-2.5 py-1 text-[11px] font-semibold text-slate-700"
                                >
                                  Edit
                                </button>
                                <button
                                  type="button"
                                  onClick={() => void handleDeletePersona(per.name)}
                                  className="rounded-full bg-rose-50 px-2.5 py-1 text-[11px] font-semibold text-rose-700"
                                >
                                  Delete
                                </button>
                              </div>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </main>
        </div>

        {/* NEW PROJECT MODAL */}
        {newProjectModal && (
          <div
            onClick={() => setNewProjectModal(false)}
            className="fixed inset-0 bg-slate-950/40 backdrop-blur-[2px] z-50 flex items-center justify-center p-4"
          >
            <div
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-md max-h-[calc(100dvh-2rem)] bg-[#F7F6F3] rounded-[28px] shadow-2xl border border-white flex flex-col overflow-hidden"
            >
              <div className="px-6 py-4 border-b border-slate-200/70 flex items-center justify-between shrink-0">
                <h2 className="text-base font-bold text-slate-900">Create New Project</h2>
                <button
                  type="button"
                  onClick={() => setNewProjectModal(false)}
                  className="w-8 h-8 rounded-full bg-[#EFECE7] hover:bg-white flex items-center justify-center text-slate-600"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <form
                onSubmit={(e) => void handleCreateProject(e)}
                className="p-6 space-y-3 overflow-y-auto flex-1"
              >
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">
                    Project Slug
                  </label>
                  <input
                    type="text"
                    required
                    value={newProjSlug}
                    onChange={(e) => setNewProjSlug(e.target.value)}
                    placeholder="e.g. my-web-app"
                    className="w-full rounded-xl bg-white px-3.5 py-2.5 text-xs text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-[#4F46E5]/30"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">
                    Display Name
                  </label>
                  <input
                    type="text"
                    value={newProjName}
                    onChange={(e) => setNewProjName(e.target.value)}
                    placeholder="e.g. My Web App"
                    className="w-full rounded-xl bg-white px-3.5 py-2.5 text-xs text-slate-900 shadow-sm focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">
                    Tags (optional, comma-separated for multi-profile scoping)
                  </label>
                  <input
                    type="text"
                    value={newProjTags}
                    onChange={(e) => setNewProjTags(e.target.value)}
                    placeholder="e.g. work, backend or personal"
                    className="w-full rounded-xl bg-white px-3.5 py-2.5 text-xs text-slate-900 shadow-sm focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">
                    Workspace Folder Path (optional, for AI coding tools)
                  </label>
                  <input
                    type="text"
                    value={newProjRepoPath}
                    onChange={(e) => setNewProjRepoPath(e.target.value)}
                    placeholder="e.g. C:\Projects\my-app or /srv/repos/my-app"
                    className="w-full rounded-xl bg-white px-3.5 py-2.5 font-mono text-xs text-slate-900 shadow-sm focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">
                    AI Coding Permission (explicit opt-in)
                  </label>
                  <select
                    value={newProjCodingAccess}
                    onChange={(e) => setNewProjCodingAccess(e.target.value as CodingAccessMode)}
                    className="w-full rounded-xl bg-white px-3.5 py-2.5 text-xs text-slate-900 shadow-sm focus:outline-none"
                  >
                    <option value="disabled">Disabled (Context & notes only)</option>
                    <option value="read-only">Read-Only (Read/search files & git diff)</option>
                    <option value="full">Full Access (Read/write/edit files & run commands)</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">
                    Initial Context (Markdown)
                  </label>
                  <textarea
                    value={newProjDesc}
                    onChange={(e) => setNewProjDesc(e.target.value)}
                    rows={4}
                    placeholder="Tech stack, architecture, current milestone..."
                    className="w-full rounded-xl bg-white p-3 text-xs text-slate-900 shadow-sm focus:outline-none"
                  />
                </div>
                <div className="pt-2 flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setNewProjectModal(false)}
                    className="rounded-full bg-[#EFECE7] px-4 py-2 text-xs font-semibold text-slate-700"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="rounded-full bg-[#4F46E5] hover:bg-[#4338CA] text-white px-5 py-2 text-xs font-semibold shadow-indigo-glow"
                  >
                    Create Project
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
    </div>
  );
}
