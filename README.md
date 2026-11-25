# Agent Colab

**Open-source, private-first centralized hub for AI agent context, collaboration, skill/config sync, and opt-in workspace coding.**

Stop re-explaining your project context every time you switch AI tools (**Antigravity**, **Hermes Agent**, **Claude Code**, **OpenClaw**, **Cursor**, etc.). Agent Colab runs inside your private network (local PC, VM, home server, or VPS) and connects all your agents via **MCP (Model Context Protocol)** with an on-demand public tunnel when web AI tools need temporary access.

---

## What It Does

- **Centralized Context & Memory**: Stores user profile, global rules, project contexts, and technical decisions in Git-friendly Markdown + YAML, indexed automatically with **SQLite FTS5** (`node:sqlite`, zero native compilation).
- **Agent-to-Agent Collaboration**: Shared task board with agent locking (`claim_task`) and structured handoff notes (`leave_handoff_note`) so agents can continue each other's work seamlessly.
- **Skill & MCP Config Sync**: Import/export `SKILL.md` bundles and MCP configs across **Antigravity**, **Hermes Agent**, **Claude Code**, **OpenClaw**, and **Cursor** with dry-run previews, automatic secret redaction (`${ENV_VAR}`), and `.bak` config backups.
- **Opt-In Workspace Coding (23 MCP Tools)**: Give connected agents — including **Gemini Web** and **Claude Chat** via Remote MCP — explicit per-project permission (`Disabled` / `Read-Only` / `Full Access`) to list, read, search, edit files, inspect `git diff`, and run commands inside your project folder (protected by hard path jail, sensitive file blocking, and audit logs).
- **Private-First + On-Demand Tunnel**: Runs locally on `127.0.0.1` or your private network by default. Toggle a temporary Cloudflare Quick Tunnel (`read-only` or `read-write`, with auto-shutdown TTL) only when needed, or export 1-click **Context Packs** (`.md`) offline.

---

## Installation

### Option 1: Local Machine (Windows / macOS / Linux)

**Requirements:** Node.js **22.5+** (uses built-in `node:sqlite`) and Git. *(Optional: [`cloudflared`](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/) if you want to use the On-Demand Public Tunnel).*

```bash
# 1. Clone the repository
git clone https://github.com/Iqbal2790/agent-colab.git
cd agent-colab

# 2. Install dependencies & build all packages + Web Dashboard
npm install
npm run build

# 3. Initialize your local Vault (~/.agent-colab/vault)
node packages/cli/dist/index.js init

# 4. Start the private server, MCP endpoint & Web Dashboard
node packages/cli/dist/index.js serve
```

Open **http://127.0.0.1:4242** in your browser.

- **MCP Streamable HTTP**: `http://127.0.0.1:4242/mcp`
- **MCP Stdio**: `node packages/cli/dist/index.js mcp`

### Option 2: Self-Host with Docker (VPS / Home Server / VM)

```bash
git clone https://github.com/Iqbal2790/agent-colab.git
cd agent-colab

docker compose up -d --build
```

By default, `docker-compose.yml` binds to `127.0.0.1:4242` and persists your Vault in `./vault`. To expose it to other devices inside your private network (LAN / Tailscale / WireGuard), bind the port in `docker-compose.yml` to your private interface IP.

---

## Connecting Your AI Tools

- **Agentic Tools (Antigravity, Hermes, Claude Code, OpenClaw, Cursor)**: Open the **Skills & Sync** tab in the Web Dashboard and click **Connect MCP**, or run:
  ```bash
  node packages/cli/dist/index.js connect antigravity --mode http
  node packages/cli/dist/index.js connect hermes --mode http
  node packages/cli/dist/index.js connect claude-code --mode http
  node packages/cli/dist/index.js connect openclaw --mode http
  node packages/cli/dist/index.js connect cursor --mode http
  ```
- **Gemini Web & Claude Chat**: Open the **Web Bridge** tab → start the **On-Demand Tunnel** → copy the **Remote MCP URL** into Gemini Web (**Customize → Connectors → + Custom**) or Claude Chat (**Settings → Connectors**).

### Multi-Device & Multi-Profile Hermes

Connect multiple machines (e.g., home PC + laptop) or multiple Hermes profiles (`work` vs `personal`) to the same Agent Colab hub using query parameters on `/mcp` or CLI flags:

```bash
# Same agent on 2 devices (distinct locks & handoff attribution)
node packages/cli/dist/index.js connect antigravity --mode http --url http://<vps-tailscale-ip>:4242/mcp --identity antigravity@pc-home
node packages/cli/dist/index.js connect antigravity --mode http --url http://<vps-tailscale-ip>:4242/mcp --identity antigravity@laptop

# Multi-profile Hermes with isolated personas & project tag scopes
node packages/cli/dist/index.js connect hermes --profile work --url http://<vps-tailscale-ip>:4242/mcp --identity hermes:work@laptop --persona work --tags work
node packages/cli/dist/index.js connect hermes --profile personal --url http://<vps-tailscale-ip>:4242/mcp --identity hermes:personal@laptop --persona personal --tags personal
```

You can also configure **Device Label**, **Hermes Profile**, **Persona**, and **Tag Scope** directly from the **Remote Setup** modal in the Web Dashboard.

---

## Installing the Agent Colab Skill (Auto-Sync Memory)

This repository includes an official skill at [`skills/agent-colab/SKILL.md`](./skills/agent-colab/SKILL.md) that teaches your AI agents how to use Agent Colab and **proactively load context & sync work memory/handoff notes without being asked**.

### Option 1: Copy into Your Agent's Global Skills Directory

**macOS / Linux:**
```bash
# Antigravity (Desktop App, IDE & CLI)
mkdir -p ~/.gemini/config/skills/agent-colab && cp skills/agent-colab/SKILL.md ~/.gemini/config/skills/agent-colab/

# Hermes Agent
mkdir -p ~/.hermes/skills/agent-colab && cp skills/agent-colab/SKILL.md ~/.hermes/skills/agent-colab/

# Claude Code
mkdir -p ~/.claude/skills/agent-colab && cp skills/agent-colab/SKILL.md ~/.claude/skills/agent-colab/

# OpenClaw
mkdir -p ~/.openclaw/skills/agent-colab && cp skills/agent-colab/SKILL.md ~/.openclaw/skills/agent-colab/

# Cursor
mkdir -p ~/.cursor/skills/agent-colab && cp skills/agent-colab/SKILL.md ~/.cursor/skills/agent-colab/
```

**Windows (PowerShell):**
```powershell
# Antigravity (Desktop App, IDE & CLI)
New-Item -ItemType Directory -Force "$env:USERPROFILE\.gemini\config\skills\agent-colab" | Out-Null
Copy-Item "skills\agent-colab\SKILL.md" "$env:USERPROFILE\.gemini\config\skills\agent-colab\"

# Replace ".gemini\config\skills" with ".hermes\skills", ".claude\skills", ".openclaw\skills", or ".cursor\skills" for other agents
```

### Option 2: Sync Once via Agent Colab Vault

Once installed in one agent (or placed in `~/.agent-colab/vault/skills/agent-colab/SKILL.md`), open the **Skills & Sync** tab in the Web Dashboard to export the skill to all your other agents in one click.

---

## Development & Tests

```bash
npm run typecheck
npm test
npm run build
```

## License

MIT
