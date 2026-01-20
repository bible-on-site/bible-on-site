# Issue Creation Practices

## Title Format

Use descriptive titles with optional prefixes:
- `[P1-P3]` - Priority level (optional, can use label instead)
- `[D1-D4]` - Difficulty level (optional, can use label instead)

Example: `Data CI: JUnit report file not generated`

## Required Labels

### Priority Labels (choose one)

| Label | Description | Color |
|-------|-------------|-------|
| `P1` | Top Priority - Critical/blocking issues | 🔴 Red |
| `P2` | Prioritized - Important, should be addressed soon | 🟠 Orange |
| `P3` | Nice to have - Can be deferred | 🟣 Purple |

### Difficulty Labels (choose one)

| Label | Description | Color |
|-------|-------------|-------|
| `D1` | Low Difficulty - Quick fix, < 1 hour | 🟢 Green |
| `D2` | Medium Difficulty - Few hours | 🟡 Yellow |
| `D3` | High Difficulty - Day or more | 🟠 Orange |
| `D4` | Huge Difficulty - Major effort, multiple days | 🔴 Red |

### Category Labels (choose relevant)

| Label | Description |
|-------|-------------|
| `bug` | Something isn't working |
| `enhancement` | New feature or request |
| `documentation` | Improvements or additions to documentation |
| `devops` | CI/CD, infrastructure |
| `CI` | Continuous Integration |
| `CD` | Continuous Deployment |
| `security` | Security-related |
| `performance` | Performance improvements |
| `FE` | Frontend |
| `API Tests` | API test related |
| `E2E Tests` | End-to-end test related |

### Technology Labels (add if applicable)

| Label | Description |
|-------|-------------|
| `rust` | Rust code |
| `python` | Python code |
| `javascript` | JavaScript code |
| `nextjs` | Next.js related |
| `github_actions` | GitHub Actions |
| `Playwright` | Playwright tests |
| `MySQL` | MySQL/database |

## Project Assignment

Assign issues to the appropriate GitHub Project based on the module:

| Project | Number | Use For |
|---------|--------|---------|
| Website | 2 | Frontend, Next.js, web UI |
| API | 3 | Backend API, Rust web server |
| App | 4 | Mobile/desktop app, .NET MAUI |
| Data | 5 | Data module, database, migrations |

For cross-cutting issues (CI/CD, devops, infrastructure), assign to the most relevant project or create in multiple projects.

### CLI Project Assignment

```bash
# Add issue to a project (by project number)
gh project item-add <PROJECT_NUMBER> --owner bible-on-site --url <ISSUE_URL>

# Example: Add issue #1093 to App project (4)
gh project item-add 4 --owner bible-on-site --url https://github.com/bible-on-site/bible-on-site/issues/1093
```

## Issue Body Template

```markdown
## Problem
Brief description of the issue.

## Reference
- Link to failing CI run, error logs, or related code

## Root Cause (if known)
Analysis of why this is happening.

## Solution (if known)
Proposed fix or approach.
```

## Quick Reference

When creating an issue via CLI:
```bash
gh issue create \
  --title "Brief descriptive title" \
  --body "## Problem
Description here

## Reference
- https://github.com/..." \
  --label "P3" --label "D1" --label "CI"
```
