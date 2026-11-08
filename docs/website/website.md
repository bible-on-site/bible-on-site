# Website Architecture

This document describes the architecture of the Bible on Site website (`web/bible-on-site`).

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                          Client Browser                          │
└─────────────────────────┬───────────────────────────────────────┘
                          │ HTTP/HTTPS
                          ▼
┌─────────────────────────────────────────────────────────────────┐
│                      Next.js Server (SSG)                        │
│  ┌───────────────────────────────────────────────────────┐      │
│  │                     App Router                         │      │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐    │      │
│  │  │   /929/*    │  │     /       │  │   /api/*    │    │      │
│  │  │  Perek Page │  │  Home Page  │  │  Dev APIs   │    │      │
│  │  └──────┬──────┘  └─────────────┘  └─────────────┘    │      │
│  └─────────┼─────────────────────────────────────────────┘      │
│            │                                                     │
│  ┌─────────▼─────────────────────────────────────────────┐      │
│  │                Data Access Layer (DAL)                  │      │
│  │  ┌───────────────┐  ┌───────────────┐  ┌────────────┐  │      │
│  │  │  Static JSON  │  │ MySQL Client  │  │  Bulletin  │  │      │
│  │  │  (tanah_view) │  │ (mysql2)      │  │  Client    │  │      │
│  │  └───────────────┘  └───────┬───────┘  └──────┬─────┘  │      │
│  └─────────────────────────────┼─────────────────┼────────┘      │
└────────────────────────────────┼─────────────────┼───────────────┘
                                 │ TCP/3306        │ AWS SDK
                                 ▼                 ▼
                    ┌──────────────────┐  ┌────────────────────┐
                    │      MySQL       │  │  Lambda: bulletin  │
                    │ (tanah database) │  │  (Rust PDF gen)    │
                    └──────────────────┘  └────────────────────┘
```

## Design Decisions

### Direct Database Access

The website communicates **directly** with the MySQL database rather than going through the API layer. This architectural decision was made for:

1. **Lower Latency**: Eliminates the network hop to the API service, reducing response times by ~50-100ms per request.

2. **Reduced Billing Costs**: No API compute costs for website data fetching. Database queries are more cost-effective than API invocations.

3. **Simplified Deployment**: Website can operate independently without requiring the API service to be running.

### Data Sources

| Data Type | Source | Rationale |
|-----------|--------|-----------|
| Tanah Text (sefarim, perakim, pesukim) | Static JSON (`tanah_view.json`) | Read-only, changes infrequently, optimal for SSG |
| Articles | Direct MySQL query | Dynamic content, needs real-time updates |
| Dedications | Direct MySQL query | Dynamic content, frequently updated |
| PDF Bulletins | AWS Lambda (`bible-on-site-bulletin`) | On-demand generation, offloaded to Lambda for compute isolation |

### Browser Data Boundary

Keep the full canonical scripture JSON in server imports. The bookshelf, date
lookup and citation parser use `client-catalog.generated.json`, a small projection
of book ranges and learning dates. `scripts/generate-client-catalog.mjs` also writes
each reader book as a Brotli file under `public/generated/sefarim/`, named by the
raw payload's content hash. Installation, builds and unit tests regenerate both
outputs from the same canonical source; generated files are ignored. Do not edit
them or maintain a second content source. After an intentional source change
during development, rerun the generator or restart `bun run dev`.

The books are served as static files: `next.config.mjs` marks
`/generated/sefarim/*` as `Content-Encoding: br` with `Cache-Control: immutable`,
since a content-addressed name can never change bytes — the payloads are multi-MB,
so compression cuts the wire transfer by an order of magnitude. They are static
files rather than a route handler because the App Router response pipeline can
drop `Content-Encoding` while still sending the encoded body, which leaves
browsers unable to decode it. `LoadedSefer` fetches the selected book when the reader
opens, with visible loading feedback. Uninitialized reader pages stay unpainted
until FlipBook has applied their dimensions, preserving geometry and preventing a
layout flash. A transient failure offers a manual retry; a missing asset offers a
full page refresh — the 404 itself is `no-store`, and only a fresh page load can
pick up a consistent bundle/deployment pair — while a flat-view escape keeps the
chapter/article reachable. The browser cache retains at most four recent books.
Avoid passing whole books through every static page: that repeats scripture in
HTML/RSC and increases server memory and deployment size. Chapter navigation
within the same book reuses its data; late requests cannot replace another
selected book. Download helpers load only when requested, so metadata requests do
not initialize the PDF generator's corpus.

The source text, reading order and recitation fields remain unchanged, including
canonical JSON precision handling in `next.config.mjs`. Tests compare every
metadata row and generated book with the canonical source. Production performance
tests reject browser scripts over 5 MiB and retain the existing memory/build limits.

### Production validation on Windows

Next.js 16.4.0-canary.61 cannot persist native Windows route-cache entries for
commentary URLs containing an ASCII quote, such as `רש"י`. The framework appends
the decoded pathname to a filesystem key; Windows rejects that filename. A
successful page response does not prove that the cache write succeeded.

Production and CI use Linux. Use Linux, Docker or WSL when validating production
cache persistence. Keep the existing commentary URLs and cache behavior. The
supported upstream fix and cross-platform checks are tracked in
[the Windows route-cache issue](https://github.com/bible-on-site/bible-on-site/issues/1999).

### SSG Compatibility

The website uses Next.js Static Site Generation (SSG) with the following patterns:

- **Static Pages**: All 929 perek pages are pre-rendered at build time
- **Dynamic Data**: Articles are fetched at request time (ISR) with caching
- **Graceful Degradation**: If database is unavailable during SSG build, pages render without articles

### Sitemap & Missing Pages

- `/sitemap.xml` is generated at build time by `src/app/sitemap.ts`
  (`dynamic = "error"`, `revalidate = false`). The public URL
  `/sitemap_www.xml` stays a permanent redirect to that single canonical
  document (`next.config.mjs`) so external consumers that still fetch the
  old name — e.g. past Search Console submissions — never hit a 404.
- Every human-facing miss renders `src/app/not-found.tsx`: one branded
  Hebrew page at a real 404 status with noindex and a home recovery link.
  Route-level "entity missing" metadata fallbacks (pedia entry, author,
  article, perush) return the shared `NOT_FOUND_METADATA`
  (`src/lib/seo/missing-page.ts`) so the title and OpenGraph contract are
  identical on every 404 surface.
- The nginx router's `/www/` static tree is a supported surface and stays
  router-local end to end: missing files answer with the branded Hebrew
  page deployed into the tree as `/www/404.html` (committed at
  `docs/aws/cloudformation/ec2-nginx/router/404.html`, wired by
  `error_page 404 /www/404.html` in `router.conf`) instead of the stock
  nginx 404 — no app proxying, no extra backend renders. The post-deploy
  `verify-canonical-hosts.mjs` smoke check asserts both contracts on each
  public domain: a permanent `/sitemap_www.xml` → `/sitemap.xml` redirect
  and a branded-body 404 for a missing `/www/` file.

## Content Freshness (On-Demand Revalidation)

DB-backed reads are cached indefinitely (`unstable_cache` with
`revalidate: false`) under the tags `articles`, `authors`, `perushim` and
`tanahpedia-entity-refs`, and content pages are pre-rendered. A content
change therefore becomes public only when the admin app calls
`POST /api/revalidate` on the website after its DB commit:

- `?tag=<tag>` expires a cache tag with `{ expire: 0 }` so the next request
  re-renders instead of being served stale output.
- `?path=<route>` invalidates a prerendered route; dynamic route patterns
  (e.g. `/pedia/[slug]`) also take `&type=page`.
- `&url=<path>` (repeatable) names a changed public URL
  (e.g. `/929/5/12`, `/pedia/משה`) for the IndexNow notification described
  below. A call carrying only `url` params performs no invalidation — that
  is the operator path for bulk/data changes made outside the admin
  mutations.
- In production the call must carry the `x-revalidate-secret: <REVALIDATE_SECRET>`
  header; `?secret=` is still accepted for operator calls. An unset
  secret rejects every call.

The admin side lives in `web/admin/src/server/website-revalidate.ts`
(`VITE_WEBSITE_URL` + server-only `REVALIDATE_SECRET`; both unset = no-op for
tests/tooling). Covered mutations: article and author CRUD, Tanahpedia
entry CRUD and entity links, entry-revision approval/restore, and entity /
person / place / family structural edits. Each mutation reports the exact
public URLs it changed — including the old URL after a rename/move and the
removed URL after a delete — so notification covers stale URLs too.
Article, author and Tanahpedia entry changes also expire the prerendered
`/sitemap.xml`, which lists those entities from uncached DB reads and would
otherwise keep build-time URLs until the next deploy.

**Limits**: invalidation is local to the website instance that receives the
call — the service normally runs a single task (`DesiredCount: 1`), but
during a rolling deploy a second task serves briefly and can hold stale
content until the next invalidation or task replacement. A failed call never
fails the save but is logged, recorded, and shown as a warning banner in the
admin UI until a later invalidation succeeds; the stale entry persists until
then or until an operator `POST`s `/api/revalidate` directly.

## IndexNow (Search-Engine Notification)

`src/lib/seo/indexnow.ts` notifies participating search engines (Bing & co)
that public URLs changed, so they recrawl fresh content sooner. It is wired
into the freshness lifecycle: `POST /api/revalidate` collects the reported
`url` params (plus a literal `path`), and submits them to
`https://api.indexnow.org/indexnow` inside the `after` hook — only after
invalidation succeeded, and after the response has gone out, so delivery
never delays or fails the admin request.

- **Key**: `INDEXNOW_KEY` (server-only env, SSM `bible-on-site-indexnow-key`
  on the website task). Unset or non-conforming (protocol requires 8–128
  `[a-zA-Z0-9-]` chars) = the whole feature is a documented no-op. The
  ownership proof `/<key>.txt` (body: the bare key) is served by
  `src/proxy.ts` on whichever host the request arrives at.
- **Canonical host**: submissions always use `SITE_ORIGIN`
  (`xn--febl3a.co.il`). `.com` pages canonicalize to `.co.il`, so `.com`
  URLs are never advertised as independently indexable copies.
- **Collection**: query/fragment are stripped for clean URLs; dynamic
  patterns like `/pedia/[slug]` are dropped (they cannot be enumerated).
  Dependents are added: the perek page for an article URL, `/929/authors`
  for an author, `/pedia` for an entry, and `/sitemap.xml` whenever any
  content URL is submitted.
- **Delivery**: at most 10,000 URLs per POST (protocol limit). A failed
  POST is logged, never thrown; the undelivered URLs stay in a per-instance
  pending set and are merged into the next submission, so delivery
  recovers on the next publication event or an operator call.
- **Verification**: submitting is not proof Bing received the URLs —
  confirm receipt in Bing Webmaster Tools as an operational follow-up.

## Web Push Notifications (Daily Perek Reminder)

Readers can opt in to a browser notification with the daily perek (#1096).

- **Opt-in UI**: `PushNotificationsToggle` in the app section of the home
  page. It registers `public/sw.js` only when the reader opts in, asks for
  notification permission, subscribes with the VAPID public key and stores
  the subscription. Unchecking deletes it on the server and unsubscribes the
  browser. Unsupported browsers get an accurate "not supported" state —
  including iPhone/iPad ordinary tabs, where Web Push is limited to
  installed web apps and the product decision is no installation funnel
  (#2936). Blocked permission is explained instead of re-prompting.
- **Storage**: `tanah_web_push_subscription`
  (`data/mysql/tanah_web_push_upgrade.sql`, data-deploy manifest), keyed by
  the sha256 of the endpoint. A row is the opt-in, and there is no other
  personal data. The website DB user needs `INSERT`/`DELETE`/`SELECT` on it.
- **API**: `GET /api/push/subscription` returns the public key (`null` while
  push is unconfigured, which hides the UI; 200 so pages log no console
  error), `POST` stores a
  `PushSubscription.toJSON()` body, `DELETE {endpoint}` removes it. Only
  endpoints on known browser push services (FCM, Mozilla, WNS, Apple) are
  accepted, so the sender never POSTs to arbitrary URLs.
- **Trigger**: `.github/workflows/web-push-daily.yml` calls
  `POST /api/push/daily` at 05:00 UTC Sunday-Friday with
  `Authorization: Bearer $PUSH_SEND_SECRET`. The route resolves the day with
  the shared learning schedule and sends only on study days (never on
  Shabbat or review days). An optional body `{"endpoint": "<url>"}`
  restricts the send to that one subscription for the controlled delivery
  check. Payloads link to `/929/<perekId>`, use topic `daily-perek` (an
  undelivered reminder is replaced, not stacked) and a 12-hour TTL.
  Subscriptions the push service reports as gone (404/410) are deleted.
- **Service worker**: `public/sw.js` only renders pushes (RTL Hebrew) and
  focuses or opens the linked page on click, same-origin only. It has no
  fetch handler, so it never affects loading or caching.
- **Configuration** (server-only env on the website task):
  `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`
  (`mailto:` or site URL) and `PUSH_SEND_SECRET`. Generate the key pair with
  `bunx web-push generate-vapid-keys`. Any unset value turns the feature off.
  In production the three values that need secrecy ship as ECS `Secrets:`
  from the SSM parameters `bible-on-site-vapid-public-key`,
  `bible-on-site-vapid-private-key` and `bible-on-site-push-send-secret`,
  while `VAPID_SUBJECT` is a plain task environment entry
  (`docs/aws/cloudformation/ecs-services.yaml`). The scheduled workflow runs
  only once the repository variable `WEB_PUSH_ENABLED` is `true` and the
  repository secret `PUSH_SEND_SECRET` matches the website's; a manual
  dispatch is ungated but requires a single-subscription `endpoint` input,
  so the controlled delivery check can run first and never broadcasts. The
  full ordered activation, verification and rollback are in
  `docs/aws/web-push-activation.md`.

## Database Configuration

Environment variables for database connection (supports both formats):

### Connection URL (Recommended)

| Variable | Example | Description |
|----------|---------|-------------|
| `DB_URL` | `mysql://root:pass@localhost:3306/tanah` | Full connection URL |

### Individual Variables (Fallback)

| Variable | Default | Description |
|----------|---------|-------------|
| `DB_HOST` | `127.0.0.1` | MySQL server hostname |
| `DB_PORT` | `3306` | MySQL server port |
| `DB_USER` | `root` | Database user |
| `DB_PASSWORD` | (empty) | Database password |
| `DB_NAME` | `tanah` | Database name |

For local development, copy `web/api/.dev.env` to `web/bible-on-site/.env.local`.

## PDF Generation (Bulletin Integration)

The website offers a "Download" feature on each Perek page that generates a printable PDF bulletin. In development, the Rust `web/bulletin` binary is invoked as a subprocess. In production (ECS), the website invokes the `bible-on-site-bulletin` Lambda directly via the AWS SDK (`@aws-sdk/client-lambda`).

```
User clicks "Download" → Server Action (actions.ts)
  → bulletin-client.ts
    ├─ Dev:  spawn local Rust binary (execFileSync)
    └─ Prod: AWS SDK InvokeCommand → bible-on-site-bulletin Lambda
                                        → returns base64-encoded PDF
```

**Why AWS SDK instead of HTTP?** Lambda Function URLs are not supported in `il-central-1`. The ECS task role (`bible-on-site-website-task-role`) grants `lambda:InvokeFunction` permission, and the `BULLETIN_LAMBDA_NAME` environment variable tells the website which Lambda to invoke.

## Server Event-Loop Diagnostics (#2991)

`src/instrumentation.ts` can start a bounded, per-process diagnostic that
explains stalls the minute-scale ECS metrics cannot see (for example a
`/api/health` upstream wait where the handler itself ran instantly). It is
**disabled by default and fully inert when disabled**: nothing is constructed,
no timers or observers exist, and there is no public endpoint — output is a
single JSON line per interval on stdout, visible only in the container logs.

| Variable | Default | Description |
|----------|---------|-------------|
| `ENABLE_EVENT_LOOP_DIAGNOSTICS` | unset (off) | `1` enables emission; any other value keeps it inert |
| `EVENT_LOOP_DIAGNOSTICS_INTERVAL_MS` | `60000` | Summary interval; clamped to 1000–900000 ms |

Emissions align to UTC wall-clock boundaries so `intervalStart`/`intervalEnd`
correlate directly with nginx upstream logs. Each line carries `version`
(package version), `uptimeSeconds`, `eventLoopDelay` (sample count plus
min/mean/max/p50/p90/p95/p99 in ms, sampled once per event-loop iteration so
queueing delay ahead of a request handler is recorded), `eventLoopUtilization`
(idle/active ms and the delta ratio), `cpu` (user/system ms deltas) and `gc`
(count, total/max ms, per-kind counts). Accumulators reset every interval; the
timer is unref'd so drain behavior is unchanged. Enabling in production is a
separate deployment decision — the instrumentation PR does not turn it on.

Local verification against the real compiled server:

```bash
bun run build                      # produces .next/standalone via postbuild
cd .next/standalone
# --import the helper by absolute file URL, so it resolves from this cwd
NODE_OPTIONS="--import <absolute-file-url-to scripts/test-support/block-event-loop.mjs>" \
BLOCK_EVENT_LOOP_AFTER_MS=8000 BLOCK_EVENT_LOOP_MS=3000 \
ENABLE_EVENT_LOOP_DIAGNOSTICS=1 EVENT_LOOP_DIAGNOSTICS_INTERVAL_MS=5000 \
node server.js
```

The 3 s block lands inside one 5 s interval: its `eventLoopDelay.maxMs` shows
~3000 while a health request queued during the block still returns instantly
once the loop turns, reproducing the production signature. An interval without
the block shows only baseline delay — the asynchronous-wait control.

## Layers

### Presentation Layer
- **Next.js App Router**: File-based routing with React Server Components
- **React Components**: Server and client components for UI rendering
- **CSS Modules**: Scoped styling for components

### Data Access Layer
- **Static Data**: JSON files imported at build time (sefarim, cycles)
- **MySQL Client**: `mysql2` library for direct database queries
- **Services**: Type-safe data fetching functions (`getArticlesByPerekId`)
- **Bulletin Client**: Invokes bulletin Lambda via AWS SDK for PDF generation

## Related Documentation

- [API Architecture](../api/api.md) - Backend API for mobile app
- [App Architecture](../app/app.md) - Mobile application
- [Repository Structure](../repo-structure.md) - Overall project structure
