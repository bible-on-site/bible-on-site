# Sefer turn performance guard

`web/bible-on-site/tests/perf/sefer-consecutive-turns.test.ts` exercises the
first turn and immediate consecutive turns independently. It covers Numbers and
Kings, moving/pinned/hidden bookmarks, and native drag/toolbar input. Moving
bookmarks must pass on their first turn as well as after a previous turn.

The historical
[hosted run on `ffa3126`](https://github.com/bible-on-site/bible-on-site/actions/runs/41602765877)
failed its performance gate.
Its full production build succeeded, but eight of the twelve turn scenarios
failed cadence. Response p95 stayed within 166.5ms and the largest frame gap
within 83.4ms; failing cadence p95 values ranged from 50.1ms to 83.3ms across
the first-turn, consecutive-turn and complete-sample checks. The local passes
recorded below remain separate evidence. The fixed limits still apply to CI.
The subsequent [run on `b910a5562`](https://github.com/bible-on-site/bible-on-site/actions/runs/41619733383)
passed eleven scenarios but failed the first hidden-bookmark toolbar turn in
Numbers: frame-gap p95 was 66.6ms, above 50ms. Its response p95 was 113.6ms
and maximum gap 83.3ms; every consecutive-turn scope passed. Website runtime
bytes were unchanged between these hosted runs, so their different failure
counts do not establish an improvement. Both failed runs remain recorded.
The [run on `5527b5daa`](https://github.com/bible-on-site/bible-on-site/actions/runs/41631360042)
also failed cadence in nine scenarios, including first moving-bookmark turns.
Every response stayed below 200ms; cadence p95 reached 66.7ms. Passing local
results do not replace these hosted failures.

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

Inactive listening words omit their inert inline boxes in the book. Their
original text nodes and boundaries stay separate; joining adjacent text changes
Hebrew shaping. The body observes only listening-mode changes and mounts word
components after aligned audio is ready. Progress and playback frames update
their own consumers without rebuilding the body. Enabling listening restores
the original inline controls.

The host skips painting covered retained panes with `visibility: hidden` while
keeping their existing opacity, input and accessibility masks. Their layout
stays available, and the engine clears the mask before exposing content.
Outer page boxes retain their original visibility for back-face preparation.
A broader prototype that also hid those boxes failed the complete local suite:
33/35 checks passed, but consecutive Kings toolbar turns reached a 516.6ms
gap and pinned dragging exceeded the cadence limit. That failure remains
recorded and the broad rule is not used.

An original-4x comparison separately checks every mask's computed state before
timing. All eighteen original-control, page-only and pane-only cases pass.
The selected pane-only variant has toolbar response p95 of 49.7/53.9ms versus
65.8/73.3ms in the original controls; cadence p95 is 33.4ms in both candidates.
These diagnostic comparisons do not replace full production qualification or
hosted CI. The existing deadline and appearance guards remain unchanged.

Ordinary words remain separate primitive children. They allocate no React
elements, fragment nodes or segment keys. In a captured Kings chapter this
removes 561 fragment fibers (708 to 147), while preserving all 1,146 text nodes,
every pixel and every character rectangle. A unit regression bounds 100 ordinary
words to zero React elements and preserves 198 separate word/space text nodes,
including the adjacent words separated by a canonical maqaf. These allocation
counts do not substitute for the independent response and cadence gates.

Actual normal production builds before and after the rendering changes
preserve every pixel across 24 poses and every character rectangle in eight
resting chapter/mode/theme combinations. These include Numbers and Kings, plus
real qri captions in light and dark themes. The caption marker is a span rather
than an unassociated form label, with unchanged selector specificity.

| Before the rendering changes | Locally built candidate |
| --- | --- |
| ![Original word rendering](images/sefer-turn-lag/reader-parts-before.png) | ![Unchanged current reader](images/sefer-turn-lag/reader-final-after.png) |

The [final capture provenance](images/sefer-turn-lag/reader-final-comparison.json)
records all 24 pairs, source trees, production build IDs and asset hashes. The
[earlier word-only comparison](images/sefer-turn-lag/reader-parts-comparison.json)
retains the independently captured allocation-change evidence.

The opaque, viewport-sized reader overlay also contains its painting. This
keeps fold invalidations within the reader's painted bounds; native modal
dialogs retain the document's top layer. A same-source Linux experiment
preserves every pixel in nine Kings poses across all bookmark modes. Separate
control/candidate/control traces record 588/532/554ms of main-thread paint work
over six turns. These diagnostic totals do not establish a cadence pass or a
repeatable latency gain; the unchanged first/consecutive timing gates remain
required after the normal production rebuild, whose results are recorded below.

A held-turn image guard restores inert inline
boxes and the original transparent scripture scroller as an independent control
in each bookmark mode. The whole
book must retain every pixel, with identical recorded paper transforms and clip
paths. Its positive control restores more than 100 boxes, so comparing two
inactive setups cannot pass. The original 0.05px character-position guard stays
independent. An opaque scroller cache was rejected because a straight fold
changed text rasterization despite preserving diagonal-fold captures.

Paper shading must finish with the turn. A settled paper leaf has a transparent
shadow gradient; the previous opacity transition still started two invisible
120ms fades per turn. The hosted failure traces recorded 12 such animations in
each six-turn diagnostic sequence. The paper renderer now keeps its material
classification through settlement and disables those fades. Rigid covers keep
their existing 120ms shading transition. The library's
[browser regression](https://github.com/doradsoft/html-flip-book/blob/dd02ed799f405840d155594d7a471023fcdee720/e2e/cover-shadow.spec.ts)
checks both reading directions, zero-duration paper shading and unchanged cover
shading. Its material tests also cover invalid/restored dimensions and cover
reclassification without redundant class writes. The
[actual old/new reader captures](https://github.com/doradsoft/html-flip-book/blob/dd02ed799f405840d155594d7a471023fcdee720/docs/images/sefer-shadow-comparison.json)
preserve every pixel across 18 page poses and every recorded character rectangle.

Commentary panels also keep stable chapter navigation callbacks and reuse their
rendered trees when their props have not changed. A turn should update the two
panels whose active state changes, while covered panels keep their existing
content. Regression tests check that an unchanged covered panel repeats no
commentary eligibility work, activation still updates it, and navigation follows
new chapter IDs when the corpus changes.

Scripture bodies retain their own memoized trees. Reading estimates and progress
units can update the surrounding page chrome when background summaries arrive,
without rebuilding verses or leaving the estimates permanently absent. The
regression checks both asynchronous chapter metrics and changed current-chapter
props while preserving the scripture-render count.

Moving bookmarks keep the same book colors as their resting tabs. Their parent
changes from the bookmark layer to a fold surface during a turn; theme selectors
must match both parents. A browser regression checks the background, text and
border colors on every visible surface at two held fold positions.

These original browser-test attachments show the same held Kings turn before
and after the theme repair. The moving tab retains the book's blue background;
the corrected theme is independent of the remaining cadence failures.

| Before the theme repair | After the theme repair |
| --- | --- |
| ![Moving tab loses its book color](images/sefer-turn-lag/moving-bookmark-before.png) | ![Moving tab keeps its book color](images/sefer-turn-lag/moving-bookmark-after.png) |

The [capture provenance](images/sefer-turn-lag/moving-bookmark-theme.json)
records the production-build source and original attachment hashes.

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

Reader source tree `33bd53b16542de070b019bf8d13080027cba221b` with
flip-book executable source `8def6671570e66c223a25609f1a78e0a4dfee818` passed
all 12 reader cases and the deliberate-stall control in each environment below,
without retries. This local-library qualification uses full Chromium
156.0.8078.4, the viewport and slowdown above, and the full-content fixture.
These are separate environment results, not a headed/headless before-and-after
comparison. Values are the worst across all 12 cases; first-turn and
consecutive-turn windows also pass independently. Record the normal registry
rebuild and CI separately when adopting the published package.

| Environment | Response p95 | Maximum gap | Gap p95 | First-turn gap p95 | Consecutive gap p95 |
| --- | --- | --- | --- | --- | --- |
| Active Windows desktop, headed | 111.8ms | 83.4ms | 49.9ms | 50ms | 50ms |
| Linux, headless, four shared CPUs | 109.2ms | 66.7ms | 49.9ms | 50ms | 33.4ms |

Before this shadow fix, the website head using alpha.102 failed 8/12 cadence
cases in [hosted CI](https://github.com/bible-on-site/bible-on-site/actions/runs/41514403497),
including independent first-turn failures with moving bookmarks. Its original
samples remain failed; profiled diagnostic runs and passing local runs do not
replace them or relax the limits.

The subsequent alpha.104 [hosted run](https://github.com/bible-on-site/bible-on-site/actions/runs/41528676321)
passed 30/37 performance checks but still failed seven reader cadence cases.
Response stayed below 200ms and maximum gaps below 100ms; first-turn gap p95
reached 83.3ms and consecutive-turn gap p95 reached 66.7ms. The paper opacity
animations were absent in those diagnostics. Keep these failures alongside the
local passes: the released shadow fix alone does not establish hosted delivery.

The subsequent panel-cache-only head also retained four failures in its full
local matrix. Its [complete native samples](sefer-turn-performance.panel-baseline.json)
remain unqualified, including the 250.1ms maximum gap. Independent candidate
comparisons do not replace that failed run. Reducer regression tests replay all
12 native cases and preserve every reported timing and failure.

After the primitive-word change, source tree
`410c6696891fffa02221ebbe01907b6a95b53c6e` passes all 13 active Windows
desktop reader checks. Worst response p95 is 101.1ms, maximum gap 83.3ms,
overall gap p95 33.6ms, first-turn gap p95 33.4ms and consecutive-turn gap p95
33.6ms. Its full Linux suite passes 34/35 checks: Kings with hidden bookmarks
and dragging still fails with overall/consecutive gap p95 66.7ms. Response
126.1ms and maximum gap 83.4ms stay within their limits. Keep that failed run
and its separate diagnostic trace; passing desktop or candidate runs do not
replace it. The same source passes 57 functional checks with one existing
conditional skip, including MP3/Opus playback, all three zero-pixel held-page
guards and visibility after every turn. The subsequent overlay revision has
its own qualification below.

The normal registry build of source tree
`1f3bbf0b4b06eee5897bc4b929b7bb8d5056965d`, build
`9CGBBTasqTMfe4fmB4wWE`, passes all 35 Linux performance checks and all 13
active Windows desktop reader checks with zero retries. Each environment has
12 independently guarded cases plus its deliberate-stall control. All three
limits pass for first turns, consecutive turns and the complete sequence.

| Environment | Response p95 | Maximum gap | Gap p95 | First-turn gap p95 | Consecutive gap p95 |
| --- | --- | --- | --- | --- | --- |
| Windows desktop, headed GPU compositing | 125.3ms | 83.2ms | 33.4ms | 50ms | 33.4ms |
| Linux, headless SwiftShader, four shared CPUs | 109.2ms | 83.4ms | 49.9ms | 49.9ms | 50ms |

This revision also passes 57 functional checks with one existing conditional
skip, including real MP3/Opus playback, all three strict held-page image guards,
selection, native drag, TOC/history, commentary and moving-bookmark themes.
The 24 actual-build appearance pairs and eight character comparisons remain
identical after overlay containment. Registry validation confirms all 153
library dist files match executable source `8def6671570e66c223a25609f1a78e0a4dfee818`;
there is no local override. CI and public measurements are separate delivery
evidence, and every earlier failed run remains failed.

The desktop has GPU compositing enabled; Linux uses SwiftShader software
rendering. Keep their raw GPU metadata with the timing samples.

The reader now prepares the covered paper back faces before another turn
starts, using `will-change: transform, clip-path` within its bounded page buffer.
The current spread and hover folds retain their original rasterization;
the library continues to own inline hints during a drag or animation.
A matched control/candidate/candidate/control diagnostic at 6x CPU slowdown
reduced the first hidden-bookmark toolbar cadence p95 from 66.7/50ms in the
controls to 33.4/33.4ms in the candidates. Other stress cases still failed;
this diagnostic does not replace qualification at the original 4x profile.

The new normal registry build of source tree
`da51ce090329a87be3b62ee11cc4a1a8e105ea2c`, build
`N5WBWuRiA4bjxnty-3Wsk`, passes all 35 Linux performance checks, all 13
active Windows reader checks, and 57 functional checks with one existing
conditional skip. There are no retries or runtime overrides. The full route
set and content fixture are unchanged. First turns, consecutive turns and
complete sequences pass the original limits independently.

| Environment | Response p95 | Maximum gap | Gap p95 | First-turn gap p95 | Consecutive gap p95 |
| --- | --- | --- | --- | --- | --- |
| Windows desktop, headed GPU compositing | 124.4ms | 83.4ms | 49.9ms | 50ms | 49.9ms |
| Linux, headless SwiftShader, four shared CPUs | 91.7ms | 66.7ms | 50ms | 33.4ms | 50ms |

The [qualification record](sefer-turn-performance.covered-back.json) retains
all twelve cases in each environment. These local results still require
independent hosted CI and public-reader verification.
The [actual production capture comparison](images/sefer-turn-lag/reader-covered-back-comparison.json)
has zero changed pixels across all 24 poses and zero movement in eight
character comparisons, including real qri captions in both themes. The earlier
capture chain independently preserves parity with the original word rendering.

| Before covered back-face preparation | After |
| --- | --- |
| ![Previous reader](images/sefer-turn-lag/reader-final-after.png) | ![Prepared reader with unchanged appearance](images/sefer-turn-lag/reader-covered-back-after.png) |

An experimental appearance lock used native element view-transition snapshots
to freeze already painted scripture while a leaf turned. Opaque snapshots
changed straight-fold text rasterization. Falling back to live text for that
pose preserved every pixel in the tested rest/straight/angled captures, but
matched 6x CPU diagnostics worsened moving-bookmark cadence p95 from about
66.7ms to 100ms. The snapshot experiment is not used by the production reader.

The normal Linux build generates all 20,504 routes / 20,497 prerenders. The
complete desktop performance suite passes 35 checks. Separate interaction
checks pass with real MP3 and Opus playback. The three held-page image guards
preserve every pixel; 36 additional comparisons cover rest, straight and
angled folds in every bookmark mode across light, dark and high-contrast
themes. These captures from the passing leaf-bookmark guard show the live
original inline-box control beside the optimized body. The two PNG attachments
are byte-identical.

| Original inline-box control | Optimized body |
| --- | --- |
| ![Original held page](images/sefer-turn-lag/reader-held-original.png) | ![Optimized held page](images/sefer-turn-lag/reader-held-optimized.png) |

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

Samples also retain the browser's passive long-animation-frame records when
supported. They identify script invokers, forced layout and the start of the
rendering work without enabling a profiler during qualification. These records
are optional; their absence is not a timing pass. The native response and
cadence samples remain authoritative, including
the deliberate 250ms stall control. Diagnostic records do not filter or adjust
any timing sample.
After a cadence failure, a separate sequence also captures a Chromium trace and
CPU profile under `diagnostics/sefer-turn-traces`. These profiled samples are
labelled diagnostic-only and never replace the failed qualification samples.
Both sequences share the same native inputs and retain the original test deadline.

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
