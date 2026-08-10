# Copilot Instructions

## Documentation References

| Topic                | Documentation Path     |
| -------------------- | ---------------------- |
| **Practices**        | `docs/practices/`      |
| Repository Structure | `docs/repo-structure/` |
| GitHub CI/CD         | `docs/github/`         |
| AWS Infrastructure   | `docs/aws/`            |
| App Development      | `docs/app/`            |

## Known Workarounds

- **Terminal**: prepend a leading space to every command (temporary bug) — ` cd /path && command`.
- **Windows `nul` files**: delete before committing (`find . -name "nul" -type f -delete`).
- **Branches**: verify the branch does not already exist on remote before pushing (see `docs/practices/git.md`).
- **Quotes**: never use the Hebrew gershayim `"` — use ASCII `"`, escaped or encoded as the file format requires.
- **Non-interactive CLI on Windows**: no `gh ... --watch` in Git Bash (it reopens an alternate buffer and hides auditable output) — use REST/GraphQL snapshots or redirect the watcher to a file. Set `GH_PAGER=cat GH_FORCE_TTY=0 PAGER=cat` and `AWS_PAGER=''`.
- **MINGW path conversion**: prefix colon paths and leading-slash arguments with `MSYS_NO_PATHCONV=1` (e.g. `git show "origin/master:path"`, SSM names starting with `/`), or use the repository's root-level SSM names.

## Dependency & CI Maintenance

- **Validate a dep refresh locally before pushing** — CI runs in UTC with a clean `npm ci`:
  1. `cd web/bible-on-site && TZ=UTC npm run test:unit` — hebrew-date/tzeit tests (e.g. `constructTsetAwareHDate`) pass in local timezones but fail under UTC when date libs change.
  2. `npm ci --dry-run` in **every** touched npm module (especially `web/admin`) to catch `package.json`/lockfile drift before the Dockerized CI jobs do.
  3. For .NET majors, `dotnet restore app/BibleOnSite.Tests/BibleOnSite.Tests.csproj` — catches `NU1605` downgrades without mobile workloads.
- **Renovate grouped "all non-major" PRs are risky**: their lockfile maintenance can drop transitive optional deps (e.g. `@emnapi/*` from `web/admin/package-lock.json`), breaking the Dockerized `npm ci`, and they auto-merge and re-break master. Run `gh pr merge <n> --disable-auto`, then supersede with a hand-built branch carrying only the real dep change plus regenerated lockfiles. PR CI used to miss this because the Package (Docker) jobs run only on master pushes while module CI resolves node from the engines pin (older, lenient npm), whereas the floating `node:24` image ships a stricter npm that rejects the desynced lockfile — so Admin CI and Website CI now run "Verify Lockfile Sync With Packaging npm" (`npm ci --dry-run` inside `node:24-alpine`); keep that step.
- **Held dependencies** (authoritative list in `renovate.json`): `sunrise-sunset-js` <3.2.1 (3.2.1 and 3.3.0 break tzeit under UTC), node engines/nvm/dockerfile pinned `>=24.11.1 <24.12.0`, `macos` runner <26 (breaks the MAUI iOS build), `swc-plugin-coverage-instrument` disabled, `bson` held (mongodb pins bson 2). Keep `.nvmrc` in sync with `engines`.
- **Version-gate collisions**: CI compares a gated module's version against the highest released `<module>-v*` tag, and the release bot bumps gated versions on master after each merge. On long-lived/dep branches, merge `origin/master` then bump the gated module above master HEAD's value. Gated modules: `website`, `api`, `app`, `bulletin`, `admin` — a `web/api/Dockerfile` change triggers `api`, `.csproj` changes trigger `app`.
- **CDs** (Bulletin / RDS / App) run from `repository_dispatch` in the release pipeline, never manually, so fixes land on the next release. The `db-populator` Lambda is external to this repo — diagnose via CloudWatch (`/aws/lambda/bible-on-site-db-populator`).

## Tool Learning Protocol

Check `.github/tool-registry.md`; if the entry is missing or outdated, research it (Context7 `resolve-library-id` → `get-library-docs`, official docs, GitHub), record tool/version/date/learnings there, then apply them.

## Quality Ownership

- **Never ignore a compiler or linter error/warning** — keep 0 problems in VS Code.
- **Never dismiss a test failure**: find the root cause (your change? environment? flaky?) and fix it or ask — never call it "unrelated" and move on.
- **Never leave anything red, and never _assume_ a red is fixed.** Every red signal (CI, merge queue, CD for AWS/Bulletin/RDS/App, README/Project Status badges, Uptime Robot, codecov) is yours until **verified green with freshly observed evidence** or **tracked with its true current status**:
  1. **Track with evidence** — record the artifact (run ID, PR, issue, badge) and re-query the source of truth (`gh run list`/`gh run view`, badge endpoint, AWS). Report the status you observed, never the one you expect.
  2. **Diagnose before acting** — separate real failures from stale/transient ones (expired artifact, idle Lambda, OIDC hiccup) and from red herrings (`digest-mismatch` is an _input_ of `actions/download-artifact`).
  3. **Fix at the source** when it is in your control (code, config, workflow, reachable infra).
  4. **Only green is resolution.** A CD/badge reflects its latest run, so a merged preventive fix does not clear it; if clearing depends on a future release/dispatch/external action, say plainly it is **still red** and keep it tracked — and if you are blocked externally (Store submission, prod deploy confirmation, expired artifacts), file a tracked issue **and** state the exact action needed.
  5. **Never mask a red** — no `continue-on-error`, no inflated codecov `coverage.range`, no re-deploying stale artifacts. Prevent recurrence when the cause was systemic (e.g. too-short artifact retention).
- Check CI/PR status yourself with evidence; never ask the user to watch or confirm. When checks are green and policy allows, merge (or enqueue) yourself and verify the post-merge state.
- Client components in `web/bible-on-site` are forbidden unless explicitly requested.
- When the user's intent is clear, continue with the next aligned step instead of asking "next steps?".

## GitHub Issue Creation

See [instructions/github-issues.instructions.md](instructions/github-issues.instructions.md): every issue needs Priority + Difficulty + Type + Component labels and the matching project (App #4, API #3, website #2, Data #5, Admin #6).
