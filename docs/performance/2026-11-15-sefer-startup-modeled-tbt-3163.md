# Modeled TBT anomaly on Sefer startup (issue #3163): 15 November 2026

Finding from the retained artifacts of CI run 42220273595 (source
`963d2377`, `/929/686` Desktop, modeled TBT 13.994209289550781ms against the
0ms boundary) and the same signature recurring on retained master run
43625270120 artifacts.

## What the modeled number actually is

The CI audits run Lighthouse 13.6.0 with `throttlingMethod: "simulate"`, so
`long-tasks`, `max-potential-fid` and `total-blocking-time` are Lantern model
outputs, not observed values. Observed main-thread durations are scaled by the
calibrated `cpuSlowdownMultiplier` (host benchmark index / desktop target
1500).

| Evidence | Value |
| --- | --- |
| Failing modeled long task | `Unattributable`, simulated 72ms at simulated 161.4ms |
| cpuSlowdownMultiplier | 2.0043333 (host index ~3006.5) |
| Implied observed duration | ~35.9ms — under the 50ms observed threshold |
| Observed tasks >50ms | 0 (both issue diagnostics and trace agree) |
| Modeled TBT | 13.994ms = 0.5·(optimistic + pessimistic window contributions) |

The retained trace of run 43625270120 (current master, TBT 0 only because the
FCP/TTI window clipped <50ms of the task) resolves the task: a 37.41ms
`RunTask` on `CrRendererMain` at 18.75ms — `tdur≈dur` (real CPU, not
descheduling), containing only `V8.GC_TIME_TO_SAFEPOINT`,
`V8.GC_HEAP_ENSURE_SWEEPING_COMPLETED` and one `V8.DeoptimizeCode`, between the
initial about:blank commit (0.42ms) and the real navigation commit (57.3ms).
No JavaScript, layout, paint or parse events — hence `Unattributable`. It is
**deferred teardown/GC of the closed warm-up document**, not page work and not
host scheduling.

## Bounded question and stop rule

Materially different question answered: *does the modeled long task contain any
attributable page work?* Answer: no — it is warm-up teardown deferred into the
audited navigation. Stop rule satisfied without another hosted run: the modeled
task is explained by a mechanism reproduced locally, not a product regression.

Local A/B (Lighthouse 13.6.0, desktop config, multiplier 2.0, heavy Hebrew
page, persistent context mimicking the fixture):

- Warm-up `goto(url)` → `page.close()` → audit: opaque `Unattributable`
  observed 42.8ms task → simulated 86ms (the CI signature).
- Warm-up `goto(url)` → `goto("about:blank")` → `page.close()` → audit: no
  `Unattributable` task ≥5ms — the teardown ran during warm-up.

## Repair

`tests/perf/lighthouse.isolated.test.ts` now navigates the warm-up page to
`about:blank` before `page.close()` (`scripts/lighthouse-warmup.mjs`). The
warmed document's teardown commits inside the warm-up window while the warmed
storage/cache that `disableStorageReset: true` relies on is preserved. No
threshold, deadline, workload or TBT-limit change — the audited trace now
measures the page's own load instead of its predecessor's teardown. Covered by
`scripts/lighthouse-warmup.test.mjs` (`bun run test:perf-reporting`).

## Residual risk (not a claim of full elimination)

Opaque unattributable tasks can still arise from the previous *audit* tab's
teardown and from first-navigation V8/browser initialization; those windows are
smaller and the four-audit sequence absorbs most of the previous audit's
deferred work inside the next unmeasured warm-up navigation. On any recurrence,
the retained `*.artifacts.json` trace resolves the modeled/observed task
mapping directly — `long-tasks` entries are simulated timings and must be
divided by the run's `cpuSlowdownMultiplier` before comparison with the 50ms
observed threshold.
