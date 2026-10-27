# Production website audit: 27 October 2026

Collected 12 Lighthouse 13.5.0 audits from the public HTTPS service between
12:32 and 12:34 Israel time: three fresh Chrome profiles per URL/device, no
warm-up. Mobile uses Lighthouse's default simulated network and 4x CPU slowdown.
These are observations from one machine, not real-user p75 or controlled
before/after measurements. CrUX was unavailable because no API key was set.
Reproduce with the [production collector](website-audits.md).

| Page | Device | Median performance | Median LCP | LCP range | Median TBT | CLS |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| `/` | Mobile | 96 | 2.71 s | 2.25-3.12 s | 32.5 ms | 0 |
| `/` | Desktop | 100 | 0.75 s | 0.73-0.97 s | 0 ms | 0 |
| `/929/686` | Mobile | 87 | 3.96 s | 3.95-4.12 s | 40.5 ms | 0 |
| `/929/686` | Desktop | 99 | 0.84 s | 0.77-0.84 s | 0 ms | 0 |

The localhost CI score of 100 does not describe mobile production loading.
The chapter's LCP element is the scripture `<article>`; the homepage's is the
introductory paragraph. An image-priority change would not address those text
elements. Raw LCP breakdown timings are observed trace values; do not equate
them with Lighthouse's simulated LCP above.

## Concrete next changes, in priority order

### 1. Stop preloading fonts unused on the home and chapter pages

[RootLayout](../../web/bible-on-site/src/app/layout.tsx) declares Geist Sans and
Geist Mono with `next/font/local`, whose preloading is enabled by default.
Production requests fetch 66,576 and 68,172 bytes respectively before the reader
font, about **132 KiB combined**. The source has no consumer of
`--font-geist-mono`; `--font-geist-sans` is referenced only in
[PersonFamilyTree.module.css](../../web/bible-on-site/src/app/pedia/components/PersonFamilyTree.module.css).

Remove the unused Mono declaration. Scope Sans to the family-tree route, or set
its `preload: false` while retaining its CSS variable. Keep TaameyD loading for
scripture. Validate that the two Geist requests disappear from cold home/reader
loads and that family-tree typography still works. The removable request bytes
are observed; their LCP benefit needs a measured before/after comparison.

### 2. Split the shared CSS chunk instead of deleting apparently unused rules

`0ukhla8ri-oa_.css` is **87,455 decoded bytes**, about 16 KiB transferred; the
chapter audit marks about **15 KiB / 94%** unused. Its selectors identify
Tanahpedia page styles (`tanahpediaPage`), family-tree styles (`marriageColumn`,
`relationRibbon`) and many other modules in the same shared chunk. This is not
simply an oversized `globals.css` import.

The relevant owners include [pedia/page.module.css](../../web/bible-on-site/src/app/pedia/page.module.css)
and [PersonFamilyTree.module.css](../../web/bible-on-site/src/app/pedia/components/PersonFamilyTree.module.css).
The current [Next configuration](../../web/bible-on-site/next.config.mjs) uses
Turbopack's default CSS merging. The installed Next 16.4.3 documentation supports
`experimental.cssChunking: 'graph'` for precisely this case; measure it against
the current build, then tune `requestCost` only if necessary. Compare home,
reader and pedia CSS bytes/request counts and test navigation, dark mode, menus
and family-tree layouts. Coverage alone cannot justify removing interaction or
dark-mode styles. One initial production sample estimated 140 ms of savings;
that estimate is not a guaranteed improvement.

### 3. Move analytics loading out of the first interactive work

The largest unused-JavaScript resource is Google's `gtag/js`, roughly **90 KiB
unused** in the initial sample (about 54-56% of its transfer). The exact source is
[GoogleAnalytics.tsx](../../web/bible-on-site/src/app/components/GoogleAnalytics.tsx):
both scripts use `afterInteractive`, and the external gtag script starts before
the inline BotD decision. The bot check therefore does not avoid its download.

Test loading the external script only after the existing human-traffic decision,
and scheduling statistics with `lazyOnload` if its page-view requirements permit.
Retain the current consent defaults and disabled advertising settings. Verify
that ordinary visitors still send one page view and filtered bots do not fetch
gtag. Lighthouse's unused-byte count does not mean those bytes can be edited out
of Google's hosted script.

### 4. Treat legacy polyfills as a framework finding

`26l4wmwla1zzr.js` contains about **13,929 bytes** identified as legacy code:
`Array.at`, `flat`, `flatMap`, `Object.fromEntries`, `Object.hasOwn`, and string
trim helpers. The end of the captured chunk matches Next's
`dist/build/polyfills/polyfill-module.js`; this is not a large application
dependency that can simply be lazy-loaded. Investigate a supported framework
removal/targeting mechanism upstream, preserving the declared browser support.
Do not manually strip generated runtime code or assume a browserslist edit
removes this built-in payload.

## Additional evidence and limits

- Homepage chunk `0dgzcj2ql2p_j.js` contains learning-calendar and sunrise/sunset
  calculations, including exports from
  [learning-schedule.ts](../../web/bible-on-site/src/data/learning-schedule.ts).
  The first audit marked about 32 KiB unused. Before changing imports, use
  `next analyze --output` to distinguish eagerly imported code from Turbopack's
  shared-chunk merging; the source calendar component itself is route-scoped.
- Lighthouse observed `http/1.1` and estimated roughly 50-150 ms of LCP savings
  from a modern protocol. Verify negotiation from another network and the live
  load balancer before proposing infrastructure changes. No AWS configuration
  was changed by this audit.
- Homepage accessibility is 98 due to the missing main landmark. The chapter's
  accessibility score is 100. This is separate from Web Vitals.
- The revised interaction test was run against production on four URLs and both
  viewports: all eight passed, including finite homepage INP. These scripted
  interaction samples are not a substitute for CrUX/RUM.

Captured resource hashes and the full per-run JSON/HTML are retained in the
collector output. All estimates above refer to those captured bundles, whose
filenames can change on deployment.
