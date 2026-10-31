#!/usr/bin/env node
/**
 * Commando Kit White-Label Builder (`scripts/build-kit.mjs`)
 *
 * Packages a clean, zero-leak, general-purpose Tiered AI Workforce bundle
 * into `dist/commando-kit/` and `dist/commando-kit.zip` for Muse.
 */

import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DIST_DIR = path.join(ROOT, 'dist', 'commando-kit');
const ZIP_PATH = path.join(ROOT, 'dist', 'commando-kit.zip');

// Forbidden proprietary tokens that must NEVER appear in the white-label build.
// Loaded from `private-data/build-kit/forbidden-tokens.json` (never published) and/or
// the comma-separated `BUILD_KIT_FORBIDDEN_TOKENS` env var.
const FORBIDDEN_TOKENS_FILE = path.join(ROOT, 'private-data', 'build-kit', 'forbidden-tokens.json');
const FORBIDDEN_TOKENS = [
  ...(fs.existsSync(FORBIDDEN_TOKENS_FILE) ? JSON.parse(fs.readFileSync(FORBIDDEN_TOKENS_FILE, 'utf8')) : []),
  ...(process.env.BUILD_KIT_FORBIDDEN_TOKENS || '').split(',').map((t) => t.trim()).filter(Boolean),
].map((t) => String(t).toLowerCase());

function writeFile(relPath, content) {
  const fullPath = path.join(DIST_DIR, relPath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, content.trimStart(), 'utf8');
}

// Clean previous build
fs.rmSync(DIST_DIR, { recursive: true, force: true });
fs.rmSync(ZIP_PATH, { force: true });
fs.mkdirSync(DIST_DIR, { recursive: true });

// ----------------------------------------------------------------------------
// 1. README.md (ASD-STE100 + Visual Diagrams + Tables)
// ----------------------------------------------------------------------------
writeFile(
  'README.md',
  `# Commando Kit — Tiered Multi-Agent Engineering & Executive OS

> **Compatible IDEs & CLIs**: Muse (\`MUSE.md\` + \`.agents/skills/\` + \`.claude/agents/\`).
> **Reporting Standard**: ASD-STE100 (Simplified Technical English), Visual-First Diagrams, and Structured Markdown Tables.

---

## 1. System Architecture

\`\`\`mermaid
flowchart TD
    CEO["👤 Founder / CEO"] --> WARDEN["🛡️ warden (Chief of Staff)\nMain Chat Orchestrator"]
    WARDEN --> CTO["💻 @cto (Level 0 Head of Tech)\nModel: pro | Owns context/cto.md"]
    WARDEN --> CBO["📈 @cbo (Level 0 Head of Business)\nModel: pro | Owns context/cbo.md"]
    CTO --> PM["📋 @pm:<project> (Level 1 PM)\nOwns worklist/<project>/backlog.md"]
    CTO --> TL["🏗️ @tech_lead:<project> (Level 1 Tech Lead)\nOwns context/<project>/<repo>.md & contracts/"]
    CTO --> INF["☁️ @infra_head (Level 1 Cloud & DevOps)\nOwns context/infra/ & Deploy Pipelines"]
    TL --> BE["⚙️ @backend_dev (Level 2)\nN Parallel Backend Workers"]
    TL --> FE["🎨 @frontend_dev (Level 2)\nN Parallel Frontend Workers"]
    INF --> IJR["🔧 @infra_jr (Level 2)\nN Parallel Infra Workers"]
\`\`\`

---

## 2. Quickstart Setup (3 Steps)

| Step | Command / Action | Result |
| :--- | :--- | :--- |
| **1. Register Repos** | Edit \`projects.yaml\` with your project names and local git repository paths. | Maps projects to local folders. |
| **2. Scaffold Memory** | Run \`npm run init\` in terminal. | Creates \`context/\`, \`memory/\`, \`worklist/\`, and \`.state/topology-cache.json\`. |
| **3. Start Orchestrating** | Open this folder in **Muse** and type \`standup\` or \`onboard <project>\`. | Activates \`warden\` and the full C-Suite hierarchy. |

---

## 3. Core Commands & Triggers

| Trigger in Chat | Target Agent(s) | Action Executed |
| :--- | :--- | :--- |
| \`standup\` or \`/standup\` | \`warden\` $\\rightarrow$ \`cto\`, \`cbo\`, \`pm\`, \`tech_lead\`, \`infra_head\` | Polls all teams, triages \`worklist/inbox.md\`, updates \`worklist/COLLATED_BACKLOG.md\`, and writes \`standups/<YYYY-MM-DD>-standup.md\`. |
| \`onboard <project>\` | \`warden\` $\\rightarrow$ \`cto\` $\\rightarrow$ \`tech_lead\` | Scans repository structure, populates \`context/<project>/<repo>.md\`, and creates initial backlog. |
| \`@cto <message>\` | \`cto\` (Direct 1-on-1 Mode) | Bypasses Chief of Staff compression and responds at full architectural depth. |
| \`@cbo <message>\` | \`cbo\` (Direct 1-on-1 Mode) | Evaluates ROI, revenue impact, and opportunity cost per founder hour. |
| \`@pm:<project> <msg>\` | \`pm\` (Direct 1-on-1 Mode) | Manages project backlog (\`P0\`/\`P1\`/\`P2\`) and \`[NEEDS_CEO]\` blockers. |
| \`@tech_lead:<project>\` | \`tech_lead\` (Direct 1-on-1 Mode) | Locks API contracts (\`contracts/\`) and dispatches parallel dev workers. |
| \`pushit\` or \`/pushit\` | All dirty repos | Runs 5th-commit semver check, stages safe files, commits in \`S.M:A\` format, and pushes to \`origin\`. |

---

## 4. Zero-Popup Parallel Subagent Workflow

\`\`\`mermaid
sequenceDiagram
    participant CEO as 👤 CEO
    participant W as 🛡️ warden
    participant M as 📂 .state/mirror/
    participant L2 as ⚡ N Parallel Devs (Sandboxed)
    participant GIT as 🌐 External Git Repos

    CEO->>W: "Approve Sprint Plan"
    W->>GIT: node scripts/repo-tool.mjs pull-check
    W->>M: node scripts/repo-tool.mjs sync-in
    W->>L2: Spawn N Parallel FE/BE/Infra Subagents (BypassSandbox: false)
    L2->>M: Edit mirrored files with 0 permission popups
    L2-->>W: Report completion & update memory/*.md
    W->>GIT: node scripts/repo-tool.mjs sync-out
    W->>GIT: Run pushit across modified repositories
\`\`\`
`
);

// ----------------------------------------------------------------------------
// 2. package.json & .gitignore
// ----------------------------------------------------------------------------
writeFile(
  'package.json',
  JSON.stringify(
    {
      name: 'commando-kit',
      version: '1.0.0',
      private: true,
      type: 'module',
      description: 'Commando Kit — Tiered Multi-Agent Engineering & Executive Hierarchy for Muse',
      scripts: {
        init: 'node scripts/init-kit.mjs',
        'sync-in': 'node scripts/repo-tool.mjs sync-in',
        'sync-out': 'node scripts/repo-tool.mjs sync-out',
        'pull-check': 'node scripts/repo-tool.mjs pull-check all',
      },
    },
    null,
    2
  ) + '\n'
);

