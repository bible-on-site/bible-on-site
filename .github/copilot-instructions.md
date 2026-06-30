# Copilot Instructions

## Documentation References

In order to understand some topic related to this repository, refer to the `docs/` directory:

| Topic                | Documentation Path     |
| -------------------- | ---------------------- |
| **Practices**        | `docs/practices/`      |
| Repository Structure | `docs/repo-structure/` |
| GitHub CI/CD         | `docs/github/`         |
| AWS Infrastructure   | `docs/aws/`            |
| App Development      | `docs/app/`            |

## Quick Reference for Agents

### Known Workarounds

- **Terminal Commands**: Due to a temporary bug, always prepend a leading space before running any commands in terminal (e.g., ` cd /path && command` instead of `cd /path && command`).
- **Windows "nul" Files**: Before committing, check for and remove any accidentally created `nul` files (a Windows artifact). Run: `find . -name "nul" -type f -delete` or manually delete them.
- **Branch Verification**: Before pushing to a branch, verify it doesn't already exist on remote (may have been merged). See `docs/practices/git.md` for details.

### Dependency & CI Maintenance

Lessons from past dependency refreshes — apply these to avoid breaking `master`:

- **Validate before pushing a dep refresh** (local-only validation is NOT enough — CI runs in UTC with a clean `npm ci`):
  1. `cd web/bible-on-site && TZ=UTC npm run test:unit` — website hebrew-date/tzeit tests (e.g. `constructTsetAwareHDate`) pass in local timezones but fail under CI's UTC when date libs change.
  2. `npm ci --dry-run` in **every** touched npm module (especially `web/admin`) — catches `package.json`/lockfile drift before the Dockerized CI jobs do.
  3. For .NET majors, `dotnet restore app/BibleOnSite.Tests/BibleOnSite.Tests.csproj` — catches `NU1605` package-downgrade errors without needing mobile workloads.
- **Renovate grouped "all non-major" PRs are risky**: their lockfile maintenance can drop transitive optional deps (e.g. `@emnapi/*` from `web/admin/package-lock.json`), breaking the Dockerized `npm ci` in the Package Admin job. These PRs often have **auto-merge enabled** and will re-break `master`. Run `gh pr merge <n> --disable-auto`, then supersede with a hand-built branch that applies only the real dep change plus freshly regenerated lockfiles (`npm install`).
- **Held dependencies** (see `renovate.json` for the authoritative list): `next` <16.2.0, `sunrise-sunset-js` <3.2.1 (both 3.2.1 and 3.3.0 break tzeit under UTC), `node` engines/nvm/dockerfile pinned `>=24.11.1 <24.12.0`, `macos` runner <26 (breaks the MAUI iOS build), `swc-plugin-coverage-instrument` disabled, `bson` held (mongodb pins bson 2). Keep `.nvmrc` in sync with the `engines` range.
- **Version-gate collisions**: CI's `verify-version` compares a gated module's version against the highest released git tag (`<module>-v*`), and the release bot bumps gated versions on `master` after each merge. On long-lived/dep branches, `git merge origin/master` then bump the gated module to **exceed master HEAD's** value. Gated modules: `website`, `api`, `app`, `bulletin`, `admin`. Note a `web/api/Dockerfile` change triggers the `api` gate and `.csproj` changes trigger the `app` gate.
- **CDs** (Bulletin / RDS / App) are triggered by `repository_dispatch` from the release pipeline, not manually; fixes land on the next release. The `db-populator` Lambda is an external Python function whose code is not in this repo — diagnose its failures via CloudWatch (`/aws/lambda/bible-on-site-db-populator`).

### Tool Learning Protocol

When using a tool/library/framework for the first time:

1. Check `.github/tool-registry.md` for existing research
2. If missing/outdated: use Context7 (`resolve-library-id` → `get-library-docs`), official docs, or GitHub
3. Update registry with: tool name, version, date, key learnings
4. Apply learnings

