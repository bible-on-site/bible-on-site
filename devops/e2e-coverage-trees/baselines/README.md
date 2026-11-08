# Committed coverage-tree seeds

Optional trusted `exec-coverage-tree` seeds for the deterministic E2E
selection pipeline (#2085 — see `docs/devops/e2e-test-selection.md`).

Layout: `baselines/<suite>/<platform>.json` (e.g.
`app-mobile-e2e/android.json`). One platform per file — Android and iOS
evidence never mix.

Provenance policy — a file may only land here when **all** of these hold:

- produced by `devops/e2e-coverage-trees/e2e-coverage-trees.ts extract`
  from a **completed, successful full-suite default-branch run** (`push`
  on `master`, pilot `success`, collect `success`);
- `complete: true` and `attribution` not degraded without a documented
  reason;
- committed through a PR that records the source run in the message.

The CI baseline artifact (`app-mobile-e2e-exec-coverage.master.<platform>`,
90-day retention) stays authoritative for selection; committed seeds exist
for local shadow runs, baseline-expiry recovery and human review. Stale or
hand-edited seeds are worse than none — when in doubt, delete the file and
let the next green master run reseed it.
