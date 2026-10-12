# Benchmark comparisons against the base branch

Issue [#2024](https://github.com/bible-on-site/bible-on-site/issues/2024)
records a feature-branch INP alert at 136 ms against an isolated 12 ms baseline.
The same 136 ms had already passed on master, where history gave upper limits
of 185.25 and 174 ms. The browser test's existing 200 ms absolute limit also
passed. No browser application or performance-test source changed between the
feature measurements.

Feature reports use the checked synthetic merge's first parent, even when the
PR payload's base SHA is stale. Queue reports use the immutable queue base.
Both request the base branch and SHA,
inherit its history and thresholds, and reset that comparison on each run.
This also lets a feature's first measurement compare with existing base data.
Pushes and manual master runs keep their accumulated history. Missing or
malformed comparison metadata fails before reporting instead of silently
creating an isolated comparison.

All metric values, absolute checks, threshold models, and boundaries are
preserved. For example, the existing master upper limit of 185.25 ms accepts
the observed 136 ms and still alerts on a 400 ms measurement. No synthetic
measurements are uploaded and no alerts are suppressed.

Version-only commits can legitimately lack a performance report. Bencher's
documented behavior uses the latest base-branch data when the requested SHA
has no report; the selected start point remains visible in its report history.
Inspect that actual start point when validating the hosted comparison. See
the [official start-point rules](https://bencher.dev/docs/explanation/branches/).
