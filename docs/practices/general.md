# General Practices

## General Principles

- **Always prefer the latest stable version** of any toolset, framework, or package unless there's a specific compatibility concern.

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
