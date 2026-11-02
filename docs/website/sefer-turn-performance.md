# Sefer turn performance guard

`web/bible-on-site/tests/perf/sefer-consecutive-turns.test.ts` exercises the
first turn and immediate consecutive turns independently. It covers Numbers and
Kings, moving/pinned/hidden bookmarks, and native drag/toolbar input. Moving
bookmarks must pass on their first turn as well as after a previous turn.

The fixed desktop profile uses full Chromium, visible scrollbars, a 1440x900
viewport, 4x CPU slowdown, one worker and zero retries. The performance
configuration serializes all projects so another browser test cannot contend
with the measured reader. Each scenario performs six turns with gaps of
`0, 0, 100, 0, 100, 0` milliseconds. The 100ms gaps cover
the existing 80ms buffer recenter; sampling also continues for 200ms after the
last turn. Both current pages must contain visible text before and after the
timing window. Separate functional tests check visibility after every turn in
all three bookmark modes. Mounted content hidden by page buffering does not qualify.
A zero content buffer must keep both current faces, moving faces and their
underlays readable. Preserve opaque paper surfaces so skipping covered text
cannot change the paper edge.

Read input coordinates before starting the probe and use native input at those
fixed positions. During measured handoffs, wait only for the committed chapter,
completed motion and nonempty page text. Visibility and geometry queries can
force synchronous style/layout work and create the pause being measured. Keep
those rendering assertions outside the timing window; do not add actionability
checks or layout reads between turns.

| Metric | Limit |
| --- | --- |
| Input response p95 | 200ms |
| Maximum frame gap | 100ms |
| Frame gap p95 | 50ms |

The [public baseline](sefer-turn-performance.public-baseline.json) retains all
available samples against website 0.2.600 and explicitly records failed cases
that produced no samples. All 12 reader cases fail with the corrected native-input
observer; the deliberate-stall control passes. The website version and active
desktop were unchanged throughout.
The historical capture hashes and raw samples remain intact. Its `reduction`
field separately identifies the current reducer used to audit those samples.
All 12 original reader cases still fail after correcting clock arithmetic.

Response runs from the trusted native input timestamp to the render opportunity
after the first observed moving-page marker. It is not physical presentation
latency or INP. Frame gaps use distinct native animation-frame timestamps;
repeated timestamps are retained separately as the same render opportunity.
Observation timestamps use `performance.now()`, since the scheduled frame start
can precede an input handled in that frame.

All three limits apply to the first turn, consecutive turns, and the complete
sample. Keep every frame, including buffer cleanup between turns. Missing,
untrusted, out-of-order, unfinished or nonpositive samples fail validation.
Elapsed arithmetic uses integer microseconds while retaining the original raw
samples. This prevents binary subtraction noise such as
`50.000000000000455ms` from inventing an overrun. The exact limits are
200,000 / 100,000 / 50,000 microseconds; a single microsecond over still fails.
Tests explicitly reject 50.001ms, 50.1ms, 100.001ms and 100.1ms. There is no
budget tolerance or selection of the fastest run. A browser control
inserts a 250ms stall on the second turn and must detect it. Its layout-read
sentinels also reject an observer that forces visibility or geometry queries
while timing the control. Reducer tests cover
the sample-validity rules. The scripture-renderer test separately bounds a
100-word active recitation verse to 100 word elements plus its paragraph.
This prevents redundant word/space wrappers from multiplying layout work while
preserving the original text shaping and character positions.

Build against the test database using `.test.env`, populated with the same
commentary data as CI. A minimal seed can hide substantial rendering work. Record
the fixture counts, build ID and actual library source/package with each run, then run:

```sh
bun run test:perf tests/perf/sefer-consecutive-turns.test.ts --project=Desktop --workers=1 --retries=0
```

Keep raw samples and browser/GPU metadata from
`.playwright-report/perf/diagnostics/sefer-turns`, together with the before/after
captures attached to each test. Compare matching source, package, viewport and
CPU profiles. An inactive Windows desktop or screensaver cannot qualify a
desktop measurement. Hardware-rendered desktop results and software-rendered CI
results both retain the limits above; label their environments separately.

For the user's desktop Chrome/Edge profile, run the same matrix in a visible
browser window on an active desktop:

```sh
bun run test:perf tests/perf/sefer-consecutive-turns.test.ts --headed --project=Desktop --workers=1 --retries=0
```

Keep headed desktop and headless CI results separate. Raw samples record the
browser mode; changing that mode does not qualify as a before/after comparison
of a code change. Keep failed measurements when another environment passes.
Serialize builds, coverage collection and timing runs: a build competing with a
timed check is a different load profile. Investigate failures under their
original deadlines rather than increasing them.

Local library validation uses the recorded checkout override described in the
[integration workflow](../../.github/instructions/flipbook-integration.instructions.md).
Restore npm with `bun run flip-book:npm`
and rebuild before qualifying a published package. Disabling local copying alone
does not remove previously copied package files.
