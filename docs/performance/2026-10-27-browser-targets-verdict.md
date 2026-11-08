# Browser targets and legacy polyfills: verdict (27 October 2026)

Verdict for issue #2740, following the findings of the
[production audit](2026-10-27-website-audit.md): **keep the current browser
targets; raising them does not produce worthwhile savings, and the flagged
polyfill payload cannot be removed by any supported configuration.**

## What the flagged code is

The audit flagged ~13,929 bytes inside `26l4wmwla1zzr.js` whose tail matches
`next/dist/build/polyfills/polyfill-module.js` (1,380 bytes of source). It is a
set of feature-detected shims: `String.trimStart/trimEnd`,
`Symbol.description`, `Array.flat/flatMap`, `Promise.finally`,
`Object.fromEntries`, `Array.at`, `Object.hasOwn`, and `URL.canParse`. Each
shim installs only when the feature is missing, so on every browser inside the
declared floors - and every browser in the approved higher baseline - the
payload is inert: it parses but installs nothing.

## Why no supported mechanism removes it

- `polyfill-module.js` is a static `require()` at the top of Next's client
  entry points (`next/dist/client/index.js` and
  `next/dist/client/app-globals.js`) in the installed Next 16.4.3. It is
  bundled into the client runtime chunk unconditionally - there is no config
  gate, conditional import, or browserslist check on that require.
- The project `browserslist` feeds `getSupportedBrowsers()` →
  `browserslistQuery` on the Turbopack build (and SWC `env.targets` on the
  webpack path). It controls **transpilation** of application and framework
  code - not this pre-built runtime asset.
- `experimental.swcEnvOptions` merges into SWC's `env` block; enabling
  `mode: 'usage'` + `coreJs` would inject *more* core-js polyfills, the
  opposite direction. It is unset today.
- The 112 KiB `polyfill-nomodule.js` exists only on the webpack path
  (`CopyFilePlugin` in `webpack-config.js`); Turbopack builds emit no
  `polyfills-*.js` chunk and the HTML carries no `nomodule` script.
- Removing or patching the emitted chunk post-build is explicitly out of
  scope (unsupported runtime modification).

## Declared targets vs. installed framework floor

Current `package.json` browserslist: `chrome/edge >= 109`, `firefox >= 115`,
`safari/ios_saf >= 16`, `not dead`. Next 16.4.3's own fallback
(`MODERN_BROWSERSLIST_TARGET`, "baseline widely available" 2025-10-01) and its
documented supported floor are Chrome/Edge/Firefox **111** and Safari
**16.4** - i.e. the declared Chrome/Edge 109 and Safari/iOS 16 floors are
already below what the framework itself tests against.

## Before/after measurement (reproducible)

Two full production builds under identical code and dependencies - only
`browserslist` differed (candidate: `chrome/edge >= 120`, `firefox >= 115`,
`safari/ios_saf >= 17`, `not dead`). The build also contained the #2735
`cssChunking: "graph"` experiment, which affects CSS emission only, not JS.
Route JS = sum of `<script src>` files in the prerendered HTML.

| Route | Decoded before | Decoded after | Δ | Gzip before | Gzip after | Δ |
|-------|---------------:|--------------:|--:|------------:|-----------:|--:|
| `/` home | 610.1 KiB | 608.2 KiB | -1.9 KiB | 189.1 KiB | 188.7 KiB | -0.4 KiB |
| `/929/686` perek | 645.0 KiB | 643.0 KiB | -2.0 KiB | 201.1 KiB | 200.6 KiB | -0.5 KiB |
| `/pedia/יעקב` | 772.4 KiB | 770.3 KiB | -2.1 KiB | - | 231.3 KiB | - |
| all `static/chunks` | 7,760 KiB | 7,730 KiB | -30 KiB (0.38%) | - | - | - |

The flagged shim payload persists under the raised targets: all eight
signatures (`trimStart`, `trimEnd`, `flatMap`, `finally`, `fromEntries`,
`hasOwn`, `canParse`, `Array.at`) were located in the rebuilt client chunk
(`0d66q46efh1wk.js`, 228,651 B). A browserslist edit removes ~0.3-0.4% of
transpiled syntax helpers and **zero** of the audit-flagged bytes.

At this delta, main-thread-work and LCP differences are below measurement
noise - a sub-1% parse reduction cannot move medians meaningfully, so repeated
cold-load medians were not a deciding input.

## Audience cost of the approved-but-rejected baseline

Raising to Chrome/Edge 120+/Safari-iOS 17+ (Firefox stays 115+) would exclude
real cohorts for ~2 KiB per page: iPhone 8/8 Plus/X-class devices capped at
iOS 16, Chrome on Windows 7/8/8.1 capped at 109, Safari 16 on macOS, and older
WebViews on newer OS versions. Site-specific browser-major traffic data is not
available (bot-filtered analytics do not give a reliable denominator), so the
global proxy figures in the issue were not used as site estimates; the
directional loss is enough to weigh against sub-noise savings.

## Decision

Retain `chrome >= 109, edge >= 109, firefox >= 115, safari >= 16,
ios_saf >= 16, not dead`. The remaining lever is upstream: a Next.js change
that gates `polyfill-module` behind the resolved targets (or ships it
no-op-free for modern baselines). If a future Next version makes the shim
conditional, re-run this measurement; the threshold for adopting a higher
baseline is a per-route payload reduction that meaningfully exceeds noise -
on the order of tens of KiB, not ~2 KiB.

## Reproduce

1. `bun run build` (with `DB_URL` from `.test.env`) on the current browserslist.
2. Extract `<script src>` URLs from `.next/server/app/{index,929/686}.html` and
   a pedia HTML; sum decoded and `gzip -9` bytes.
3. `grep -l 'canParse"in URL' .next/static/chunks/*.js` locates the
   polyfill-hosting chunk; the shims are present under either baseline.