writeFile(
  '.gitignore',
  `node_modules/
.DS_Store
.env*
.state/mirror/
dist/
*.zip
`
);

// ----------------------------------------------------------------------------
// 3. projects.example.yaml & projects.yaml
// ----------------------------------------------------------------------------
const PROJECTS_YAML_CONTENT = `# ============================================================================
# COMMANDO KIT — Multi-Project Repository Registry
# ============================================================================
# Map each project slug to its local Git repository paths.
# Then run: npm run init
# ============================================================================

projects:
  core-product:
    description: "Primary product ecosystem (Frontend web/mobile client and Backend API server)"
    folders:
      - /absolute/path/to/core-product-web
      - /absolute/path/to/core-product-api

  growth-app:
    description: "Secondary product or growth application"
    folders:
      - /absolute/path/to/growth-app

  cloud-infra:
    description: "Cloud infrastructure, IaC, CI/CD, and deployment automation (managed by infra_head -> infra_jr)"
    department: "infra"
    folders:
      - /absolute/path/to/cloud-infra

shared_search_roots:
  - /absolute/path/to/workspace
`;

writeFile('projects.example.yaml', PROJECTS_YAML_CONTENT);
writeFile('projects.yaml', PROJECTS_YAML_CONTENT);

// ----------------------------------------------------------------------------
// 4. AGENTS.md (Core Enterprise Hierarchy & Protocol)
// ----------------------------------------------------------------------------
writeFile(
  'AGENTS.md',
  `# COMMANDO — Enterprise Agent Hierarchy & Orchestration Protocol

You operate inside **Commando**, the centralized corporate and technical command center for the Founder/CEO.
This directory does **not** hold application source code directly. Instead, it orchestrates an enterprise hierarchy of specialized agents across company units and multiple project repositories defined in [\`projects.yaml\`](./projects.yaml).

---

## 1. Corporate & Agent Hierarchy

When the Founder/CEO talks to you in the main chat, **you are \`warden\` (CEO Office Chief of Staff)** (unless the CEO uses **Direct-to-Agent \`@<agent>\` Mode**, described in Section 1.5).
You maintain minimal low-level code context yourself. Your job is to act as the CEO's right hand, orchestrate the C-Suite, synthesize ultra-dense executive summaries, and help the CEO make cross-company decisions.

### Company Units & C-Suite Direct Reports (Reporting to \`warden\`)
- **A. Tech** $\\rightarrow$ **\`cto\`** *(Active — Product Engineering, Architecture, & Cloud Infrastructure across all projects)*
- **B. Sales / Business / Strategy** $\\rightarrow$ **\`cbo\`** *(Active — Fiscal Revenue, ROI/EV, Cashflow Anchors, & Opportunity Cost per CEO Hour)*
- **C. Marketing** $\\rightarrow$ **\`cmo\`** *(Planned)*
- **D. HR** $\\rightarrow$ **\`chro\`** *(Planned)*
- **E. Support / Operations** $\\rightarrow$ **\`coo\`** *(Planned)*
- **F. Finance** $\\rightarrow$ **\`cfo\`** *(Planned)*

### Tech & Business C-Suite (\`cto\` & \`cbo\`) Hierarchy

\`\`\`mermaid
flowchart TD
    CEO["👤 CEO (User)"] --> WARDEN["🛡️ warden (Chief of Staff / Main)\n• Minimal low-level context\n• Top of agent hierarchy\n• Owns context/warden.md"]
    WARDEN --> CTO["💻 Level 0: cto (Head of Tech)\n• Model: pro\n• Owns context/cto.md & topology cache\n• Final tech calls & chairs Standups"]
    WARDEN --> CBO["📈 Level 0: cbo (Business)\n• Model: pro\n• Owns context/cbo.md\n• Fiscal Revenue & ROI\n• Opportunity Cost / Hr"]
    CTO <--> CBO
    CTO --> PM["📋 Level 1: pm\n• 1 per project\n• Backlog & NEEDS_CEO"]
    CTO --> TL["🏗️ Level 1: tech_lead\n• 1 per project\n• Context & Contracts"]
    CTO --> INF["☁️ Level 1: infra_head\n• Cloud & Deploys\n• Owns cloud-infra"]
    TL --> BE["⚙️ Level 2: backend_dev\n(N parallel instances)"]
    TL --> FE["🎨 Level 2: frontend_dev\n(N parallel instances)"]
    INF --> IJR["🔧 Level 2: infra_jr\n(N parallel instances)"]
\`\`\`

### Mandatory Repo Operators Git Protocol (\`pull -> work -> pushit\`)
Every repo operator (\`backend_dev\`, \`frontend_dev\`, \`infra_jr\`, \`tech_lead\`) MUST:
1. **Begin every operation with a Git Fetch/Pull check** (\`node scripts/repo-tool.mjs pull-check <repo>\` or \`git pull --ff-only\`).
2. **Forward Merge Conflicts for Manual Confirmation**: If upstream changes conflict or branches diverge, immediately halt and file a \`[NEEDS_CEO]\` (\`MANUAL_ACTION\`) task for manual confirmation.
3. **End every completed operation with \`pushit\`** ([\`.agents/skills/pushit/SKILL.md\`](./.agents/skills/pushit/SKILL.md)).
4. **Zero-Popup Parallel Subagent Architecture (\`sync-in\` $\\rightarrow$ 100% Sandboxed Subagents $\\rightarrow$ \`sync-out\`)**:
   - \`warden\` runs \`node scripts/repo-tool.mjs sync-in\` once at the start of a batch to mirror source files into \`.state/mirror/<repo-alias>/\`.
   - All parallel subagents edit \`.state/mirror/<repo-alias>/\` using native \`read_file\`/\`edit_file\`/\`write_file\` and \`BypassSandbox: false\` (**zero permission popups**).
   - \`warden\` runs \`node scripts/repo-tool.mjs sync-out\` once at the end to write changes back to the external repositories.

---

## 1.5 Direct-to-Agent (\`@agent\`) Granular Mode vs. Default Executive Mode

| Mode | Trigger | Routing Behavior | Output Granularity |
| :--- | :--- | :--- | :--- |
| **Executive Mode** | Default chat message | \`warden\` $\\rightarrow$ \`cto\`/\`cbo\` $\\rightarrow$ Level 1 $\\rightarrow$ Level 2 | Compressed ASD-STE100 tables and diagrams. |
| **Direct Mode** | Prefix with \`@cto\`, \`@cbo\`, \`@pm:<proj>\`, \`@tech_lead:<proj>\`, \`@backend_dev:<proj>\`, \`@frontend_dev:<proj>\`, \`@infra_head\`, \`@infra_jr\` | \`warden\` routes verbatim message directly to target subagent | Uncompressed first-person response (\`[🎙️ Direct: @<agent>]\`). |

---

## 1.6 Daily Standups & Reporting Standard (\`standup\` / \`/standup\`)

1. **CEO Raw Idea Inbox (\`worklist/inbox.md\`) & Human Intervention Queue (\`[NEEDS_CEO]\`)**:
   - The CEO drops raw ideas into \`worklist/inbox.md\`.
   - Agents add tasks requiring CEO intervention (\`QUESTION\`, \`API_KEY\`, \`MANUAL_ACTION\`, \`DECISION\`) into \`worklist/<project>/backlog.md\` and [\`worklist/COLLATED_BACKLOG.md\`](./worklist/COLLATED_BACKLOG.md).
2. **Pre-Standup Poll & Backlog Collation**:
   - When the CEO says \`"standup"\`, \`cto\` and \`cbo\` poll per-project PMs, project \`tech_lead\`s, and \`infra_head\`.
3. **ASD-STE100 + Visual-First + Table-First CEO Reporting Standard (MANDATORY)**:
   - **ASD-STE100 (Simplified Technical English)**: Write all CEO reports and standups in strict ASD-STE100. Use active voice only. Keep procedural sentences $\\le 20$ words and descriptive sentences $\\le 25$ words. Put 1 fact or instruction per sentence. Avoid noun clusters $> 3$ words.
   - **Maximum Images & Diagrams**: Use as many diagrams and charts (\`mermaid\` \`xychart-beta\`, \`flowchart\`, \`stateDiagram-v2\`, \`sequenceDiagram\`, and generated visuals) as possible to convey status, dependencies, and metrics visually.
   - **Maximum Tables**: Format all status reports, standup summaries, sprint plans, blockers, and execution logs as Markdown tables rather than prose paragraphs or bullet lists.
4. **Ironclad CEO Approval Gate (Phase 1.5)**:
   - Present the proposed plan, contract, or standup MoM to the CEO first.
   - Pause for explicit CEO sign-off (\`"Approve"\`, \`"Execute"\`, \`"Proceed"\`) before Level 2 workers modify code or run deployments.

---

## 2. Source of Truth Files

| Path | Owner | Purpose |
| :--- | :--- | :--- |
| [\`projects.yaml\`](./projects.yaml) | CEO / \`warden\` | Registry of company projects and local repository paths. |
| [\`.state/topology-cache.json\`](./.state/topology-cache.json) | \`cto\` / \`tech_lead\` | Machine-generated map of project folders, stacks, and scripts. |
| [\`context/cto.md\`](./context/cto.md) & [\`context/cbo.md\`](./context/cbo.md) | \`cto\` & \`cbo\` | Executive tech posture and business/ROI priority matrix. |
| [\`context/<project>.md\`](./context/TEMPLATE.md) | \`pm\` & \`tech_lead\` | Product context, funnels, domains, and cross-repo priorities. |
| [\`context/<project>/<repo>.md\`](./context/REPO_TEMPLATE.md) | \`tech_lead\` / \`infra_head\` | Per-repository architecture map read by Level 2 devs on boot. |
| [\`memory/\`](./memory/TEMPLATE.md) | Every Agent | Persistent role-specific procedural memory (\`< 150 lines\`). |
| [\`worklist/COLLATED_BACKLOG.md\`](./worklist/COLLATED_BACKLOG.md) | \`pm\` / \`cto\` / \`cbo\` | Unified cross-project backlog and \`[NEEDS_CEO]\` queue. |
| [\`standups/\`](./standups/TEMPLATE.md) | \`warden\` / \`cto\` | Daily Standup Minutes of Meeting (MoM) and sprint lock tables. |
| [\`contracts/\`](./contracts/) | \`tech_lead\` | Shared API/schema contracts locked before parallel FE/BE work. |
| [\`chats/\`](./chats/TEMPLATE.md) | All Agents | Single-file-per-session inter-agent handoff log. |
`
);

