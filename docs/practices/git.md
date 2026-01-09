# Git Practices

## Pre-commit Hooks

The repository uses pre-commit hooks managed by [pre-commit](https://pre-commit.com/):

| Item | Location |
| ---- | -------- |
| Configuration | `.pre-commit-config.yaml` at repository root |
| Python venv | `devops/.venv/` |
| Tool configurations | `devops/pyproject.toml` |

**Husky integration**: Husky (npm) triggers pre-commit (Python) on git hooks. The `.husky/pre-commit` script calls `pre-commit run`.

### Running Hooks Manually

```bash
# Activate the Python virtual environment
source devops/.venv/Scripts/activate  # Windows
source devops/.venv/bin/activate      # Unix

# Run a specific hook
pre-commit run <hook-id> --all-files
```

### Adding a New Pre-commit Hook

1. Add the repo and hook configuration to `.pre-commit-config.yaml`
2. Add any tool-specific configuration to `devops/pyproject.toml` under the appropriate `[tool.*]` section (if it cannot be inlined in `.pre-commit-config.yaml`)

When modifying the pre-commit process, always update `docs/devops/pre-commit.md` to reflect the changes.

## Git Workflow

### Manual Commit Process

When committing changes:

1. **Before committing**, review staged changes for PII (Personally Identifiable Information) such as AWS account IDs, API keys, passwords, email addresses, or other sensitive data. Use `git diff --cached` to inspect.
2. After `git commit`, pre-commit hooks may apply auto-fixes (e.g., formatting, import sorting)
3. Before pushing, always check for unstaged changes: `git status`
4. If pre-commit modified files, stage and amend:
   ```bash
   git diff-tree --no-commit-id --name-only -r HEAD | xargs git add && git commit --amend --no-edit
   ```
   (Only re-stages files from the original commit)
5. Only push after confirming no uncommitted auto-fixes remain

### Automatic Process (Copilot/Agents)

Copilot and agents follow the same workflow as above but should:

1. Always check for PII before committing
2. After committing, check `git status` for any auto-fix changes
3. If changes exist, stage and amend automatically
4. Verify clean working tree before pushing

### Pull Request Management
- Always create a new branch for each feature or fix
- Pull request is automatically created when publishing a branch
- Only @DoradSoft can merge PRs unless explicitly delegated to do so