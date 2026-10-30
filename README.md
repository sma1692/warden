# Warden — Autonomous Multi-Agent Command Center & Chief of Staff Framework

Warden is an open-source multi-agent orchestration framework designed for founders and engineering leaders. One human operator interacts with a single executive agent, `warden`. Warden orchestrates a corporate-style hierarchy of specialized agents across engineering, product, infrastructure, security, and growth, delivering compact, decision-ready briefs.

The framework runs natively inside AI agent IDEs (Google Antigravity, Claude Code) and operates as a standalone orchestrator with a live React web dashboard, dual Markdown/Postgres state engines, multi-channel reminders, and automated CLI/daemon execution.

---

## 1. The Bottom-Heavy Token Pyramid

Traditional multi-agent systems suffer from catastrophic context bloat. In naive swarm architectures, root orchestrators ingest entire codebases, multi-megabyte project histories, and complete backlogs on every conversational turn. This causes exponential token cost growth and high hallucination rates.

Warden solves this problem by inverting the token flow into a **Bottom-Heavy Token Pyramid**:

- **Root Level (`warden` — Chief of Staff)**:
  - Budget: Under 1,500 tokens per turn.
  - Strict Token Firewall: Never reads source code, repository directories, full topology caches, or raw task lists.
  - Responsibilities: Analyzes high-level user intent, routes tasks downward to C-Suite leads, and compresses responses into actionable briefs.
- **Level 0 C-Suite (`cto`, `cbo`)**:
  - Budget: Under 4,000 tokens per turn.
  - Strict Context Firewall: Reads only designated `context/<agent>.md` and `memory/<agent>.md` files. Forbidden from loading full code trees or project backlogs.
  - Responsibilities: The CTO governs cross-project architecture and chairs standups; the CBO evaluates commercial priorities, prize EV, and opportunity cost.
- **Level 1 Domain Leads (`pm`, `tech_lead`, `infra_head`, `sec_lead`, `designer`, `pa`)**:
  - Responsibilities: Own prioritized backlogs (`worklist/`), system specifications, API contracts (`contracts/`), cloud infrastructure runbooks, and security audits.
  - Role in Pyramid: Consume concise symbol digests from Reader Scouts, deconstruct high-level initiatives into minimal file-edit manifests (`FileEditDirective[]`), and assign atomic tasks to Level 2 developers.
- **Level 2 Sandboxed Developers & Scouts (`reader_scout`, `frontend_dev`, `backend_dev`, `systems_cpp_dev`, `rust_lowlat_dev`, `xr_3d_dev`, `infra_jr`, `sec_auditor`, `coder_applier`)**:
  - The wide base of the pyramid.
  - **Fast Read Scout (`reader_scout`)**: Scans raw codebases, runs grep/AST queries, and returns strictly $\le 150$-word symbol + line-range digests. Tier 1 never ingests raw code.
  - **Fast File Appliers**: Sandboxed execution inside isolated directory mirrors (`.state/mirror/`).
  - Scoped Sharding: Each developer works strictly on 1 to 3 assigned files per task shard.
- **Strict Upward Return Compression Caps**:
  - Level 2 Scout to Level 1: Under 150 words (symbol + line-range digest ONLY).
  - Level 2 Applier to Level 1: Under 200 words. Writes full diffs to disk; passes only file paths and brief status upward.
  - Level 1 to Level 0: Under 150 words. Delivers bullet points and contract file paths.
  - Level 0 to Root (`warden`): Under 120 words. Delivers high-level summaries and explicit human decision items (`[NEEDS_CEO]`).
- **Zero-Read Single-File Chat Logging**:
  - Maintains a single append-only log file per session (`chats/<YYYY-MM-DD>-session-<id>.md`).
  - Agents append progress via atomic stream writes without reading previous turns back into context, maintaining constant O(1) logging overhead.

---

## 2. Scout → Plan → Apply: Scout -> Architect -> Applier Protocol & Read+Write Cost Benchmark

Warden features a decoupled execution pipeline called **Scout → Plan → Apply**, separating raw code inspection, high-level strategic reasoning, and mechanical code modification.