// ----------------------------------------------------------------------------
// 5. MUSE.md
// ----------------------------------------------------------------------------
writeFile(
  'MUSE.md',
  `# MUSE.md — Muse Code Command Center Instructions (\`warden\`)

@AGENTS.md

## Muse Code Native Subagent Binding

When running inside **Muse Code**, you are **\`warden\` (CEO Office Chief of Staff)** in the main chat.
Delegate work down the hierarchy using the pre-configured subagents in [\`.claude/agents/\`](./.claude/agents/):

| Subagent File | Role | Level | Scope |
| :--- | :--- | :--- | :--- |
| \`.claude/agents/cto.md\` | \`cto\` (Head of Tech) | Level 0 | All tech & infra projects (\`context/cto.md\`). |
| \`.claude/agents/cbo.md\` | \`cbo\` (Chief Business Officer) | Level 0 | Revenue, ROI, and founder hour allocation (\`context/cbo.md\`). |
| \`.claude/agents/pm.md\` | \`pm\` (Product Manager) | Level 1 | Project backlogs (\`worklist/<project>/backlog.md\`) & \`COLLATED_BACKLOG.md\`. |
| \`.claude/agents/tech_lead.md\` | \`tech_lead\` (Project Tech Lead) | Level 1 | Repo architecture (\`context/<project>/<repo>.md\`) & \`contracts/\`. |
| \`.claude/agents/infra_head.md\` | \`infra_head\` (Head of Infra) | Level 1 | Cloud infrastructure, FinOps, and deployments. |
| \`.claude/agents/backend_dev.md\` | \`backend_dev\` (Backend Dev) | Level 2 | Server, API, and database implementation (N parallel workers). |
| \`.claude/agents/frontend_dev.md\` | \`frontend_dev\` (Frontend Dev) | Level 2 | UI, client, and state implementation (N parallel workers). |
| \`.claude/agents/infra_jr.md\` | \`infra_jr\` (Infra Engineer) | Level 2 | IaC, deployment scripts, and cloud operations. |
`
);

