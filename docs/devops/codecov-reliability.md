# Codecov Reliability — Self-Hosting Investigation

Investigation for [#1104](https://github.com/bible-on-site/bible-on-site/issues/1104).

## Problem

Codecov SaaS outages (e.g. the 2026-10-04 TLS certificate expiry on
`*.codecov.io`) can block merges. During an outage, coverage uploads inside the
required `cross_module_ci` job fail, and the "Verify Coverage 3rd Party
Reporting" step cannot resolve `ci_passed`.

## Failure Surface (before this change)

| Surface | Behavior during an outage | Blocks merge? |
| ------- | ------------------------- | ------------- |
| Coverage uploads in `cross_module_ci` (website/api/app/data) | `fail_ci_if_error: true` → step fails → job fails | **Yes** |
| Coverage uploads in `cross_module_ci` (bulletin/admin) | `fail_ci_if_error: false` | No |
| JUnit test-results uploads in module jobs | default `fail_ci_if_error: false` | No |
| `codecov/patch`, `codecov/project/<flag>` status checks | fail/absent, but not required checks | No |
| "Verify Coverage 3rd Party Reporting" step | polls `api.codecov.io` for `ci_passed` with backoff; on unresolved → `::warning::` and proceeds; fails only on explicit `ci_passed=false`. A transport failure (e.g. TLS handshake) killed `curl` under `bash -e` before reaching that warn path | **Yes** |

Before this PR the four strict coverage uploads blocked the required check,
and a Codecov transport error did too — the poll's warn-and-proceed path was
unreachable when `curl` exited non-zero.

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
defect. The quality gate should therefore live where the coverage data already
exists — the local lcov reports — rather than in the upload's delivery.

Concrete changes:

1. Set `fail_ci_if_error: false` on the four coverage uploads
   (website, api, app, data) so an outage produces warnings instead of a
   blocked merge.
2. Add a `Verify Local Coverage Thresholds` step
   (`devops/verify-coverage-thresholds.mts`) that parses the per-flag targets
   from `codecov.yml` and enforces them against the local lcov reports —
   keeping threshold enforcement even when an upload never reaches Codecov.
3. Harden the `ci_passed` verify poll so a `curl` transport failure is treated
   like any other non-200 response and reaches the retry/warn-and-proceed path
   instead of failing the step under `bash -e`.

This matches the issue's "make Codecov check non-blocking" alternative while
keeping coverage enforcement active under all conditions. **Recommended.**

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
(`fail_ci_if_error: false`), flag thresholds are enforced locally against the
lcov reports, and the `ci_passed` verify poll survives transport failures.
Self-hosting stays available as a contingency if Codecov SaaS becomes
persistently unreliable or shut down.
