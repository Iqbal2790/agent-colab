---
name: agent-colab
description: >-
  Use Agent Colab MCP to automatically load user/project context at the start of
  work and continuously sync progress, decisions, tasks, and handoff notes back
  to Agent Colab without waiting to be asked.
---

# Agent Colab — Autonomous Context & Memory Sync Skill

You are connected to **Agent Colab**, the user's centralized memory, collaboration, and workspace hub shared across all their AI agents (Antigravity, Hermes Agent, Claude Code, OpenClaw, Cursor, Claude Chat, Gemini Web).

Your job is to **eliminate context repetition** and **keep work memory continuously synced** so the user can switch between any AI tool at any time without ever re-explaining their work.

---

## Core Operating Loop (Automatic — Do Not Wait for the User to Ask)

### 1. On Session Start / New Task (Load Context First)
Before asking clarifying questions or starting implementation on any project:
1. Call `get_user_profile` to load the user's working style, preferences, and global rules.
2. Call `list_projects` (or `search_vault` if you only have a keyword) to find the matching project slug.
3. Call `get_project_context(projectSlug)` and `read_handoff_notes(projectSlug)` to catch up on architecture, technical decisions, active tasks, and the latest handoff left by previous agents.
4. If the project does not exist yet in Agent Colab and the user starts substantial work on a new repo/project, create it proactively with `update_project_context`.

### 2. While Working (Collaborate & Track State)
- **Claim Tasks**: If working on a tracked task, call `claim_task(projectSlug, taskId, agentName)` using your own agent identifier (e.g., `antigravity`, `hermes`, `claude-code`, `openclaw`, `cursor`, `claude-web`, `gemini-web`) so other agents know it is locked.
- **Record Decisions**: Whenever an important technical or architectural choice is finalized (e.g., database choice, API contract, auth flow), proactively call `append_decision(projectSlug, title, rationale, agentName)`.
- **Remote Workspace Coding (Opt-In)**: When operating remotely without local shell/filesystem access (e.g., via web chat or remote MCP), use `fs_list_files`, `fs_read_file`, `fs_search_code`, `git_status`, `git_diff`, and — if the user has granted `Full Access` on the project — `fs_edit_file`, `fs_write_file`, `fs_delete_file`, and `run_project_command`.
- **Shared Credential Vault (Private Network Only)**: Before asking the user to paste an API key or token, call `list_credentials` to check if another agent already stored it, then call `get_credential(name)` to retrieve it securely. When the user gives you a new API key on a private connection, proactively offer or save it with `store_credential` so other agents never have to ask again. Never copy raw credential values into Markdown notes or Git files.

### 3. On Milestone, Pause, or Task Completion (Proactive Memory Sync)
Whenever you finish a meaningful unit of work, hit a blocker, or wrap up a session — **sync automatically without waiting for the user to remind you**:
1. **Update Task Status**: Call `update_task` to mark the task `done`, `handoff`, or `blocked` (marking `done` or `handoff` automatically releases the lock).
2. **Update Project Context** *(if architecture, tech stack, or current status changed)*: Call `update_project_context` so `context.md` stays accurate.
3. **Leave a Handoff Note**: Call `leave_handoff_note` with:
   - `authorAgent`: your agent name
   - `title`: short milestone title
   - `summary`: 1–3 crisp sentences on what was completed and key files changed
   - `nextSteps`: concrete, ordered bullets for the next agent picking up the work

---

## Hygiene & Guardrails

- **Never sync secrets**: Never write raw API keys, passwords, tokens, or `.env` values into project contexts, decisions, or handoff notes.
- **Keep notes concise and factual**: Write for the next AI agent scanning quickly — state exact file paths, verified test results, and unresolved blockers. Avoid filler prose.
- **Don't nag the user**: Perform context loading and memory sync silently as part of your normal workflow. Only mention it briefly at the end if helpful (e.g., *"Synced handoff note to Agent Colab"*).
- **Respect read-only connections**: If a write tool returns a read-only error (e.g., over a `read-only` tunnel), continue helping the user with read/analysis and provide a concise summary they can apply or hand off.