// ----------------------------------------------------------------------------
// 6. .agents/skills/* (commando-orchestrator, standup, pushit, onboard-project)
// ----------------------------------------------------------------------------
writeFile(
  '.agents/skills/commando-orchestrator/SKILL.md',
  `---
name: commando-orchestrator
description: >-
  Orchestrates the Commando corporate & technical hierarchy: warden (Chief of Staff)
  -> cto & cbo (Level 0, Model: pro) -> pm, tech_lead, & infra_head (Level 1)
  -> backend_dev, frontend_dev, & infra_jr (Level 2). Supports Direct-to-Agent
  (@agent) granular mode and Daily Standups.
---

# Commando Orchestrator Skill

## Step 1: Operational Rules
1. **Single Session Log File**: Create **only ONE** chat log file in \`chats/\` per session (\`chats/<YYYY-MM-DD>-session-<short-id>.md\`). Append every inter-agent handoff to that file.
2. **ASD-STE100 + Visuals + Tables**: Present all executive reports using ASD-STE100 active voice, Mermaid diagrams, and Markdown tables.
3. **Zero-Popup Mirror Protocol**:
   - Run \`node scripts/repo-tool.mjs sync-in\` before spawning Level 2 subagents.
   - Subagents edit \`.state/mirror/<repo-alias>/\` with \`BypassSandbox: false\`.
   - Run \`node scripts/repo-tool.mjs sync-out\` after subagents complete work.

---

## Step 2: Subagent Blueprints (\`define_subagent\`)

### 1. Level 0: \`cto\` (Invoke with \`Model: "pro"\`)
\`\`\`json
{
  "Name": "cto",
  "Description": "Level 0 Head of Tech (CTO). Reports to warden. Owns context/cto.md, memory/cto.md, and .state/topology-cache.json. Chairs Daily Standups, makes final technical calls, and orchestrates pm, tech_lead, and infra_head.",
  "EnableWriteTools": true,
  "EnableSubagentTools": true,
  "SystemPrompt": "You are the CTO (cto - Level 0 Head of Tech) reporting to warden. On startup, read context/cto.md, memory/cto.md, projects.yaml, and .state/topology-cache.json. Coordinate pm, project tech_leads, and infra_head. Never execute code changes without explicit CEO approval (Phase 1.5 gate). Format all reports in strict ASD-STE100 using Markdown tables and Mermaid diagrams."
}
\`\`\`

### 2. Level 0: \`cbo\` (Invoke with \`Model: "pro"\`)
\`\`\`json
{
  "Name": "cbo",
  "Description": "Level 0 Chief Business Officer (CBO). Reports to warden and CEO. Owns context/cbo.md and memory/cbo.md. Evaluates projects and backlog items by Fiscal Revenue, Strategic ROI, and Opportunity Cost per CEO Hour.",
  "EnableWriteTools": true,
  "EnableSubagentTools": true,
  "SystemPrompt": "You are the Chief Business Officer (cbo - Level 0) reporting to warden and the CEO. On startup, read context/cbo.md, memory/cbo.md, and worklist/COLLATED_BACKLOG.md. Rank priorities by revenue impact, ROI, and founder hour efficiency. Format all outputs in strict ASD-STE100 using Markdown tables and Mermaid charts."
}
\`\`\`

### 3. Level 1: \`pm\` (Per-Project Product Manager)
\`\`\`json
{
  "Name": "pm",
  "Description": "Level 1 Per-Project Product Manager (@pm:<project>). Reports to cto. Maintains prioritized (P0/P1/P2) backlogs in worklist/<project>/backlog.md, syncs worklist/COLLATED_BACKLOG.md, and tracks [NEEDS_CEO] blockers.",
  "EnableWriteTools": true,
  "EnableSubagentTools": true,
  "SystemPrompt": "You are the Product Manager (pm - Level 1) for your assigned project. Read memory/pm.md, worklist/inbox.md, worklist/<project>/backlog.md, worklist/COLLATED_BACKLOG.md, and context/<project>.md. Triage raw ideas from worklist/inbox.md, surface [NEEDS_CEO] tasks (QUESTION, API_KEY, MANUAL_ACTION, DECISION), and output structured Markdown tables."
}
\`\`\`

### 4. Level 1: \`tech_lead\` (Project Tech Lead)
\`\`\`json
{
  "Name": "tech_lead",
  "Description": "Level 1 Project Tech Lead (@tech_lead:<project>). Reports to cto. Owns context/<project>/<repo>.md, memory/<project>/tech_lead.md, and contracts/<project>-*.md. Directs parallel backend_dev and frontend_dev workers.",
  "EnableWriteTools": true,
  "EnableSubagentTools": true,
  "SystemPrompt": "You are the Project Tech Lead (tech_lead - Level 1). Read memory/<project>/tech_lead.md, context/<project>.md, and context/<project>/<repo>.md. Lock API contracts in contracts/<project>-<slug>.md before code execution. Chunk independent tasks and spawn multiple parallel backend_dev and frontend_dev subagents editing .state/mirror/<repo-alias>/ with BypassSandbox: false."
}
\`\`\`

### 5. Level 1: \`infra_head\` (Head of Infrastructure)
\`\`\`json
{
  "Name": "infra_head",
  "Description": "Level 1 Head of Infrastructure (@infra_head). Reports to cto. Owns cloud architecture, FinOps, CI/CD, and deployment pipelines via infra_jr.",
  "EnableWriteTools": true,
  "EnableSubagentTools": true,
  "SystemPrompt": "You are the Head of Infrastructure (infra_head - Level 1) reporting to cto. Read memory/infra_head.md and context/cloud-infra.md. Direct infra_jr to inspect and update infrastructure scripts inside .state/mirror/ and coordinate deployments across projects."
}
\`\`\`

### 6. Level 2: \`backend_dev\`, \`frontend_dev\`, \`infra_jr\`
\`\`\`json
{
  "Name": "backend_dev",
  "Description": "Level 2 Backend Developer. Implements server, API, and DB changes inside .state/mirror/<repo-alias>/.",
  "EnableWriteTools": true,
  "EnableSubagentTools": true,
  "SystemPrompt": "You are a Level 2 Backend Developer reporting to tech_lead. Read memory/<project>/backend_dev.md and context/<project>/<repo>.md first. Edit only backend files inside .state/mirror/<repo-alias>/ with BypassSandbox: false."
}
\`\`\`
\`\`\`json
{
  "Name": "frontend_dev",
  "Description": "Level 2 Frontend Developer. Implements UI, client, and state changes inside .state/mirror/<repo-alias>/.",
  "EnableWriteTools": true,
  "EnableSubagentTools": true,
  "SystemPrompt": "You are a Level 2 Frontend Developer reporting to tech_lead. Read memory/<project>/frontend_dev.md and context/<project>/<repo>.md first. Edit only frontend files inside .state/mirror/<repo-alias>/ with BypassSandbox: false."
}
\`\`\`
\`\`\`json
{
  "Name": "infra_jr",
  "Description": "Level 2 Infrastructure & DevOps Engineer reporting to infra_head.",
  "EnableWriteTools": true,
  "EnableSubagentTools": true,
  "SystemPrompt": "You are a Level 2 Infrastructure Engineer reporting to infra_head. Read memory/infra_jr.md first. Operate inside .state/mirror/ with BypassSandbox: false and enforce dry-run safety before destructive cloud operations."
}
\`\`\`
`
);

// Copy our updated standup and pushit skills (sanitizing project-specific references)
writeFile(
  '.agents/skills/standup/SKILL.md',
  `---
name: standup
description: >-
  Runs the Daily Standup when the CEO says "standup" or "/standup". Senior agents
  (cto, cbo, per-project PMs, project tech_leads, infra_head) poll their teams,
  triage worklist/inbox.md into worklist/<project>/backlog.md and
  worklist/COLLATED_BACKLOG.md, surface [NEEDS_CEO] blockers, and write
  standups/<YYYY-MM-DD>-standup.md using strict ASD-STE100, Mermaid diagrams,
  and Markdown tables.
---

# Daily Standup Skill (\`standup\` / \`/standup\`)

## Core Standup Rules

1. **ASD-STE100 + Visual-First + Table-First Standard (MANDATORY)**:
   - **ASD-STE100**: Use active voice only. Keep procedural sentences $\\le 20$ words and descriptive sentences $\\le 25$ words. Put 1 fact or instruction per sentence.
   - **Maximum Visuals**: Include Mermaid charts (\`xychart-beta\`, \`flowchart\`, \`stateDiagram-v2\`) and visual widgets to display sprint velocity, task movements, and blockers.
   - **Maximum Tables**: Present all standup sections as structured Markdown tables. Never output walls of prose.
2. **Standup Outputs**:
   - **🚨 Tasks Requiring CEO Intervention (\`[NEEDS_CEO]\`)**: \`QUESTION\`, \`API_KEY\`, \`MANUAL_ACTION\`, \`DECISION\`.
   - **🗓️ What is Decided for the Week**: Weekly sprint commitments per project (\`P0\` $\\rightarrow$ \`P1\` $\\rightarrow$ \`P2\`).
   - **🔄 Moving Around Tasks**: Explicit table of board transitions (\`INBOX -> TODO\`, \`TODO -> IN_PROGRESS\`, \`* -> NEEDS_CEO\`, \`IN_PROGRESS -> DONE\`).

---

## The 5-Stage Standup Workflow

| Stage | Owner | Action | Output |
| :--- | :--- | :--- | :--- |
| **Stage 1: Team Poll** | \`warden\` $\\rightarrow$ \`cto\` & \`cbo\` | Poll \`pm\`, \`tech_lead\`, and \`infra_head\` across all projects in \`projects.yaml\`. Check git status via \`scripts/repo-tool.mjs\`. | Raw team status & git audit. |
| **Stage 2: Backlog Sync** | \`pm\`, \`cto\`, \`cbo\` | Triage \`worklist/inbox.md\` into \`worklist/<project>/backlog.md\` and sync \`worklist/COLLATED_BACKLOG.md\`. | Prioritized weekly sprint plan. |
| **Stage 3: Write MoM** | \`warden\` / \`cto\` | Write \`standups/<YYYY-MM-DD>-standup.md\` following \`standups/TEMPLATE.md\`. | Visual charts + Markdown tables. |
| **Stage 4: CEO Gate** | **CEO** | Review MoM tables, resolve \`[NEEDS_CEO]\` items, and reply \`"Approve"\`. | Explicit execution sign-off. |
| **Stage 5: Execute & Push** | Level 1 $\\rightarrow$ Level 2 | Run \`sync-in\`, execute tasks in parallel, run \`sync-out\`, verify builds, and run \`pushit\`. | Shipped code + \`COMPLETED_AND_PUSHED\`. |
`
);

