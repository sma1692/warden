# MUSE.md - Coding Agent Instructions

@AGENTS.md is canonical. This file adds Muse-specific notes.

## No First-Run Detection

- There is no onboarding from the CLI or IDE chat. Never check for `.state/onboarded.json`.
- Never invoke the legacy onboarding skill. Never interview the operator.
- Onboarding runs on the Warden dashboard: `packages/web/src/components/AuthOnboardingFlow.tsx` backed by `packages/orchestrator/src/auth/`.
- In chat you are a coding agent improving this repo, not an in-product persona.

## Model Policy (Meta-Only)

- All inference runs on Meta models. Tier 1 architects use `muse-wonder-1.0`. Tier 2 appliers use `muse-spark-1.3`, `muse-light`, or `muse-flash`.
- Local execution uses Meta open weights (`llama-3.3-70b`, `muse-glimmer-30b`) via Ollama or vLLM.
- Configure one key: `META_MUSE_API_KEY` in `.env`. See `.env.example`.

## Dev Workflows

- Canonical local run: `npm run db:up`, then `npm run dev:db`.
- Legacy Markdown run: `npm run dev:md`. Local files only, no Postgres writes.
- Verify with `npm run typecheck` and `npm run build` before finishing.
- Dashboard at `http://localhost:5173`. API at `http://localhost:4000`.
- Do not use `.claude/agents/` persona prompts or `@<agent>` routing in chat. Those files are legacy IDE artifacts.

## `pushit` Commit Format

When the operator says **"pushit"** or `/pushit`, stage, version-check, commit, and push to the current branch on `origin`:

1. **Versioning (`package.json` `MAJOR.MINOR.PATCH`)**:
   - Never auto-modify `MAJOR`.
   - Count commits since the last version change:
     `LAST_BUMP=$(git log -G '"version":' -n 1 --format="%H" package.json 2>/dev/null)`
     `COMMITS_SINCE=$([ -n "$LAST_BUMP" ] && git rev-list --count ${LAST_BUMP}..HEAD || git rev-list --count HEAD)`
   - Every 5th commit (`COMMITS_SINCE + 1 >= 5`), increment `PATCH`.
   - If `PATCH` is already `10`, reset it to `0` and increment `MINOR` (`0.0.10 -> 0.1.0`).
   - Include `BUMP VERSION TO X.Y.Z` in the commit header.
2. **Staging**: stage modified and relevant untracked source/config files. Exclude `.env*`, secrets/keys, `projects.yaml`, build outputs (`dist*`, `*.zip`), and gitignored files.
3. **Commit Message**:
   - Header: `ALL CAPS, COMMA-SEPARATED SUMMARY OF CHANGES`.
   - Blank line, then `-` bullets starting with active verbs.
   - Blank line, then the author footer configured in the pushit skill (default `Author -- <your-initials>`).
   - No em dashes.
4. **Push**: `git push origin <current-branch>`.
