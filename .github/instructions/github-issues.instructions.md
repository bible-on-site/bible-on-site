---
description: "GitHub issue management — labels, projects, body template for bible-on-site"
applyTo: "**"
---

# GitHub Issues Management

Every new issue needs **labels** (one Priority + one Difficulty + one Type + all applicable Components) and membership in **every relevant project**.

- **Priority**: `P1` top, `P2` prioritized, `P3` nice to have.
- **Difficulty**: `D1` low, `D2` medium, `D3` high, `D4` huge.
- **Type**: `bug`, `enhancement`, `documentation`, `security`, `performance`, `investigation`.
- **Component**: `app` (MAUI), `admin`, `FE` (website), `DB`/`MySQL`, `AWS`, `devops`/`CI`/`CD`, `tests`/`e2e`/`API Tests`/`E2E Tests`.
- **Projects** (`gh project item-add <ID> --owner bible-on-site --url <issue-url>`): `2` website, `3` API, `4` App, `5` Data, `6` Admin.

Title is descriptive (e.g. `Data CI: JUnit report file not generated`); `[P1-P3]`/`[D1-D4]` prefixes are optional since labels carry it. Body template:

```markdown
## Problem
Brief description of the issue.

## Reference
- Link to failing CI run, error logs, or related code

## Root Cause (if known)

## Solution (if known)
```

Complete example:

```bash
gh issue create \
  --title "Feature title" \
  --body "## Problem
Description here

## Reference
- https://github.com/..." \
  --label "enhancement,P2,D2,app,admin,DB"

gh project item-add 6 --owner bible-on-site --url <url>
gh project item-add 4 --owner bible-on-site --url <url>
```