const pushitSkillContent = fs.readFileSync(
  path.join(ROOT, '.agents', 'skills', 'pushit', 'SKILL.md'),
  'utf8'
);
writeFile('.agents/skills/pushit/SKILL.md', pushitSkillContent);

writeFile(
  '.agents/skills/onboard-project/SKILL.md',
  `---
name: onboard-project
description: >-
  Onboards a new or existing local repository into Commando when the CEO says
  "onboard <project>" or runs npm run init. Scans repository topology, creates
  context/<project>.md, context/<project>/<repo>.md, worklist/<project>/backlog.md,
  and memory/<project>/*.md.
---

# Onboard Project Skill (\`onboard <project>\`)

When the CEO says **"onboard \`<project>\`"** (or provides a repository path):

| Step | Agent | Action | Target File |
| :--- | :--- | :--- | :--- |
| **1. Register Path** | \`warden\` | Add project slug and folder path(s) to \`projects.yaml\` and run \`npm run init\`. | \`projects.yaml\`, \`.state/topology-cache.json\` |
| **2. Deep Repo Scan** | \`tech_lead:<project>\` | Inspect \`package.json\`, directory tree, routes, and schemas via \`node scripts/repo-tool.mjs tree <project>\`. | \`context/<project>/<repo>.md\` |
| **3. Product & GTM Context** | \`pm:<project>\` | Populate product summary, domains, user funnel, and initial \`P0\`/\`P1\`/\`P2\` tasks. | \`context/<project>.md\`, \`worklist/<project>/backlog.md\` |
| **4. Master Rollup** | \`cto\` & \`cbo\` | Add project to \`worklist/COLLATED_BACKLOG.md\` and \`context/cto.md\`. | \`worklist/COLLATED_BACKLOG.md\` |
`
);

// ----------------------------------------------------------------------------
// 7. .claude/agents/*.md (For Muse Code users)
// ----------------------------------------------------------------------------
const MUSE_AGENTS = [
  {
    name: 'cto',
    desc: 'Level 0 Head of Tech. Chairs Daily Standups, owns context/cto.md, and orchestrates pm, tech_lead, and infra_head.',
    body: 'You are `cto` (Level 0 Head of Tech) reporting to `warden`. Read `context/cto.md`, `memory/cto.md`, and `.state/topology-cache.json` on startup. Enforce the Phase 1.5 CEO Approval Gate before code execution. Write all reports in strict ASD-STE100 using Markdown tables and Mermaid diagrams.',
  },
  {
    name: 'cbo',
    desc: 'Level 0 Chief Business Officer. Owns context/cbo.md and ranks priorities by revenue, ROI, and founder hour cost.',
    body: 'You are `cbo` (Level 0 Chief Business Officer) reporting to `warden` and the CEO. Read `context/cbo.md`, `memory/cbo.md`, and `worklist/COLLATED_BACKLOG.md` on startup. Rank tasks by fiscal ROI and opportunity cost per CEO hour. Format all reports in ASD-STE100 tables and charts.',
  },
  {
    name: 'pm',
    desc: 'Level 1 Per-Project Product Manager. Owns worklist/<project>/backlog.md, worklist/COLLATED_BACKLOG.md, and [NEEDS_CEO] queue.',
    body: 'You are `pm` (Level 1 Product Manager). Read `memory/pm.md`, `worklist/inbox.md`, `worklist/<project>/backlog.md`, and `worklist/COLLATED_BACKLOG.md`. Triage inbox items, maintain P0/P1/P2 priorities, and surface `[NEEDS_CEO]` blockers in Markdown tables.',
  },
  {
    name: 'tech_lead',
    desc: 'Level 1 Project Tech Lead. Owns context/<project>/<repo>.md and contracts/, and directs backend_dev and frontend_dev.',
    body: 'You are `tech_lead` (Level 1 Project Tech Lead). Read `memory/<project>/tech_lead.md` and `context/<project>/<repo>.md` first. Lock contracts in `contracts/` before cross-stack changes and dispatch parallel `backend_dev` and `frontend_dev` tasks.',
  },
  {
    name: 'infra_head',
    desc: 'Level 1 Head of Infrastructure. Owns cloud architecture, FinOps, and deployments via infra_jr.',
    body: 'You are `infra_head` (Level 1 Head of Infrastructure) reporting to `cto`. Read `memory/infra_head.md` and oversee cloud scripts, backups, monitoring, and deployments via `infra_jr`.',
  },
  {
    name: 'backend_dev',
    desc: 'Level 2 Backend Developer. Implements server, API, and database tasks.',
    body: 'You are `backend_dev` (Level 2) reporting to `tech_lead`. Always read `memory/<project>/backend_dev.md` and `context/<project>/<repo>.md` before editing backend files.',
  },
  {
    name: 'frontend_dev',
    desc: 'Level 2 Frontend Developer. Implements UI, client, and state tasks.',
    body: 'You are `frontend_dev` (Level 2) reporting to `tech_lead`. Always read `memory/<project>/frontend_dev.md` and `context/<project>/<repo>.md` before editing frontend files.',
  },
  {
    name: 'infra_jr',
    desc: 'Level 2 Infrastructure & DevOps Engineer reporting to infra_head.',
    body: 'You are `infra_jr` (Level 2) reporting to `infra_head`. Always read `memory/infra_jr.md` first and enforce `--dry-run` safety on infrastructure changes.',
  },
];

for (const agent of MUSE_AGENTS) {
  writeFile(
    `.claude/agents/${agent.name}.md`,
    `---
name: ${agent.name}
description: ${agent.desc}
---

${agent.body}
`
  );
}

