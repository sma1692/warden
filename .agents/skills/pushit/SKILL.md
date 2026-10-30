---
name: pushit
description: >-
  Stages changes, checks/bumps the package.json version every 5th commit,
  commits in the pushit format, and pushes to the current branch on origin.
  Runs on the Warden workspace and/or is delegated down the tech hierarchy
  (cto -> tech_lead -> backend_dev & frontend_dev) when project repos changed.
---

# Pushit Skill (`pushit` / `/pushit`)

When the operator says **"pushit"** or `/pushit`, stage, version-check, commit, and push to the current branch on `origin`.

**Configure once**: set your author footer below (default `Author -- <your-initials>`). Replace `<your-initials>` with your own tag before first use.

---

## 1. Execution Rules (per Git repository)

Run these steps in the target repository root.

### Step 1: Versioning (`package.json` `MAJOR.MINOR.PATCH`)
*(Applies when `package.json` exists in the repo root.)*
1. **Never auto-modify `MAJOR`**.
2. Count commits since the last commit that changed `"version":` in `package.json`:
   ```bash
   LAST_BUMP=$(git log -G '"version":' -n 1 --format="%H" package.json 2>/dev/null)
   COMMITS_SINCE=$([ -n "$LAST_BUMP" ] && git rev-list --count ${LAST_BUMP}..HEAD || git rev-list --count HEAD)
   ```
3. Every 5th commit (`COMMITS_SINCE + 1 >= 5`), increment `PATCH` by `1`.
4. If `PATCH` is already `10` when the 5th commit hits, reset `PATCH` to `0` and increment `MINOR` (`0.0.10 -> 0.1.0`).
5. Update `package.json`, stage it, and include `BUMP VERSION TO X.Y.Z` in the commit header.

### Step 2: Staging
1. Run `git status` to inspect modified and untracked files.
2. Stage all modified and relevant untracked source/config files.
3. **Always exclude**:
   - `.env*` files.
   - Secrets, credentials, and private keys (`*.pem`, `*.key`, etc.).
   - Local path/topology files (`projects.yaml`, `.state/topology-cache.json`, `.claude/settings.json`, `.claude/settings.local.json`).
   - Build outputs (`dist*`, `build*`, `*.zip`, `*.tar.gz`).
   - Gitignored files.

### Step 3: Commit Message Format
```text
ALL CAPS, COMMA-SEPARATED SUMMARY OF CHANGES

- Start each bullet with an active verb describing a meaningful change
- Describe additional architectural, feature, or bugfix updates clearly

Author -- <your-initials>
```
- **Header**: `ALL CAPS, COMMA-SEPARATED SUMMARY OF CHANGES` (add `BUMP VERSION TO X.Y.Z` when bumped).
- **Body**: blank line, then `-` bullets starting with active verbs.
- **Footer**: blank line, then your configured author footer.
- **Prohibited**: em dashes.

### Step 4: Push
```bash
BRANCH=$(git rev-parse --abbrev-ref HEAD)
git push origin "$BRANCH"
```

---

## 2. Multi-Agent `pushit` Sweep (`warden` -> `cto` -> `tech_lead` -> devs)

Saying **"pushit"** (or **"pushit `<project>`"**) runs a context-aware sweep across the active project's repositories:

1. **Resolve the Active Project**: from the conversation, the prompt (`pushit <project>`), or `projects.yaml` / `.state/topology-cache.json`. Read `context/<project>.md`, `context/<project>/<repo>.md`, and the active task file in `worklist/` so commit messages reflect the feature context, and keep `context/<project>/<repo>.md` in sync with shipped changes.
2. **`tech_lead` Sweeps Dirty Repos**: run `git -C <folder> status --porcelain` for every folder registered to the project. For each dirty repo, `tech_lead` (or `backend_dev` and `frontend_dev` in parallel) runs Steps 1-4.
3. **Root Workspace**: if the Warden workspace itself has uncommitted changes (excluding gitignored files), run `pushit` there as well.
4. **Unified Push Report**: return one bulleted list with each repo checked/pushed, its branch, commit hash, commit header, and version status (`X.Y.Z` or `N/5 commits since last bump`).

**Never use diagrams (Mermaid) or Markdown tables. Always use concise bullet points and clean prose.**
