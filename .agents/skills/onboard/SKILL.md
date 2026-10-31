---
name: onboard
description: >-
  Interactive first-run onboarding skill. Interviews the CEO/operator and
  populates projects.yaml, .claude/settings.local.json, context/, memory/,
  worklist/, and .state/onboarded.json. Enforces zero-popup sandbox execution
  inside .state/mirror/<repo>.
---

# Onboarding Skill (`onboard` / `/onboard`)

Guides the CEO or operator through the initial workspace configuration or on-demand onboarding.
Interviews the user, registers projects, configures permissions, creates initial context and memory files, seeds the backlog, and marks the workspace ready for multi-agent execution.

---

## 1. Trigger Conditions

Run the onboarding flow when either of the following conditions is met:

- **First-Run Auto-Detection**:
  - `.state/onboarded.json` does not exist in the workspace root.
  - Or `projects.yaml` is missing or contains only example/placeholder paths.
  - In this state, `warden` automatically interrupts normal processing, welcomes the user, and initiates the onboarding interview before accepting task dispatches.
- **On-Demand Command**:
  - The operator types `onboard`, `/onboard`, `setup`, or asks `warden` to register new projects or reconfigure the workspace.

---

## 2. Four-Phase Onboarding Interview Protocol

Execute the following four phases in order. Keep all questions conversational, clear, and direct.

### Phase 1: Founder and Organization Profile

Gather operator context to seed executive decision-making:

- **Operator Identity**: Operator full name, preferred callsign, and role (CEO, Founder, Solo Operator).
- **Organization / Studio**: Company name, studio name, or umbrella organization name.
- **Core Mission & Vision**: Primary business objectives, product category, and target audience.
- **Working Cadence**: Timezone, daily working hours, and preferred daily standup time (default: 12:00 PM local time).
- **Communication Style**: Direct bullet points, level of technical detail, and escalation thresholds.

### Phase 2: Project and Repository Discovery

Collect the technical portfolio details:

- **Project Keys**: Short, slugified project identifiers (for example: `core-api`, `web-portal`, `infra-ops`).
- **Project Descriptions**: Single-sentence summary of each project's responsibility and business purpose.
- **Local Repository Paths**: Absolute local file paths to each repository or workspace directory.
- **Department Categorization**:
  - Designate which project serves as infrastructure (marked with `department: "infra"` for `infra_head` and `infra_jr`).
  - Categorize other projects as product engineering, frontend, backend, or growth.
- **Strategic Prioritization**:
  - Identify cashflow anchors (existing revenue or contract work).
  - Identify growth, hackathon, or speculative projects.
  - Designate default priority rankings (`P0` / `P1` / `P2`).

### Phase 3: Automated Artifact & Configuration Generation

Write all collected data to disk using the standard Commando schema:

- **`projects.yaml` Configuration**:
  - Write `projects.yaml` in the workspace root using the format defined in `projects.example.yaml`.
  - Include project names, descriptions, departments, and absolute folder paths.
  - Include `shared_search_roots` if projects share a parent directory.
- **IDE Permissions (`.claude/settings.local.json`)**:
  - Read existing `.claude/settings.local.json` (or start from `.claude/settings.example.json`).
  - Add each onboarded repository path and the Commando root to `additionalDirectories`.
  - Add matching `Read(<repo>/**)`, `Edit(<repo>/**)`, `Write(<repo>/**)`, and git command execution patterns to `permissions.allow`.
  - Write the updated file to `.claude/settings.local.json`.
- **Zero-Popup Sandbox Mirroring (`.state/mirror/<repo>`)**:
  - For each configured project, execute:
    `node scripts/repo-tool.mjs sync-in <project>`
  - This clones/pulls the external repository and mirrors the fresh source tree into `.state/mirror/<repo-alias>/`.
  - **Zero-Popup Guarantee**: All Level 2 developers (`frontend_dev`, `backend_dev`, `systems_cpp_dev`, `rust_lowlat_dev`, `xr_3d_dev`, `sec_auditor`, `infra_jr`) are instructed to work exclusively inside `.state/mirror/<repo-alias>/` with `BypassSandbox: false`. This keeps all file modifications inside the Commando workspace root, preventing IDE and OS security permission popups.
  - Upon task completion, changes are synced back and pushed using `node scripts/repo-tool.mjs sync-out <project>`.
- **`context/` Directory Initialization**:
  - `context/warden.md`: Write founder profile, core operating philosophy, working cadence, and delegation rules.
  - `context/cto.md`: Write technical landscape, project inventory, tech stack overview, and tech lead assignments.
  - `context/cbo.md`: Write business priorities, cashflow anchors, monetization models, and sprint evaluation criteria.
  - `context/<project>.md`: Write high-level project goals, architecture, and repo directory pointers.
  - `context/<project>/<repo>.md`: Write per-repo tech lead guidance, build/test commands, and conventions.
- **`memory/` Directory Initialization**:
  - Initialize long-term agent state files if they do not already exist:
    `memory/warden.md`, `memory/cto.md`, `memory/cbo.md`, `memory/pm.md`, `memory/infra_head.md`, `memory/designer.md`.
  - Initialize per-project memory:
    `memory/<project>/tech_lead.md`, `memory/<project>/frontend_dev.md`, `memory/<project>/backend_dev.md`.
- **`worklist/` Directory Initialization**:
  - `worklist/inbox.md`: Create raw idea drop zone with sections for each registered project.
  - `worklist/<project>/backlog.md`: Seed with initial tasks collected during the interview under `P0`, `P1`, and `P2` sections.
  - `worklist/COLLATED_BACKLOG.md`: Collate active projects into the master backlog with an initialized `🚨 Needs CEO / Human Intervention ([NEEDS_CEO])` queue.
- **`.state/onboarded.json` Creation**:
  - Write the state record confirming completed onboarding:
    ```json
    {
      "completed": true,
      "completedAt": "<ISO-8601-TIMESTAMP>",
      "version": "1.0.0",
      "operator": {
        "name": "<Operator Name>",
        "company": "<Company Name>",
        "timezone": "<Timezone>"
      },
      "projects": [
        {
          "id": "<project-key>",
          "description": "<project-description>",
          "department": "<department>",
          "folders": ["<repo-path>"]
        }
      ],
      "settingsConfigured": true,
      "mirrorInitialized": true
    }
    ```

### Phase 4: Verification and System Readiness Hand-off

Finalize system integrity checks:

- **Environment Verification**:
  - Check whether `.env` exists. If missing, copy `.env.example` to `.env` and inform operator of required API keys (e.g. `META_MUSE_API_KEY`, `DATABASE_URL`).
- **Topology Check**:
  - Run `node scripts/repo-tool.mjs list` to verify that all repository aliases and paths resolve cleanly.
- **Executive Hand-off**:
  - Present a concise ASD-STE100 completion summary to the operator.
  - Outline active project aliases, registered mirror folders, and IDE permissions.
  - Confirm readiness for executive directives, `@<agent>` direct routing, or the Daily Standup (`standup`).

---

## 3. Operating Constraints

- Never modify files outside `.state/mirror/` during active developer agent runs.
- Keep all upward communication concise and bullet-first.
- Never use diagrams (Mermaid) or Markdown tables. Always use concise bullet points and clean prose.
