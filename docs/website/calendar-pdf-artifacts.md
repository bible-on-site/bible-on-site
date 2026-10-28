# Learning-Calendar PDF Artifacts (#2608)

Calendar PDFs are **pre-generated S3 artifacts**, not request-time renders.
Rendering a full cycle held the website's event loop for seconds on the
production 0.25-CPU task (sibling health requests stalled); the route now
only resolves a request to a canonical artifact and 302-redirects to it.

## Layout in the assets bucket

```
generated/calendar-pdf/
  objects/<sha256>.pdf            # content-addressed bodies — immutable, never deleted
  manifest.json                   # the publish switch: key → object map (flipped last)
  manifest-<fp>-<sha12>.json      # archived manifests for one-copy rollback
```

Archive keys carry the fingerprint **and** a hash of the manifest's own
artifact map, so two publishes sharing one fingerprint but different artifact
sets (e.g. a dispatch that added `--include` keys) keep distinct restorable
archives.

Canonical artifact keys collapse equivalent legacy URLs onto one artifact:

| Request                                | Key            | Filename                          |
| -------------------------------------- | -------------- | --------------------------------- |
| `?month=578512`                        | `month:578512` | `learning-calendar-578512.pdf`    |
| `?month=578501&view=year`              | `year:5785`    | `learning-calendar-year-5785.pdf` |
| `?month=<any>&view=cycle&cycle=4`      | `cycle:4`      | `learning-calendar-cycle-4.pdf`   |

The generated set is **bounded**: every cycle `1..confirmed+3` (projected
cycles follow the same scheduling rules), every Hebrew year they span, and
every month of those years — 641 keys today (`577501`–`582112`, cycles
1–13). Valid keys outside the set 404; they can be produced out of band
with `--include` and are then served through the manifest.

Extras persist: a key published via `--include` stays in the local cache
index, so every later run carries it in the desired set and re-renders it
when its inputs change — regular publishes never silently drop an
out-of-band artifact. If the local cache is evicted, publication also carries
forward entries from the live manifest after verifying their objects. Such
entries keep their last published PDF until regenerated with `--include`;
retiring a public key requires an explicit manifest change.

## Consumers (#2622)

### Calendar visibility and export eligibility

The calendar page is statically generated. Its browser component computes
today's Jerusalem/nightfall-aware Hebrew date on hydration, refreshes it
while the page is open and on focus/visibility changes, and supplies that
live date to the calendar policy. A deployment date is never used as today.

The website and app show every historical cycle, the current cycle and
exactly one next cycle. Cycle selectors, shared links, month/year selectors
and navigation stop at that next cycle's end. Boundary-month dates beyond
that end have no chapter assignment in the visible calendar.

PDF export permits the current cycle and, inclusively from the same Hebrew
month/day one year before its start, the entire next cycle. This unlocks
its supported future month/year exports too. A month/year spanning a cycle
boundary is exportable only when every included scheduled cycle is eligible;
it cannot expose a later cycle. Hebrew-year anniversaries preserve month
names across leap years and constrain missing days/Adar I.

The controls disable ineligible exports, and `/api/calendar-pdf` returns 404
before fetching the manifest for an ineligible request. The API stays dynamic
so direct API calls and clients using this route receive the same live check.
The generated artifact catalog remains deterministic and independent of the
clock. Already-published S3 objects and their existing public URLs are retained.

Downloads are **on demand**: nothing fetches a PDF — or even the manifest —
until the user activates Download.

- **Website** (`LearningCalendar` → `CalendarPdfDownload`): the page passes the
  static manifest URL (`calendarPdfManifestUrl()`) to the client. On
  activation `resolveCalendarPdfAsset` GETs `manifest.json` once (60 s cache,
  in-flight dedupe), maps the canonical key to the object URL, and hands it to
  the browser — the object's `Content-Disposition: attachment; filename=…`
  makes the browser save natively, so no `/api/calendar-pdf` call and no PDF
  bytes cross the site. When the manifest is unreachable or the key is not
  published, the action falls back to the legacy API URL: it re-checks a
  fresh manifest server-side and its 404/503 map onto "unavailable" /
  "still being prepared" statuses.
