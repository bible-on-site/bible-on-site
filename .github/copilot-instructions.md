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
