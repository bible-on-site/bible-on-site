# Learning-Calendar PDF Artifacts (#2608)

Calendar PDFs are **pre-generated S3 artifacts**, not request-time renders.
Rendering a full cycle held the website's event loop for seconds on the
production 0.25-CPU task (sibling health requests stalled); the route now
only resolves a request to a canonical artifact and 302-redirects to it.

## Layout in the assets bucket

```
generated/calendar-pdf/
  objects/<sha256>.pdf      # content-addressed bodies — immutable, never deleted
  manifest.json             # the publish switch: key → object map (flipped last)
  manifest-<fp>.json        # archived manifests for one-copy rollback
```

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
before writing `manifest-<fp>.json` and finally `manifest.json` — a manifest
that parses never references a missing object. Unreferenced objects are
never deleted, so rolling back is a single copy:

```bash
aws s3 cp \
  s3://bible-on-site-assets/generated/calendar-pdf/manifest-<fp>.json \
  s3://bible-on-site-assets/generated/calendar-pdf/manifest.json
```

(or revert the route commit — the old inline renderer is then restored).