// ----------------------------------------------------------------------------
// 8. Dynamic Scripts (`scripts/repo-tool.mjs` & `scripts/init-kit.mjs`)
// ----------------------------------------------------------------------------
writeFile(
  'scripts/repo-tool.mjs',
  `#!/usr/bin/env node
/**
 * Commando Kit Unified Repo Access & Mirror Tool (\`scripts/repo-tool.mjs\`)
 *
 * Dynamically parses \`projects.yaml\` and provides:
 *   - pull-check <project|repo|all>
 *   - sync-in [project|repo]
 *   - sync-out [project|repo]
 *   - tree <project|repo>
 *   - status [project|repo]
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const COMMANDO_ROOT = path.resolve(__dirname, '..');
const MIRROR_ROOT = path.join(COMMANDO_ROOT, '.state', 'mirror');
const MANIFEST_PATH = path.join(MIRROR_ROOT, 'manifest.json');
const PROJECTS_YAML_PATH = path.join(COMMANDO_ROOT, 'projects.yaml');

export function parseProjectsYaml() {
  if (!fs.existsSync(PROJECTS_YAML_PATH)) return { projects: {}, aliases: {} };
  const lines = fs.readFileSync(PROJECTS_YAML_PATH, 'utf8').split(/\\r?\\n/);
  const projects = {};
  const aliases = {};
  let currentProject = null;
  let inProjects = false;

  for (const rawLine of lines) {
    const line = rawLine.replace(/#.*$/, '');
    if (!line.trim()) continue;
    if (/^projects:\\s*$/.test(line)) {
      inProjects = true;
      continue;
    }
    if (/^[a-zA-Z0-9_-]+:\\s*$/.test(line) && !line.startsWith(' ')) {
      inProjects = false;
      currentProject = null;
      continue;
    }
    if (!inProjects) continue;

    const projMatch = line.match(/^\\s{2}([a-zA-Z0-9_.-]+):\\s*$/);
    if (projMatch) {
      currentProject = projMatch[1];
      projects[currentProject] = [];
      continue;
    }
    const folderMatch = line.match(/^\\s+-\\s+(.+)$/);
    if (folderMatch && currentProject) {
      const folderPath = folderMatch[1].trim().replace(/^['"]|['"]$/g, '');
      if (!folderPath.startsWith('/absolute/path/to/')) {
        projects[currentProject].push(folderPath);
        aliases[path.basename(folderPath)] = folderPath;
      }
    }
  }
  return { projects, aliases };
}

const { projects: PROJECT_REPOS, aliases: REPO_ALIASES } = parseProjectsYaml();
const [, , action, ...args] = process.argv;

function expandTargets(targets) {
  if (!targets.length || targets[0] === 'all') {
    return Object.values(REPO_ALIASES);
  }
  const out = [];
  for (const t of targets) {
    if (PROJECT_REPOS[t]) out.push(...PROJECT_REPOS[t]);
    else if (REPO_ALIASES[t]) out.push(REPO_ALIASES[t]);
    else out.push(path.resolve(t));
  }
  return [...new Set(out)];
}

function sha256(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function copyDirFiltered(src, dest, manifest, alias, relBase = '') {
  if (!fs.existsSync(src)) return;
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    if (['node_modules', '.git', 'dist', 'build', '.next', 'target', '.DS_Store'].includes(entry.name)) continue;
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    const relPath = path.join(relBase, entry.name);
    if (entry.isDirectory()) {
      copyDirFiltered(srcPath, destPath, manifest, alias, relPath);
    } else if (entry.isFile()) {
      const stat = fs.statSync(srcPath);
      if (stat.size > 5 * 1024 * 1024) continue; // skip binaries > 5MB
      fs.copyFileSync(srcPath, destPath);
      manifest[\`\${alias}::\${relPath}\`] = {
        repoPath: srcPath,
        mirrorPath: destPath,
        hash: sha256(srcPath),
      };
    }
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  switch (action) {
    case 'pull-check': {
      for (const repo of expandTargets(args)) {
        if (!fs.existsSync(repo)) continue;
        console.log(\`=== PULL-CHECK: \${repo} ===\`);
        try {
          execSync('git fetch --quiet', { cwd: repo, stdio: 'inherit' });
          const status = execSync('git status -sb', { cwd: repo, encoding: 'utf8' });
          console.log(status.trim());
        } catch (err) {
          console.error(\`[NEEDS_CEO] Git pull-check failed for \${repo}: \${err.message}\`);
        }
      }
      break;
    }
    case 'sync-in': {
      fs.mkdirSync(MIRROR_ROOT, { recursive: true });
      const manifest = {};
      for (const repo of expandTargets(args)) {
        if (!fs.existsSync(repo)) continue;
        const alias = path.basename(repo);
        const dest = path.join(MIRROR_ROOT, alias);
        fs.rmSync(dest, { recursive: true, force: true });
        copyDirFiltered(repo, dest, manifest, alias);
        console.log(\`Mirrored \${repo} -> .state/mirror/\${alias}\`);
      }
      fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2));
      break;
    }
    case 'sync-out': {
      if (!fs.existsSync(MANIFEST_PATH)) {
        console.log('No mirror manifest found. Run sync-in first.');
        break;
      }
      const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
      let syncedCount = 0;
      for (const item of Object.values(manifest)) {
        if (fs.existsSync(item.mirrorPath)) {
          const currentHash = sha256(item.mirrorPath);
          if (currentHash !== item.hash) {
            fs.mkdirSync(path.dirname(item.repoPath), { recursive: true });
            fs.copyFileSync(item.mirrorPath, item.repoPath);
            console.log(\`Synced out modified file -> \${item.repoPath}\`);
            syncedCount++;
          }
        }
      }
      console.log(\`sync-out complete (\${syncedCount} file(s) updated).\`);
      break;
    }
    case 'tree': {
      for (const repo of expandTargets(args)) {
        console.log(\`=== TREE: \${repo} ===\`);
        if (!fs.existsSync(repo)) continue;
        for (const entry of fs.readdirSync(repo)) {
          if (!['node_modules', '.git', 'dist'].includes(entry)) {
            console.log(\`  \${entry}\`);
          }
        }
      }
      break;
    }
    default:
      console.log('Usage: node scripts/repo-tool.mjs <pull-check|sync-in|sync-out|tree> [target]');
  }
}
`
);

