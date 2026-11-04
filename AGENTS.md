# WARDEN - Coding Agent Instructions (Standalone Repo)

This repo IS Warden, a single standalone project. It ships a control plane API plus a React dashboard. It is hosted on cloud infrastructure and tested against the DB-backed version.

## 1. CLI Role: Coding Agent Only

- CLI sessions never act as `warden`, `cto`, `cbo`, or any in-product agent persona.
- You are the operator's coding agent. Your job is to read, change, build, and test this repo.
- Never run first-run detection. Never check for `.state/onboarded.json` to decide your role.
- Never enter onboarding mode from the CLI. Never interview the operator for founder or project data.
- Never create or write `.state/onboarded.json`, `projects.yaml`, `context/`, `memory/`, or `worklist/` as onboarding output.
- The legacy `.agents/skills/onboard/` CLI interview flow is deprecated. Do not invoke it.
- If the operator asks what to do today, answer as a coding agent: propose code, build, and test steps.

## 2. Canonical Product Surfaces

- Onboarding runs on the Warden dashboard, not in the CLI.
  - UI flow: `packages/web/src/components/AuthOnboardingFlow.tsx` via `packages/web/src/Root.tsx`.
  - API: `packages/orchestrator/src/auth/routes.ts` plus `UserStore.ts` and `OtpService.ts`.
  - State persists server-side per user. Refresh resumes the saved step and form.
- Dashboard: `packages/web/` (Vite plus React). API: `packages/orchestrator/src/server/ControlPlaneServer.ts`.
- Database: `packages/db/` (Postgres plus pgvector with a local JSON snapshot fallback).
- Sandbox execution: `packages/sandbox/`.

## 3. Data Source Modes

- `npm run dev:db` is canonical for cloud parity. Postgres is the source of truth. Run `npm run db:up` first.
- `npm run dev:md` is legacy local Markdown mode. Markdown files hydrate state and receive writes.
- `WARDEN_SOURCE=db` selects DB mode. `WARDEN_SOURCE=md` selects Markdown mode. See `.env.example`.
- CLI scripts that only read or write Markdown (`context/`, `memory/`, `worklist/`, `chats/`) are legacy local tooling. They never touch Postgres.

## 4. Local State (`.state/`)

- `.state/` is local gitignored dev scratch. It never ships to cloud.
- Kept: `.state/warden-db.json` (DB snapshot fallback), `.state/model-registry.json` (model profiles), `.state/tokens/` (telemetry).
- Do not add new onboarding or registry state under `.state/`. New product state belongs in Postgres via `packages/db/`.

## 5. Removed Multi-Project Tooling

Earlier multi-repo tooling from the private predecessor has been removed from this repo: `.state/mirror` sync-in and sync-out, IDE persona prompts, the CLI standup daemon, and CLI onboarding. The dashboard and control plane own those flows now. Do not reintroduce multi-project support.

## 6. Working Conventions

- Keep answers short and direct. Prefer concise bullet points and clean prose.
- Never use diagrams (Mermaid) or Markdown tables.
- Make the smallest correct change at the root cause. Do not rework unrelated code.
- Before finishing, run the repo gates: `npm run typecheck`, then `npm run build`.
- For DB-backed work, also verify with `npm run db:up` followed by `npm run dev:db` and exercise the dashboard flow.

## 7. First-Time Dev Setup

- Run `npm install`.
- Copy `.env.example` to `.env` and set `META_MUSE_API_KEY` and `DATABASE_URL`.
- Run `npm run db:up`, then `npm run dev:db`.
- Open the dashboard at `http://localhost:5173` and the API at `http://localhost:4000`.
- Onboard through the dashboard UI, never through the CLI.
