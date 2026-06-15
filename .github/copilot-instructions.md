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
- Use of client components in `web/bible-on-site` is forbidden unless explicitly requested

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