writeFile(
  'scripts/init-kit.mjs',
  `#!/usr/bin/env node
/**
 * Commando Kit Interactive Initializer (\`npm run init\`)
 *
 * Reads \`projects.yaml\` and scaffolds:
 *   - context/<project>.md & context/<project>/<repo>.md
 *   - memory/<project>/{pm,tech_lead,backend_dev,frontend_dev}.md
 *   - worklist/<project>/backlog.md
 *   - .state/topology-cache.json
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseProjectsYaml } from './repo-tool.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const { projects } = parseProjectsYaml();

const topology = {
  generatedAt: new Date().toISOString(),
  projects: {},
};

const projectNames = Object.keys(projects);
if (projectNames.length === 0) {
  console.log('No configured projects found in projects.yaml. Edit projects.yaml first.');
  process.exit(0);
}

for (const [proj, folders] of Object.entries(projects)) {
  topology.projects[proj] = folders.map((f) => ({
    path: f,
    name: path.basename(f),
    exists: fs.existsSync(f),
  }));

  // 1. Context files
  const projContextPath = path.join(ROOT, 'context', \`\${proj}.md\`);
  if (!fs.existsSync(projContextPath)) {
    const tpl = fs.readFileSync(path.join(ROOT, 'context', 'TEMPLATE.md'), 'utf8');
    fs.writeFileSync(projContextPath, tpl.replaceAll('<project-name>', proj));
  }

  for (const folder of folders) {
    const repoName = path.basename(folder);
    const repoContextPath = path.join(ROOT, 'context', proj, \`\${repoName}.md\`);
    if (!fs.existsSync(repoContextPath)) {
      fs.mkdirSync(path.dirname(repoContextPath), { recursive: true });
      const repoTpl = fs.readFileSync(path.join(ROOT, 'context', 'REPO_TEMPLATE.md'), 'utf8');
      fs.writeFileSync(
        repoContextPath,
        repoTpl
          .replaceAll('<project>', proj)
          .replaceAll('<repo-name>', repoName)
          .replaceAll('/absolute/path/to/<repo-name>', folder)
      );
    }
  }

  // 2. Memory files
  for (const role of ['pm', 'tech_lead', 'backend_dev', 'frontend_dev']) {
    const memPath = path.join(ROOT, 'memory', proj, \`\${role}.md\`);
    if (!fs.existsSync(memPath)) {
      fs.mkdirSync(path.dirname(memPath), { recursive: true });
      const memTpl = fs.readFileSync(path.join(ROOT, 'memory', 'TEMPLATE.md'), 'utf8');
      fs.writeFileSync(
        memPath,
        memTpl.replaceAll('<agent-role>', role).replaceAll('<scope>', proj).replaceAll('<level>', 'Level 1/2')
      );
    }
  }

  // 3. Project Backlog
  const backlogPath = path.join(ROOT, 'worklist', proj, 'backlog.md');
  if (!fs.existsSync(backlogPath)) {
    fs.mkdirSync(path.dirname(backlogPath), { recursive: true });
    fs.writeFileSync(
      backlogPath,
      \`# Project Backlog: \` +
        proj +
        \`\\n\\n## 🚨 1. Needs CEO Intervention ([NEEDS_CEO])\\n| Task ID | Priority | Type | Summary | Unblocks |\\n| :--- | :--- | :--- | :--- | :--- |\\n\\n## ⚡ 2. Active Weekly Sprint (P0 / P1)\\n| Task ID | Priority | Stage | Repo | Deliverable | Owner |\\n| :--- | :--- | :--- | :--- | :--- | :--- |\\n\`
    );
  }
}

fs.mkdirSync(path.join(ROOT, '.state'), { recursive: true });
fs.writeFileSync(path.join(ROOT, '.state', 'topology-cache.json'), JSON.stringify(topology, null, 2));
console.log(\`Initialized Commando Kit for \${projectNames.length} project(s): \${projectNames.join(', ')}\`);
`
);

// ----------------------------------------------------------------------------
// 9. Templates & Starter Context / Memory / Worklist / Standups
// ----------------------------------------------------------------------------
writeFile('context/TEMPLATE.md', fs.readFileSync(path.join(ROOT, 'context', 'TEMPLATE.md'), 'utf8'));
writeFile('context/REPO_TEMPLATE.md', fs.readFileSync(path.join(ROOT, 'context', 'REPO_TEMPLATE.md'), 'utf8'));
writeFile('memory/TEMPLATE.md', fs.readFileSync(path.join(ROOT, 'memory', 'TEMPLATE.md'), 'utf8'));
writeFile('chats/TEMPLATE.md', fs.readFileSync(path.join(ROOT, 'chats', 'TEMPLATE.md'), 'utf8'));

writeFile(
  'context/warden.md',
  `# Executive Context: \`warden\` (CEO Office Chief of Staff)

> **Owner**: \`@warden\`
> **Reporting Standard**: ASD-STE100 (Simplified Technical English), Visual Diagrams (\`mermaid\`), and Markdown Tables.

---

## 1. Core Operational Rules
| Rule | Enforcement |
| :--- | :--- |
| **ASD-STE100 Reporting** | Use active voice only. Keep action sentences $\\le 20$ words and descriptive sentences $\\le 25$ words. |
| **Visual-First & Table-First** | Use Mermaid diagrams and structured Markdown tables in every standup and executive summary. |
| **Ironclad CEO Gate** | Present plans and contracts first. Wait for explicit CEO approval before Level 2 code execution. |
| **Repo Operators Protocol** | Run \`pull-check\` before work and \`pushit\` after work completes. |
`
);

writeFile(
  'context/cto.md',
  `# Executive Tech Context: \`cto\` (Level 0 — Head of Tech)

> **Owner**: \`@cto\` (\`Model: pro\`)
> **Reports To**: \`@warden\` (Chief of Staff) & CEO

---

## 1. Cross-Project Technical Posture
| Project | Primary Stack | Architecture Status | Active Tech Lead |
| :--- | :--- | :--- | :--- |
| \`core-product\` | Configure in \`projects.yaml\` | \`READY_FOR_ONBOARDING\` | \`@tech_lead:core-product\` |
| \`growth-app\` | Configure in \`projects.yaml\` | \`READY_FOR_ONBOARDING\` | \`@tech_lead:growth-app\` |
| \`cloud-infra\` | Cloud / CI-CD / IaC | \`READY_FOR_ONBOARDING\` | \`@infra_head\` |
`
);

writeFile(
  'context/cbo.md',
  `# Executive Business Context: \`cbo\` (Level 0 — Chief Business Officer)

> **Owner**: \`@cbo\` (\`Model: pro\`)
> **Reports To**: \`@warden\` (Chief of Staff) & CEO

---

## 1. Portfolio Opportunity Cost & ROI Matrix
| Project | Revenue / Strategic Anchor | Weekly CEO Hour Budget | EV / Priority Rank |
| :--- | :--- | :--- | :--- |
| \`core-product\` | Primary Revenue Anchor | \`20h/wk\` | \`P0\` |
| \`growth-app\` | Growth & Expansion | \`10h/wk\` | \`P1\` |
| \`cloud-infra\` | Reliability & FinOps | \`2h/wk\` | \`P1\` |
`
);

for (const role of ['cto', 'cbo', 'pm', 'infra_head', 'infra_jr']) {
  writeFile(
    `memory/${role}.md`,
    `# Agent Working & Procedural Memory: \`${role}\`

> **Owner**: \`@${role}\`
> **Rule**: Keep under 150 lines. Read on startup; update after completing tasks.

---

## 1. Standing Directives
- Follow strict **ASD-STE100** (active voice, $\\le 20$ words per instruction, $\\le 25$ words per description).
- Present all reports, standups, and status updates using **Mermaid diagrams** and **Markdown tables**.
- Never execute unapproved code changes; pause at the Phase 1.5 CEO Approval Gate.

---

## 2. Hard-Won Lessons & Repo Gotchas
- *(Populated automatically as tasks execute)*

---

## 3. Recent Session Memory Log (Last 5 Tasks)
- \`INITIALIZED\`: Ready for first project onboarding and Daily Standup.
`
  );
}

writeFile(
  'worklist/inbox.md',
  `# CEO & Cross-Department Raw Backlog Inbox (\`worklist/inbox.md\`)

> Drop raw feature ideas, bug reports, infra tasks, or GTM notes below. Per-project PMs (\`@pm:<project>\`) triage these into \`worklist/<project>/backlog.md\` and \`worklist/COLLATED_BACKLOG.md\` during Daily Standups.

---

## 1. Raw CEO Idea Dump (Untriaged)

### A. \`core-product\` (\`@pm:core-product\`)
- *(Drop raw ideas here)*

### B. \`growth-app\` (\`@pm:growth-app\`)
- *(Drop raw ideas here)*

### C. Infrastructure & DevOps (\`@infra_head\`)
- *(Drop cloud, CI/CD, or FinOps tasks here)*
`
);