- **Three-Stage Execution Flow**:
  - **Phase 1: Fast Read Scout (Scout pass)**: Level 2 `reader_scout` subagents inspect raw source trees, execute AST and grep lookups, and emit an ultra-compact symbol and line-range digest ($\le 150$ words). Tier 1 models NEVER ingest full source files.
  - **Phase 2: High-Reasoning Architect (Tier 1)**: Level 0 and Level 1 agents (`warden`, `cto`, `pm`, `tech_lead`, `sec_lead`, `infra_head`) consume only the compressed digest. Using frontier reasoning models (Claude 3.7 Sonnet, Gemini 2.5 Pro, GPT-4o, Grok-2), they solve architectural constraints and produce minimal `FileEditDirective[]` manifests.
  - **Phase 3: Fast File Applier (Apply pass)**: Level 2 developer subagents (`coder_applier`, `frontend_dev`, `backend_dev`, etc.) consume the manifest and apply file modifications using high-speed models (Gemini 2.5 Flash, Gemini 2.5 Flash-Lite, Claude 3.5 Haiku, GPT-4o-mini) or local offline models via Ollama and vLLM (Qwen 2.5 Coder 14B, Llama 3.3 70B).
- **Verified Read + Write Cost Benchmark**:
  - **Zero Raw-Code Reads at Tier 1**: Eliminates 85% to 92% of input tokens on architectural planning turns by substituting raw code with $\le 150$-word digests.
  - **Cumulative Input Token Costs: 75% Reduction** (dropping effective blended rates from $0.60 per 1M tokens down to $0.15 per 1M tokens).
  - **Output Generation Costs: 94% Reduction** (dropping output billing from $10.00 per 1M tokens down to $0.60 per 1M tokens).
  - **Overall Read + Write Benchmark**: End-to-end multi-agent feature implementations achieve an overall 80% to 92% token cost reduction compared to naive monolithic swarms.
- **Anti-Snowballing Turn Limits**:
  - Long-running conversational threads compound quadratic context re-billing on every turn.
  - Warden enforces a strict ceiling of 8 conversational turns or fewer per developer shard.
  - Once a shard completes its file modifications, the agent process terminates immediately. New tasks spawn fresh subagents with clean context windows.
- **Disjoint Shard Concurrency**:
  - Large features split across disjoint file sets.
  - Multiple Level 2 developers run simultaneously without merge conflicts or overlapping token bloat.

---

## 3. Multi-Model Support & Runtime Auto-Discovery

Warden provides dynamic, vendor-agnostic LLM routing across commercial APIs and local runtimes.

- **Heterogeneous Model Support**:
  - **Anthropic**: Claude 3.7 Sonnet, Claude 3.5 Haiku.
  - **Google Cloud / Vertex AI**: Gemini 2.5 Pro, Gemini 2.5 Flash, Gemini 2.5 Flash-Lite.
  - **OpenAI**: GPT-4o, GPT-4o-mini, o3-mini.
  - **xAI**: Grok-2, Grok-2-mini.
  - **Meta & Open Weights**: Llama 3.3 70B, Meta Muse, DeepSeek R1, Qwen 2.5 Coder via Ollama, vLLM, and Hugging Face endpoints.
- **Runtime Unknown-Model Discovery**:
  - If a user specifies a new or unlisted model identifier in configuration or via CLI arguments, Warden automatically triggers model auto-discovery.
  - The discovery engine queries model endpoint metadata or applies heuristic capability profiling to detect context window limits, tool-calling capabilities, and pricing metrics.
  - It classifies the discovered model into Tier 1 (Architect) or Tier 2 (Applier).
- **Zero-Overhead Local Persistence (`.state/model-registry.json`)**:
  - Discovered model profiles save directly to `.state/model-registry.json`.
  - Subsequent runs load resolved specifications instantly from the local cache, avoiding external network lookups.
- **Integrated Token Telemetry & Reporting**:
  - Built-in script `scripts/token-report.mjs` inspects session traces and calculates granular token expenditures.
  - Outputs billed input tokens, output tokens, thinking/reasoning tokens, tool invocation counts, and USD cost estimates per agent tier.

---

## 4. Operating Modes

Warden provides three operational modes to match workflow intensity:

- **Mode A: Executive Mode (Upward Compression Funnel)**:
  - Communicate with `warden` in chat. Your request cascades downward through the hierarchy and compresses upward into an executive brief.
- **Mode B: Direct-to-Agent Mode (`@agent`)**:
  - Prefix messages with an agent handle (such as `@cto`, `@pm`, `@tech_lead <project>`, `@frontend_dev <project>`, or `@infra_head`).
  - Bypasses root compression to allow unmediated technical interaction with specific specialists.
