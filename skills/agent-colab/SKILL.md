---
name: agent-colab
description: >-
  Use Agent Colab MCP to automatically load user/project context at the start of
  work and consistently record context updates, technical decisions, tasks, and
  handoff notes back to Agent Colab without waiting to be asked.
---

# Agent Colab — Autonomous Context & Memory Sync Skill

You are connected to **Agent Colab**, the user's centralized memory, collaboration, credentials, and workspace hub shared across all their AI agents (Antigravity, Hermes Agent, Claude Code, ZCode, OpenClaw, Cursor, Claude Chat, Gemini Web).

> **Core Invariant: Quality of understanding = Quality of the Vault.**
> The next agent can only understand the project as well as you document it. Any code change, bug fix, deployment, or decision you do not write to the Vault is invisible to the next agent.

---

## Mandatory Operating Loop (Automatic — Never Wait for the User to Ask)

### 1. On Session Start / New Task (Load Context First)
Before asking clarifying questions or starting implementation on any project:
1. Call `get_user_profile` to load the user's working style, preferences, global rules, and active persona.
2. Call `list_projects` (or `search_vault` if you only have a keyword) to find the matching project slug.
3. Call `get_project_context(projectSlug)` and `read_handoff_notes(projectSlug)` to catch up on architecture, technical decisions, active tasks, and the latest handoff left by previous agents.
4. If the project does not exist yet in Agent Colab and the user starts substantial work on a new repo/project, create it proactively with `update_project_context`.

### 2. While Working (Collaborate & Track State)
- **Claim Tasks**: When working on a tracked task, call `claim_task(projectSlug, taskId, agentName)` so parallel agents/devices do not collide.
- **Record Every Technical Decision Immediately**: Whenever a meaningful technical, architectural, UX, or deployment decision is made (e.g., choosing a database, changing an API contract, switching from public port to Tailnet, setting security rules), call `append_decision(projectSlug, title, rationale, agentName)` right away — do not leave decisions buried only in chat history.
- **Remote Workspace Coding (Opt-In)**: When operating remotely without local shell/filesystem access, use `fs_list_files`, `fs_read_file`, `fs_search_code`, `git_status`, `git_diff`, and — if the user granted `Full Access` on the project — `fs_edit_file`, `fs_write_file`, `fs_delete_file`, and `run_project_command`.
- **Shared Credential Vault (Private Network Only)**: Before asking the user to paste an API key or token, call `list_credentials` to check if another agent already stored it, then call `get_credential(name)` to retrieve it securely. When the user provides a new API key on a private connection, proactively store it with `store_credential` so other agents never have to ask again. Never write raw secrets into Markdown notes or Git files.

### 3. Mandatory Handoff Discipline (Non-Negotiable Before Ending a Work Turn)
Whenever you finish **any** meaningful work — a feature, bug fix, refactor, deployment, investigation with findings, or when pausing/handing off — **you MUST sync to Agent Colab BEFORE finishing your reply**, without waiting for the user to remind you:

1. **Always call `leave_handoff_note`** with high-signal, structured facts:
   - `title`: crisp milestone or fix title
   - `summary`: 1–3 factual sentences covering **what changed** (exact files/endpoints/commit hash) and **verification results** (tests/build/live check)
   - `nextSteps`: concrete, ordered actions or open blockers for the next agent
2. **Call `update_project_context`** whenever architecture, tech stack, deployment URL/path, or current project status changed so `context.md` never goes stale.
3. **Call `update_task`** to mark tasks `done`, `handoff`, or `blocked` (marking `done` or `handoff` automatically releases the lock).

**End-of-Turn Self-Check**:
Before sending your final answer on any non-trivial task, ask yourself:
> *"If a completely different agent starts a fresh session 1 minute from now, will it know everything I just built, fixed, verified, and decided just by reading the Vault?"*
If the answer is **no**, call `leave_handoff_note` / `append_decision` / `update_project_context` first.

---

## Hygiene & Guardrails

- **Never sync raw secrets**: Never write API keys, passwords, tokens, or `.env` values into `context.md`, `decisions.md`, tasks, or handoff notes. Use `store_credential` (AES-256-GCM encrypted) for credentials instead.
- **Keep notes concise and factual**: Write for another AI agent scanning quickly — exact file paths, commit hashes, verified test counts, and concrete next steps. No fluff.
- **Sync silently as part of the workflow**: Do not pester the user for permission before logging handoff notes or decisions. A brief 1-line confirmation at the end (e.g., *"Synced handoff note to Agent Colab"*) is enough.
- **Respect read-only connections**: If a write tool returns a read-only error (e.g., over a `read-only` tunnel), continue helping the user with read/analysis and provide a concise summary they can apply or hand off.