- **App** (`LearningCalendarViewModel.DownloadPdfAsync`): resolves the same
  canonical key via `CalendarPdfAssetService`, which lazily GETs and caches
  the manifest under `ASSETS_BASE_URL` (default: the bucket's virtual-hosted
  S3 URL, matching the website fallback). A resolved key opens the object URL
  in the device browser via `Launcher`; a miss or manifest failure opens the
  legacy `/api/calendar-pdf` URL instead. Repeated taps while a fetch is
  pending share one request; the artifact key is captured at tap time so a
  navigation mid-flight cannot change the delivered period.

## Commands (run from `web/bible-on-site`)

```bash
bun run generate:calendar-pdf                 # render missing/stale artifacts
bun run generate:calendar-pdf -- --include cycle:14,month:583001
bun run check:calendar-pdf                    # verify-only; never writes
bun run publish:calendar-pdf                  # dry-run plan
bun run publish:calendar-pdf -- --yes         # real S3 publish
```

Local artifacts live in `.cache/calendar-pdf/` (`objects/`, `manifest.json`,
`cache-state.json`). Publishing targets `S3_BUCKET` (default
`bible-on-site-assets`) and honors `S3_ENDPOINT`/`S3_ACCESS_KEY_ID`/
`S3_SECRET_ACCESS_KEY` — point those at local RustFS/LocalStack to seed a
dev stack, otherwise `/api/calendar-pdf` answers 503 locally.

## CI integration

- `ci.yml` → `calendar_pdf_artifacts`: restores the artifact cache and runs
  `check:calendar-pdf` (~30 s; O(keys) on a fingerprint match, plus a
  re-rendered byte-compare sample). Verify-only — it never saves the cache
  and never renders the full set.
- `calendar-pdf-publish.yml`: runs on master pushes that touch any
  fingerprinted input and on `workflow_dispatch` (`extra_keys`,
  `publish_from_this_ref` for pre-merge seeding). Serialized by a
  concurrency group; owns cache writes and S3 publication behind
  `AWS_DEPLOY_ROLE_ARN` + the `S3CalendarPdfArtifacts` IAM statement in
  `docs/aws/cloudformation/github-oidc.yaml`.

## Invalidation contract

Two fingerprints (`scripts/calendar-pdf-inputs.mjs`):

- **Full fingerprint** — every output-affecting input (renderer, layout/bidi,
  fonts, artifact logic, schedule/cycle/catalog data, Hebrew-date logic,
  generator scripts, output-affecting dependency versions). It is the CI
  cache key: a change opens a new lineage while `restore-keys` still hand
  the previous lineage back for partial regeneration.
- **Render fingerprint** — renderer + fonts + dep versions only, mixed into
  each artifact's `inputSha = sha256(renderFp ‖ key ‖ serialized payload)`.
  Data-side changes therefore re-render only the artifacts whose drawn
  payload actually changed (e.g. a label change on cycle subtitles touched
  13/641).

Rendering is byte-deterministic (`updateMetadata: false` + fixed info-dict
dates), so identical content always lands at the same object key and uploads
are idempotent.

## Publication ordering + rollback

`publishCalendarPdfArtifacts` uploads and HEAD-verifies **every** object
before writing `manifest-<fp>-<sha12>.json` and finally `manifest.json` — a
manifest that parses never references a missing object. Unreferenced objects
are never deleted, so rolling back is a single copy: list the archives
(`aws s3 ls s3://bible-on-site-assets/generated/calendar-pdf/`), pick the
desired one, and copy it over `manifest.json`:

```bash
aws s3 cp \
  s3://bible-on-site-assets/generated/calendar-pdf/manifest-<fp>-<sha12>.json \
  s3://bible-on-site-assets/generated/calendar-pdf/manifest.json
```

(or revert the route commit — the old inline renderer is then restored).