- **Mode C: Standup Automation & Daemon Execution**:
  - Run `npm run standup` to trigger an automated standup that triages `worklist/inbox.md`, reconciles backlogs, and writes a draft for human approval.
  - Run `npm run daemon` to maintain a background service running scheduled standups and backlog checks.

---

## 5. Repository Operators Protocol (`pull -> work -> pushit`)

All code modifications adhere to a safe repository lifecycle:

- **1. Synchronize Inward (`sync-in`)**:
  - Command: `node scripts/repo-tool.mjs sync-in <project>`
  - Pulls fast-forward upstream updates and mirrors source files into `.state/mirror/<project>/`.
- **2. Sandboxed Parallel Execution**:
  - Developer subagents operate exclusively within `.state/mirror/<project>/`.
  - Subagents cannot modify the parent repository root directly.
- **3. Synchronize Outward (`sync-out` / `pushit`)**:
  - Command: `node scripts/repo-tool.mjs sync-out <project>`
  - Verifies file changes, copies updates back to the project repository, bumps patch versions every fifth commit, records commit headers, and pushes changes upstream.

---

## 6. Live Telemetry Dashboard & Dual State Engines

- **Dual State Backend**:
  - Run `npm run dev:md` for zero-dependency file-based state storing all backlogs, memory, and logs in Markdown.
  - Run `npm run dev:db` for enterprise state management backed by PostgreSQL and pgvector.
- **Real-Time Web Dashboard**:
  - Responsive React application running on Vite.
  - Visualizes active workforce status, sprint backlogs, live token consumption, and system health telemetry.
  - Includes interactive Consultation Knob widget adjusting agent autonomy levels between manual human gates and automated execution.

---

## 7. Workspace Layout

```text
warden/
├── projects.example.yaml             # Template mapping project keys to repository folders
├── .env.example                      # Configuration template for multi-provider API keys
├── AGENTS.md                         # Canonical corporate hierarchy and communication protocol
├── CLAUDE.md                         # Claude Code entrypoint and agent definitions
├── GEMINI.md                         # Google Antigravity and Gemini command center rules
├── README.md                         # System documentation and architecture guide
├── packages/
│   ├── orchestrator/                 # Control plane, model router, and reminder service
│   ├── db/                           # PostgreSQL schema, migrations, and markdown syncer
│   ├── sandbox/                      # Sandboxed execution manager and security guardrails
│   └── web/                          # Live web dashboard UI (React + Vite + Tailwind)
├── scripts/
│   ├── repo-tool.mjs                 # Multi-repo synchronization and mirror manager
│   ├── commando-vertex.mjs           # Vertex AI CLI orchestrator and standup daemon
│   ├── token-report.mjs              # Token consumption and cost telemetry reporter
│   ├── token-firewall.mjs            # Static token audit and file access verifier
│   ├── export-oss-md.mjs             # Open-source zero-leak markdown & public repo exporter
│   └── publish-public.mjs            # Production allowlist publisher and sanitizer
├── .agents/skills/                   # Standardized runbooks (orchestrator, standup, pushit)
├── .claude/agents/                   # Dedicated subagent prompts for Claude Code
└── docs/                             # Setup guides (WhatsApp Cloud API, privacy policies)
```

---

## 8. Quickstart Guide

- **Prerequisites**: Node.js (v20+ recommended) and optional Docker for PostgreSQL mode.

```bash
# 1. Clone repository
git clone https://github.com/example/warden.git
cd warden

# 2. Install dependencies
npm install

# 3. Configure environment and projects
cp .env.example .env
cp projects.example.yaml projects.yaml

# 4. Launch in Markdown mode (zero external database requirement)
npm run dev:md

# 5. Or launch in PostgreSQL mode
npm run db:up
npm run dev:db
```

The web dashboard is available at `http://localhost:5173` and the control plane API at `http://localhost:4000`.

---

## 9. Zero-Leak Sanitization Guarantee

Warden is built with strict privacy and data-isolation standards:

- No proprietary internal company credentials, proprietary game/crypto logic, or private customer data are stored in tracked repository files.
- All private state resides in gitignored local directories (`.state/`, `context/`, `memory/`, `worklist/`, `chats/`, `standups/`).
- Automated sanitization scripts (`scripts/export-oss-md.mjs`, `scripts/publish-public.mjs`) guarantee zero sensitive data leakage across public releases.
