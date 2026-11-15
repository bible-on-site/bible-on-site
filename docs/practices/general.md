# General Practices

## General Principles

- **Always prefer the latest stable version** of any toolset, framework, or package unless there's a specific compatibility concern.

## Language Policy

**No shell scripts (.sh, .bash) are allowed in this repository.**

- **DevOps tooling**: Use Node.js/TypeScript (see `devops/` directory)
- **Data processing**: Use Rust (see `data/` directory)
- **Tanahpedia local model inference**: the existing `data/annotations/`
  pipeline uses Python for PyTorch/Transformers model adapters, GPU execution,
  evaluation, checkpoints and tests. This scoped ML-runtime exception keeps
  the established inference stack together. General data ingestion remains
  Rust; durable application content uses the normal database editing/import
  path.

This ensures consistency, type safety, and maintainability across the codebase.

## Tool Learning Protocol

### Automatic Process (Copilot/Agents)

1. Check `.github/tool-registry.md` for existing research
2. If missing/outdated: use Context7 (`resolve-library-id` → `get-library-docs`), official docs, or GitHub
3. Update registry with: tool name, version, date, key learnings
4. Apply learnings

## Investigation Tools

### GitHub CLI (`gh`)

Use the `gh` CLI for investigating GitHub-related issues (Actions runs, PRs, issues, etc.):

```bash
# View failed job logs
gh run view <run-id> --log-failed

# Get run metadata
gh run view <run-id> --json workflowName,event,conclusion

# Get commit details
gh api repos/<owner>/<repo>/commits/<sha>
```

### Fast CLI tools

| Task | Use | Instead of |
| ---- | --- | ---------- |
| Content search | `rg` | `grep -r`, `Select-String`, `find -exec grep` |
| File enumeration | `fd` / `rg --files` | `find`, `ls -R`, `Get-ChildItem -Recurse` |
| Disk usage | `dust` | `du` walks |
| Text replace | `sd` | `sed -i` on Windows |
| JSON / YAML | `jq` / `yq` | ad-hoc parsing |
| Workflow lint | `prek run actionlint` (pinned fork) | push-to-CI; raw `actionlint` flags repo extensions |
| Benchmarks | `hyperfine` | `time` loops |
| Structural search | `ast-grep` | regex over code |
| SQLite / archives | `sqlite3` / `7z` | ad-hoc scripts |
| Rust rebuilds | `RUSTC_WRAPPER=sccache` | uncached builds |

`.gitignore` + root `.ignore` keep searches off build output, nested `artifacts-*/` evidence worktrees, and the generated corpus dumps (42 MB single-line `*.tanah_view.json`, 36 MB bundled `*.tanah_view.sqlite`); `-u`/`--no-ignore` includes ignored paths. Filters: `-t` file types (`rg --type-list`), `-g` globs, `-F` literal text.

# Performance Failures

Do not increase timeouts, retries, sleeps, polling budgets, or hang-watchdog limits to make a failing or slow operation pass. Treat a timeout as evidence: reproduce it, measure the critical path, and fix the underlying algorithm, blocking work, contention, or delivery defect. Keep the existing interaction deadline as a regression check. A timeout change is permitted only when the user explicitly requests it after seeing the root cause and measured tradeoff.
