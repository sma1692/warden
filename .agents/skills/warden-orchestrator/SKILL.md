---
name: commando-orchestrator
description: >-
  Token-optimized orchestration runbook for Warden: warden (Root, <=1.5K tok/turn)
  -> cto & cbo (Level 0, <=4K tok/turn) -> pm, tech_lead, sec_lead, infra_head, designer
  (Level 1) -> parallel chunked Level 2 devs (frontend, backend, systems, rust, xr, sec_auditor, infra_jr).
---

# Warden Orchestrator Skill (Bottom-Heavy Token Pyramid)

1. **`warden` (Root Chief of Staff)**:
   - Reads **0** repo, backlog, or cache files. Uses the `cto` / `cbo` bindings in [`MUSE.md`](../../../MUSE.md) to invoke Level 0 immediately.
   - Never reads or edits `chats/<session>.md`. Passes the session file path to downstairs agents, who append to it.
2. **`cto` & `cbo` (Level 0)**:
   - `cto` reads **ONLY** `context/cto.md` and `memory/cto.md` (never `.state/topology-cache.json`, `context/<project>/<repo>.md`, or `worklist/*`).
   - `cbo` reads **ONLY** `context/cbo.md` and `memory/cbo.md` (queries `pm` for backlog state).
   - Level 0 reads `.claude/agents/<role>.md` only for the Level 1 agent it needs to spawn.
3. **Level 1 (`pm`, `tech_lead`, `sec_lead`, `infra_head`, `designer`)**:
   - `pm` owns `worklist/inbox.md`, `worklist/<project>/backlog.md`, `worklist/COLLATED_BACKLOG.md`, and writes `standups/<YYYY-MM-DD>-standup.md`.
   - `tech_lead` reads `context/<project>.md` and `memory/<project>/tech_lead.md`, locks `contracts/<project>-*.md`, and spawns **N parallel Level 2 devs** under the **Exclusive-File Sharding Protocol** (<= 5/10 complexity per agent, no overlapping files).
   - `sec_lead` runs out-of-flow VAPT / OWASP / memory-safety audits and spawns `sec_auditor`s with the same sharding.
   - `infra_head` reads `context/<infra-project>.md` and `memory/infra_head.md` and dispatches `infra_jr`.
4. **Level 2 - Mandatory Pull -> Work -> Pushit**:
   - **Pull**: run `node scripts/repo-tool.mjs sync-in <project|repo>` (`git pull --ff-only` + mirror refresh) before any task.
   - **Work in the Sandbox Mirror**: read `context/<project>/<repo>.md` and `memory/<project>/<role>.md`, then edit inside `.state/mirror/<repo>/` with the sandbox enabled.
   - **Pushit**: after any task, write `.state/mirror/<repo>/.commit_msg.txt` and run `node scripts/repo-tool.mjs sync-out <project|repo>` (5th-commit version check + pushit commit format + `git push origin <branch>`).
5. **Upward Return Caps**:
   - Level 2 -> Level 1: <= 200 words (full details to `contracts/` or `context/<project>/<repo>.md`).
   - Level 1 -> Level 0: <= 150 words (bullets + file paths).
   - Level 0 -> `warden`: <= 120 words (ASD-STE100 bullets + file links).
6. **Token Report**: at the end of every run, `warden` runs `node scripts/token-report.mjs --session <conversation-id>` and links the report.

**Never use diagrams (Mermaid) or Markdown tables. Always use concise bullet points and clean prose.**