### Quality Ownership

- **Never ignore compiler or linter errors/warnings** — maintain 0 problems in VS Code
- **Never dismiss test failures** — you are the owner of repo quality. If a test fails:
  1. Investigate the root cause (is it your change? environment issue? flaky test?)
  2. Fix the issue or ask clarifying questions if unsure
  3. Never say "this is unrelated" and move on without resolution
- **Never leave anything red — and never _assume_ a red is fixed.** Every red signal is your responsibility until it is **verified green with freshly-observed evidence** (a passing run/badge you actually re-checked), or **explicitly tracked with its true current status**. This covers CI checks, the merge queue, CD deployments (AWS / Bulletin / RDS / App), the README/Project Status dashboard badges, Uptime Robot, and codecov. For each red:
  1. **Track it explicitly, with evidence** — record the concrete artifact (run ID, PR number, issue, badge) and its real, just-observed status by re-querying the source of truth (`gh run list`/`gh run view`, the badge endpoint, AWS), not by inference. Keep that tracking entry (todo list / issue) updated until it is green. Report the status you _observed_, never the status you _expect_.
  2. **Diagnose the root cause** before acting — distinguish a real failure from a stale/transient one (e.g. expired artifact, idle/restoring Lambda, OIDC hiccup) and from red-herring log lines (e.g. `digest-mismatch` is an _input_ of `actions/download-artifact`, not an error).
  3. **Fix it at the source** if it is in your control (code, config, workflow, infra you can reach via AWS SSO).
  4. **Opening a PR or filing an issue is _not_ resolution; only green is.** A CD/badge reflects its **latest run** and stays red until a **new successful run** flips it — a merged preventive fix (e.g. raising artifact retention) does **not** clear the existing red. Never mark a red done, or imply it is resolved, until you have re-verified it is actually green. If clearing it depends on a future release/dispatch/external action, state plainly that it is **still red** and keep it tracked as such.
  5. **Never mask a red** — do not hide a real failure with `continue-on-error`, do not inflate the codecov `coverage.range` to recolor a badge, and do not re-deploy stale artifacts to fake a green. Fix the underlying cause instead.
  6. **If blocked by external/user action** (e.g. MS Store Partner Center submission errors, a prod deploy that needs confirmation, expired artifacts needing a fresh release dispatch), file a tracked issue (with the required P/D labels + project) **and** surface it explicitly to the user with the exact action needed **and** the fact that it is **still red** — never silently move on or imply it is resolved.
  7. **Prevent recurrence** — when a red came from a systemic gap (e.g. too-short artifact retention), propose/implement the preventive fix, not just the one-off unblock.
- **Do not ask the user to "watch" or "confirm" CI/PR status** — always check it yourself and report observed results with evidence.
- **Do not tell the user to merge if the user delegated execution to you** — when checks are green and policy allows, perform the merge yourself (or enqueue it) and then verify the post-merge state.
- Use of client components in `web/bible-on-site` is forbidden unless explicitly requested
- If user intent is clear, continue with the next aligned implementation step automatically instead of asking "next steps?".

### GitHub Issue Creation

When creating GitHub issues, **always** include:

1. **Priority label** (required): `P1` (Top Priority), `P2` (Prioritized), or `P3` (Nice to have)
2. **Difficulty label** (required): `D1` (Low), `D2` (Medium), `D3` (High), or `D4` (Huge)
3. **Project** (required): Add to the appropriate project:
   - `App` (project #4) — for mobile app issues
   - `API` (project #3) — for backend API issues
   - `website` (project #2) — for frontend website issues
   - `Data` (project #5) — for data pipeline issues
   - `Admin` (project #6) — for admin portal issues

Use gh CLI to add labels and project:

```bash
gh issue edit <number> --repo bible-on-site/bible-on-site --add-label "P3,D1"
gh project item-add <project-number> --owner bible-on-site --url <issue-url>
```
