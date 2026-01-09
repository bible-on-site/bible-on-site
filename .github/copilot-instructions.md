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

### Tool Learning Protocol

When using a tool/library/framework for the first time:

1. Check `.github/tool-registry.md` for existing research
2. If missing/outdated: use Context7 (`resolve-library-id` → `get-library-docs`), official docs, or GitHub
3. Update registry with: tool name, version, date, key learnings
4. Apply learnings

- **Never ignore compiler or linter errors/warnings** — maintain 0 problems in VS Code
- Use of client components in `web/bible-on-site` is forbidden unless explicitly requested
