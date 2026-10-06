# Codecov Reliability — Self-Hosting Investigation

Investigation for [#1104](https://github.com/bible-on-site/bible-on-site/issues/1104).

## Problem

Codecov SaaS outages (e.g. the 2026-10-04 TLS certificate expiry on
`*.codecov.io`) can block merges. During an outage, coverage uploads inside the
required `cross_module_ci` job fail, and the "Verify Coverage 3rd Party
Reporting" step cannot resolve `ci_passed`.

## Current Failure Surface

| Surface | Behavior during an outage | Blocks merge? |
| ------- | ------------------------- | ------------- |
| Coverage uploads in `cross_module_ci` (website/api/app/data) | `fail_ci_if_error: true` → step fails → job fails | **Yes** |
| Coverage uploads in `cross_module_ci` (bulletin/admin) | `fail_ci_if_error: false` | No |
| JUnit test-results uploads in module jobs | default `fail_ci_if_error: false` | No |
| `codecov/patch`, `codecov/project/<flag>` status checks | fail/absent, but not required checks | No |
| "Verify Coverage 3rd Party Reporting" step | polls `api.codecov.io` for `ci_passed` with backoff; on unresolved → `::warning::` and proceeds; fails only on explicit `ci_passed=false` | No |

Only the four strict coverage uploads actually block the required check today.

## Option A — Self-hosted Codecov (not recommended)

`codecov/self-hosted` is a Docker Compose PoC built on Codecov's **deprecated**
Enterprise On-Premises product:

- Compose stack: web API, worker, frontend, Postgres, Redis, and MinIO — the
  README explicitly warns it is "not hardened for security" and recommends
  Helm/Terraform for production (i.e. a Kubernetes or equivalent deployment).
- Requires a configured GitHub integration (GitHub App credentials), TLS
  termination, and a license. Licenses are self-generated via
  `scripts/license.py` (the README states no purchase is required), but license
  expiry and regeneration become an ops concern.
- Upstream maintenance is minimal (single-digit commits/year) since the
  enterprise product it is based on was deprecated.
- For this repo it means an always-on AWS stack (compute + database + object
  storage), secrets, monitoring, upgrades, and backups — to protect a coverage
  dashboard. The failure mode also doesn't disappear: it moves from Codecov's
  uptime to our own self-managed uptime, while CI runners still depend on an
  external endpoint.

Cost/complexity is disproportionate for a project of this size. **Rejected.**

## Option B — Keep Codecov SaaS, decouple uploads from merge gating

Coverage uploads are telemetry: a failed upload does not indicate a product
defect. The quality gate is the `ci_passed` verification step, which already
tolerates outages (warn-and-proceed).

Concrete change: set `fail_ci_if_error: false` on the four coverage uploads
(website, api, app, data) so an outage produces warnings instead of a blocked
merge. When Codecov is healthy, the verify step still enforces `ci_passed` —
including the per-flag coverage thresholds in `codecov.yml` — so the gate is
preserved.

This matches the issue's "make Codecov check non-blocking" alternative while
keeping coverage enforcement active under normal operation. **Recommended.**

## Option C — Replace Codecov gating with Codacy or in-CI checks

Codacy already receives the merged cross-module LCOV report and enforces a
diff-coverage gate on PRs. A harder migration would replace the per-flag
codecov.yml thresholds with an in-CI LCOV comparison job (the repo already
builds an LCOV Docker image and merges module coverage). This removes the
third-party dependency entirely but loses per-module flag dashboards and
requires reimplementing threshold logic. Kept as a fallback if SaaS reliability
degrades further.

## Decision

Implement **Option B** in this PR: uploads become best-effort
(`fail_ci_if_error: false`), the `ci_passed` verify poll remains the gate.
Self-hosting stays available as a contingency if Codecov SaaS becomes
persistently unreliable or shut down.
