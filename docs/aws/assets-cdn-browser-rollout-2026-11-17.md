# Browser-facing assets CDN rollout - 2026-11-17

Repository-side mechanism for opting browser-facing website/admin asset URLs
into the accepted additive CloudFront distribution
(`E1WMX9UV9D2726` / `https://dpcnux643agl3.cloudfront.net`), gated by issue
[#2576](https://github.com/bible-on-site/bible-on-site/issues/2576) and the
[asset delivery report](s3-delivery-cost-2026-11-01.md). Nothing here changes
live AWS state: activation is an explicit owner step after specific approval,
and every existing public S3 URL keeps working regardless of the flag.

## Mechanism

Two independent repository variables now exist:

| Variable | Consumer | State |
| --- | --- | --- |
| `ASSETS_BASE_URL` | CI build-machine downloads (`RECITATION_ASSETS_ORIGIN`) | Set 2026-11-01; unchanged by this work |
| `BROWSER_ASSETS_BASE_URL` | Browser-facing website + admin asset URLs | **Unset = off**; the gate for this rollout |

`BROWSER_ASSETS_BASE_URL` is passed to the website and admin Docker builds as
`ASSETS_BASE_URL` (the name the URL helpers already resolve). The website
bakes it two ways:

- **Build time** (`builder` stage ENV): statically generated HTML resolves
  `assetsUrl()` during `bun run build`, so prerendered pages carry the CDN
  origin. An ECS task-definition environment edit alone cannot rewrite that
  HTML — this is the gap the report called out, and why the origin must be a
  build argument.
- **Runtime default** (`runner` stage ENV): ISR/SSR re-renders and route
  handlers (`/api/recitation`, calendar-pdf redirects, moadim/articles
  services) read the same value, keeping dynamic responses consistent with
  the baked HTML. A task-definition `ASSETS_BASE_URL` entry can still
  override it for emergencies; the reference task definitions keep it unset.

The admin image bakes the same runtime default; its URL helper resolves the
origin at request time, so no admin task-definition edit is required either.

Unchanged by design: public S3 object reads, uploads and presigned
operations, the canonical corpus `audioUrl` metadata (S3 URLs stored as
data), bulletin email icon URLs already published to subscribers, the API,
DNS, nginx routing, and the distribution's disabled-caching policy.

## Activation (owner steps, after specific approval)

1. Read-only recheck: distribution deployed and `InProgress=false`, the
   `ASSETS_BASE_URL` build variable intact, website/admin task definitions
   unchanged, and `BROWSER_ASSETS_BASE_URL` absent.
2. Set the opt-in:
   ```bash
   gh variable set BROWSER_ASSETS_BASE_URL --repo bible-on-site/bible-on-site \
     --body "https://dpcnux643agl3.cloudfront.net"
   ```
3. Release and deploy website **and** admin (normal release/CD path). Only
   images built after the variable is set carry the CDN origin.
4. Validation gates already wired into CI/CD:
   - The packaged-website check fails the build if `BROWSER_ASSETS_BASE_URL`
     is set but the CDN host is absent from prerendered HTML
     (`/rabbis-blessing`) or the `/api/recitation` payload.
   - `cd-aws`'s post-deploy verifier fetches `audioUrl` bytes through
     whatever host the site emits — with the opt-in it hash-verifies real CDN
     MP3/Opus bytes, `audio/mpeg`/`audio/ogg` MIME and CORS.
5. Manual browser validation on the deployed site before declaring done:
   - Perek page images (display + `og:image`) and author portraits render
     from the CDN host; view-source on a prerendered `/929/<n>` page shows
     `dpcnux643agl3.cloudfront.net`, not only runtime responses.
   - Audio plays and **seeks** (Range/206 through the CDN), including the
     derived Opus playback path; no CORS/preflight console errors.
   - Mutable-key freshness: overwrite or re-upload a mutable object (e.g. an
     `authors/high-res` portrait) and confirm the CDN serves the new bytes
     immediately — caching is disabled, so staleness means misconfiguration.
   - Spot-check stored-content S3 URLs inside article bodies still load
     directly from S3 (they are data and are intentionally not rewritten).
6. Monitor at least seven complete days: CloudFront bytes/requests/4xx/5xx
   and daily Cost Explorer S3 vs CloudFront totals, allowing billing delay.

## Rollback

- **Full rollback:** redeploy the previous website/admin release versions
  (versioned image archives are retained per release), then unset
  `BROWSER_ASSETS_BASE_URL` so later builds return to direct S3 URLs. Do not
  disable or delete the distribution — deployed static HTML still publishes
  CDN URLs and must keep resolving.
- **Partial runtime-only override:** a task-definition
  `ASSETS_BASE_URL=""` entry reverts dynamic responses, but baked static
  HTML keeps emitting CDN URLs. Use only as a stopgap while a clean image
  rollback runs.
- `devops/assets-cdn-check.mjs --candidate https://dpcnux643agl3.cloudfront.net`
  re-runs the paired source/CDN probes at any time without touching live
  config.

## Remaining #2576 items after this change

Browser adoption completes the repo-side asset-delivery work. The umbrella's
other migrations stay gated for their own approvals, none resumed here:

- db-populator Lambda redeploy (dual caller contract until all callers send
  `db_url`) and SSM interface-endpoint removal after a verified consumer
  audit — live verification and console work remain owner-side.
- Optional admin scale-to-zero schedule; further log-retention reduction
  (needs archive/restore verification).
- Explicitly skipped by Dorad: website/admin ARM64 (#2562), router
  replacement (#2561), whole-site edge trial (#2508); HTTP/3 follow-up is
  scoped to #2990. This change neither resumes nor blocks any of them.
