---
name: standup
description: >-
  Runs the Daily Standup (at the configured daily time or on-demand "standup"). Delegates all
  backlog reading, inbox triage, and standups/<YYYY-MM-DD>-standup.md drafting to
  Level 1 (pm, tech_lead, infra_head) so warden and cto/cbo stay under 4K tokens.
---

# Daily Standup Skill (Bottom-Heavy Token-Optimized Flow)

## 1. Delegation Chain (keep `warden` and `cto` light)

1. **`warden` (Root)**:
   - Does **NOT** read `worklist/*`, `standups/*`, or `context/*`.
   - Sends a 1-paragraph directive to **`cto`** and **`cbo`** with the active `chats/<YYYY-MM-DD>-session-<id>.md` path.
2. **`cto` & `cbo` (Level 0)**:
   - Read **ONLY** `context/cto.md` + `memory/cto.md` (`cto`) and `context/cbo.md` + `memory/cbo.md` (`cbo`).
   - Dispatch **`pm`**, the **`tech_lead`s**, and **`infra_head`** in parallel.
3. **Level 1 (where all file reads and drafting happen)**:
   - **`pm`**: reads `worklist/inbox.md`, `worklist/<project>/backlog.md`, and `worklist/COLLATED_BACKLOG.md`. Triages new inbox items. Collects `[NEEDS_CEO]` blockers (`QUESTION`, `API_KEY`, `MANUAL_ACTION`, `DECISION`). Locks **What is Decided for the Week** and **Moving Around Tasks**. Writes `standups/<YYYY-MM-DD>-standup.md` to disk.
   - **`tech_lead`s & `infra_head`**: poll `frontend_dev`, `backend_dev`, and `infra_jr` for repo git status and blockers. Return a <= 150-word list to `cto` and `pm`.
4. **Upward Return to the Operator**:
   - `cto` and `cbo` return a <= 120-word summary + link to `standups/<YYYY-MM-DD>-standup.md` to `warden`.
   - `warden` presents the bullet-first ASD-STE100 summary (`NEEDS_CEO` list, weekly sprint list, task movements) and pauses at the **CEO Decision Gate** before Phase 2 execution and `pushit`.

**Never use diagrams (Mermaid) or Markdown tables. Always use concise bullet points and clean prose.**