writeFile('worklist/INBOX_TEMPLATE.md', fs.readFileSync(path.join(DIST_DIR, 'worklist/inbox.md'), 'utf8'));

writeFile(
  'worklist/COLLATED_BACKLOG.md',
  `# Collated CTO & CBO Master Backlog (\`worklist/COLLATED_BACKLOG.md\`)

> **Owners**: \`@cto\`, \`@cbo\`, and Per-Project \`@pm:<project>\`

---

## 🚨 1. CEO / Human Intervention Queue (\`[NEEDS_CEO]\`)
| Task ID | Priority | Project | Type (\`QUESTION\` / \`API_KEY\` / \`MANUAL_ACTION\` / \`DECISION\`) | Requested By | Action Required from CEO | Unblocks |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| \`NONE\` | \`-\` | \`-\` | \`-\` | \`-\` | Zero blockers queued. | \`-\` |

---

## 🗓️ 2. Active Weekly Sprint Plan (\`P0\` -> \`P1\` -> \`P2\`)
| Task ID | Priority | Project | Stage | Repo(s) | Deliverable | Owner |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| \`INIT-01\` | \`P0\` | \`all\` | \`TODO\` | \`projects.yaml\` | Add local repo paths to \`projects.yaml\` and run \`npm run init\`. | \`@warden\` |
`
);

writeFile(
  'standups/TEMPLATE.md',
  `# Daily Standup MoM, Weekly Sprint Plan & Task Movements — \`<YYYY-MM-DD>\`

> **Chair**: \`warden\` (Chief of Staff), \`cto\` (Head of Tech), & \`cbo\` (Chief Business Officer)
> **Standard**: Strict ASD-STE100 + Visual Diagrams + Structured Markdown Tables
> **Status**: \`AWAITING_CEO_APPROVAL\` | \`APPROVED_EXECUTING\` | \`COMPLETED_AND_PUSHED\`

---

## 1. Executive Summary & Visual Sprint Telemetry

### 1A. Executive Pulse Table
| Metric | Count | Status | Action Required |
| :--- | :--- | :--- | :--- |
| **Tasks Shipped Since Last Standup** | \`<N>\` | \`VERIFIED\` | None |
| **Active Weekly Sprint Tasks (\`P0\`/\`P1\`)** | \`<N>\` | \`IN_PROGRESS\` | Approve sprint lock |
| **CEO Blockers (\`[NEEDS_CEO]\`)** | \`<N>\` | \`BLOCKED\` | Resolve Section 2 items |
| **Board Transitions Today** | \`<N>\` | \`SYNCED\` | Review Section 4 ledger |

### 1B. Visual Sprint Telemetry
\`\`\`mermaid
xychart-beta
    title "Weekly Sprint Tasks by Project (Done vs Active vs Blocked)"
    x-axis ["core-product", "growth-app", "cloud-infra"]
    y-axis "Task Count" 0 --> 10
    bar [3, 2, 2]
    line [1, 0, 1]
\`\`\`

\`\`\`mermaid
flowchart LR
    INBOX["📥 Inbox"] -->|Triage| TODO["📋 Todo"]
    TODO -->|Sprint Lock| ACTIVE["⚡ In Progress"]
    ACTIVE -->|Blocker| CEO["🚨 NEEDS_CEO"]
    CEO -->|CEO Unblocks| ACTIVE
    ACTIVE -->|pushit| DONE["✅ Done"]
\`\`\`

---

## 🚨 2. Tasks Requiring CEO / Human Intervention (\`[NEEDS_CEO]\`)
| Task ID | Priority | Project | Type | Requested By | What CEO Needs To Do | Unblocks |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| \`<ID>\` | \`P0\` | \`<project>\` | \`API_KEY / QUESTION\` | \`@<agent>\` | \`<Action in <= 20 words>\` | \`<Task ID>\` |

---

## 🗓️ 3. What is Decided for the Week (Weekly Sprint Plan)
| Task ID | Priority | Project | Stage | Repo(s) | Weekly Deliverable (ASD-STE100) | Owner |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| \`<ID>\` | \`P0\` | \`<project>\` | \`IN_PROGRESS\` | \`<repo>\` | \`<Deliverable in <= 25 words>\` | \`@<agent>\` |

---

## 🔄 4. Moving Around Tasks (Board Transitions)
| Task ID | Project | Movement (\`From -> To\`) | Priority Change | Moved By | Reason (ASD-STE100) |
| :--- | :--- | :--- | :--- | :--- | :--- |
| \`<ID>\` | \`<project>\` | \`INBOX -> TODO\` | \`-> P1\` | \`@pm:<project>\` | Triaged raw idea into project backlog. |

---

## 🤝 5. Cross-Team Dependencies & Handshakes
| Requesting Team | Providing Team | Dependency / Handoff | Target Resolution |
| :--- | :--- | :--- | :--- |
| \`@tech_lead:<project>\` | \`@infra_head\` | \`<Deployment or cloud resource handoff>\` | \`Today\` |

---

## 6. End-of-Standup Execution & Deployment Table *(Updated After CEO Approval)*
| Category | Repo / Scope | Status | Commit Hash & Version |
| :--- | :--- | :--- | :--- |
| **CEO Blockers** | \`<project>\` | \`RESOLVED\` | \`<Details>\` |
| **Code & Tests** | \`<repo>\` | \`PASSED\` | \`<Details>\` |
| **Deployments** | \`<target>\` | \`LIVE\` | \`<Details>\` |
| **\`pushit\` Sweep** | \`<repo>\` | \`PUSHED\` | \`<Hash & Version>\` |
`
);

writeFile('worklist/todo/.gitkeep', '');
writeFile('worklist/done/.gitkeep', '');
writeFile('contracts/.gitkeep', '');
writeFile(
  '.state/topology-cache.json',
  JSON.stringify({ generatedAt: new Date().toISOString(), projects: {} }, null, 2) + '\n'
);

// ----------------------------------------------------------------------------
// 10. Automated Zero-Leak Security Audit Gate
// ----------------------------------------------------------------------------
function walkFiles(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walkFiles(full, out);
    else out.push(full);
  }
  return out;
}

const allDistFiles = walkFiles(DIST_DIR);
const leaks = [];

for (const file of allDistFiles) {
  const content = fs.readFileSync(file, 'utf8').toLowerCase();
  for (const token of FORBIDDEN_TOKENS) {
    if (content.includes(token.toLowerCase())) {
      leaks.push({ file: path.relative(DIST_DIR, file), token });
    }
  }
}

if (leaks.length > 0) {
  console.error('🚨 ZERO-LEAK AUDIT FAILED! Proprietary tokens found:');
  console.table(leaks);
  process.exit(1);
}

// Package into dist/commando-kit.zip
execSync(`cd "${ path.join(ROOT, 'dist') }" && zip -rq "${ZIP_PATH}" commando-kit`);

console.log(`✅ Built white-label Commando Kit (${allDistFiles.length} files, 0 proprietary leaks).`);
console.log(`📁 Folder: ${DIST_DIR}`);
console.log(`📦 Archive: ${ZIP_PATH}`);
