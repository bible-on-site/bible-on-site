# Public API Defense: Access Keys and Abuse Controls

Research record for [#3066](https://github.com/bible-on-site/bible-on-site/issues/3066).
Scope: how the public GraphQL API (`api.תנך.com` / `api.תנך.co.il`, port 443 →
ECS `api:3003`) is consumed today, what it must defend against, and which
access-key / abuse-control options fit — **without ever requiring native-app
users to sign in, register, pay, or hold a personal key**, and without breaking
already-installed app releases on Android, iOS, Mac Catalyst and Windows.

Inspected: `master` at `ab4fe9cc6` (supersedes the issue baseline `70d08d6d`;
behavior noted below is from the newer tree unless marked otherwise).
Related issues: #3065 (immediate Playground removal + dev-route fail-closed —
do **not** gate it on this research), #3069 (admin-boundary cleanup — a
public-read credential must never authorize admin operations).

---

## 1. Consumer inventory

| Consumer | Transport today | Credentials today | Notes |
| --- | --- | --- | --- |
| Native app (Android / iOS / MacCatalyst / Windows) | HTTPS POST `/` GraphQL | **None.** `BaseGraphQLService` builds a shared `GraphQLHttpClient` with no auth headers and no identifying headers beyond the library default UA. `AppConfig.ApiUrl` → `https://api.xn--febl3a.com` | The only first-party GraphQL HTTP consumer. ~18 named operations (see below). Ships via stores + direct downloads; **no forced-update / min-version mechanism exists**, so every released build must keep working. |
| Website (`web/bible-on-site`, Next.js) | — | — | **Not a GraphQL consumer.** `src/lib/api-client.ts` is a direct MySQL (RDS) client; SSR/SSG never touches the GraphQL HTTP API. |
| Admin (`web/admin`, :3101) | own REST (`VITE_API_URL` → :3004 in dev) + direct MySQL | Cognito SSO | Not a GraphQL consumer either. |
| External AI clients (Tanahpedia) | HTTPS POST `/` GraphQL | `Authorization: Bearer $TANAHPEDIA_REVISION_API_KEY` (server-held, SSM `bible-on-site-tanahpedia-revision-api-key`) | `submitEntryRevision`, `applyEntryRevision`, family/alias mutations, `tanahpediaEntryRevisions` + family review queries. |
| Dedication management | HTTPS POST `/` GraphQL | `Authorization: Bearer $DEDICATION_API_KEY` | `createDedication`/`updateDedication`/`deleteDedication`, `dedicationsAdmin` read. |
| Website ↔ API revalidation | service-to-service | `REVALIDATE_SECRET` (`x-revalidate-secret`) | Shared secret already in place for a different lane — a working example of a server-held scoped key. |
| Anyone else | curl / bots / scrapers | none | Fully anonymous today, including introspection and (until #3065) Playground. |

### Named operations the app actually sends (allowlist candidates)

`GetStarter`, `ArticlesByPerekId`, `ArticleById`, `ArticlesByAuthorId`,
`SearchArticles`, `Dedications`, `SearchTanahpediaEntries`,
`TanahpediaCategoryCounts`, `TanahpediaCategoryHomepage`, `TanahpediaEntities`,
`TanahpediaEntries`, `TanahpediaEntry`, `TanahpediaPersonFamily`,
`TanahpediaPlaceMarkers`, `TanahpediaRecentEntries`,
`TanahpediaSynonymTargets`, `TanahpediaTodayEntities` — all queries, no
mutations. Pesukim/commentary ship bundled in the app (plus on-demand asset
packs from GitHub releases), so API traffic is articles, dedications and
Tanahpedia — but `starter` alone already returns all authors + article
headers + a 929-perek counter array, i.e. a large slice of the corpus in one
request.

## 2. Current controls (verified)

**Already good**

- Resolver-level authorization, **fail closed**: `ApiAuth::authorize_revision_manager`
  and `authorize_dedication_manager` compare a server-held env key against the
  bearer token in constant time; unset/empty env ⇒ every request rejected.
  Mutations and sensitive reads are already split across **two distinct
  scopes** (`TANAHPEDIA_REVISION_API_KEY`, `DEDICATION_API_KEY`) — the exact
  "server-held scoped key" pattern this issue asks us to keep.
- `GraphQLRequest` (the single-request extractor) rejects JSON-array batch
  bodies with 400 (`into_single()` fails on `BatchRequest::Batch`). Batching
  amplification is not currently exploitable — keep it that way.
- Resolver-local list bounds exist: `tanahpediaEntries` limit clamps ≤ 500,
  `tanahpediaRecentEntries` ≤ 50, `searchArticles` limit 1–50 / offset 0–1000 /
  phrase ≤ 256 chars.
- GraphQL-over-GET is not reachable: `GET /` routes to Playground, `POST /` is
  the only GraphQL guard. (The extractor *would* parse `?query=` on GET if it
  were ever routed there — a reason to keep the guard structure.)
- Single NGINX hop in front: `X-Real-IP` is set from `$remote_addr` and there
  is no forwarded-header trust chain to spoof. ECS SG template restricts
  :3003 ingress to the VPC CIDR (`172.31.0.0/16`), so tasks having public IPs
  (`AssignPublicIp: ENABLED` for ECR pulls) should not matter — **verify the
  live SG matches**, because the template notes the actual NGINX instance SG is
  `launch-wizard-1`, i.e. template ≠ necessarily live state.

**Missing / exploitable**

- **No schema-level resource limits.** `build_schema` does not set
  `limit_depth`, `limit_complexity`, or `disable_introspection`
  (async-graphql 7.2.1 supports all three). Anonymous introspection is on;
  arbitrary-depth nesting and **alias amplification**
  (`{ a1: starter{…} … a200: starter{…} }`) multiply DB work per request.
- **No rate limiting on the `api.*` NGINX server blocks.** The crawler
  `limit_req` zones (`ip_crawler` 10 r/m per IP, `global_crawler` 30 r/m) are
  applied only inside the website `location /` blocks — the two api `server {}`
  blocks have no `limit_req`/`limit_conn` at all. (Both api domains share the
  same backend, so controls must be defined per-server-block or duplicated.)
- **No body-size limit at the GraphQL layer.** The extractor reads JSON bodies
  with `read_to_end` and no cap; `MultipartOptions` bounds apply only to
  multipart uploads. Effective cap today is NGINX `client_max_body_size`
  (default 1 MB) — implicit, not deliberate.
- **No execution timeout / concurrency bound.** No `timeout` middleware, no
  `limit_conn`; a request runs until the DB finishes, on a single Fargate task
  at **0.25 vCPU / 512 MB, DesiredCount 1, no autoscaling target** (the
  website's min 1 / max 3 tracking does not cover the API).
- **Playground + introspection exposed on prod** (tracked by #3065).
- March 2026 incident history shows UA-based bot classification alone is
  insufficient at L7 (450+ IPs, ~300 req/min, Chrome UA, sitemap-Referer
  trick) — that was website traffic, but the api hosts have even fewer
  defenses.

## 3. Threat model

| Threat | Impact today | Realistic severity |
| --- | --- | --- |
| Corpus scraping (`starter`, `articlesByPerekId` ×929, `tanahpediaEntries` paging) | Content is public on the website anyway; scraping is cheap and unlimited but not catastrophic | Medium — bandwidth/CPU cost, no data loss |
| Compute DoS via alias amplification, deep nesting, `searchArticles` floods | Single 0.25-vCPU task; a few expensive queries can starve it | **High** — easiest kill vector |
| Connection/body floods | NGINX default 1 MB body cap is the only limit; no conn caps | High-ish, mitigated by TLS fronting |
| Brute-forcing the revision/dedication bearer keys | Constant-time compare, fail-closed, but **zero throttling** on attempts | Low probability / high impact |
| Credential leak of a future app key | Extractable by definition (RFC 8252 §8.5); must be treated as public | Structural |
| Direct origin bypass (task public IP) | SG says VPC-only; must verify live SG | Guardrail check |
| Forced-upgrade risk of any auth rollout | No version floor exists; old builds break permanently if gated | **Blocks any breaking design** |

## 4. Options evaluated

| Option | What it actually buys | Why / why not for us |
| --- | --- | --- |
| **A. Query/resource budgets** (schema depth+complexity limits, alias control, introspection off, body cap, timeout, resolver-cost awareness) | Converts "unbounded work per request" into a hard ceiling; kills the cheapest DoS vectors with **zero client changes** | **Adopt first.** async-graphql `Schema::build().limit_depth(d).limit_complexity(c)`; pick ceilings from the app's real queries (measure, then set e.g. depth ~8–10, complexity a few hundred). Disable introspection behind `PROFILE=prod` (land via/alongside #3065). Add `HttpServer::keep_alive`/request timeout middleware. |
| **B. Edge rate limiting on api.* NGINX blocks** | Per-IP + global request ceilings independent of query cost; absorbs startup bursts gracefully if thresholds are right | **Adopt early, observe-first.** Mirror the website pattern: `limit_req_zone $remote_addr` (per-IP) + a global zone, `burst` sized for app cold-start bursts (`starter` + perek prefetch), `limit_req_status 429`. Start generous and log-driven; mobile carrier-NAT means per-IP must be lenient. No code change in app or API. |
| **C. Static shared app key in the binary** | A public client identifier; coarse partitioning; a tiny hurdle for the laziest curl | **Do not adopt as a control.** Extractable/replayable; it authenticates a *distribution*, not a call. Optional later as a low-value telemetry header (`x-app-channel`) — never a quota or authorization boundary. |
| **D. Anonymous short-lived session tokens** (open issuance endpoint → signed token → metered reads) | Per-installation metering, expiry, revocation without user accounts | **Defer.** An open bootstrap is itself scriptable, so tokens meter honest clients more than they stop abusers; adds issuance/refresh/offline-retry complexity to every app release train. Revisit only if A+B insufficient. If built: opaque signed token (HMAC or JWT, `aud=api-read`, expiry ~hours), issuance itself rate-limited, renewal idempotent, never sent per-verse. |
| **E. Attestation (Play Integrity standard / App Attest) + session binding** | Best available evidence a call came from an unmodified store-installed app | **Defer, non-universal.** No Windows equivalent; Mac Catalyst support must be verified per distribution path; sideloaded/no-Play-account Android users get weak/no verdicts — and we committed to keep them reading. So attested lane can only ever be a *preferred* lane, with a permanent bounded anonymous read lane — which means budgets (A) must exist anyway. Prototype only if abuse persists after A+B; server must verify challenge, nonce/requestHash, package+signature, freshness, and treat "unsupported/outage" ≠ "tampered". |
| **F. Persisted-operation allowlist / known-operation manifest** | Anonymous traffic constrained to the ~17 known read operations; arbitrary introspection/crafted queries rejected | **Defer; strongest of the deferred options.** App already sends `operationName`; a versioned manifest of allowed operations × per-app-version gives real work reduction. Costs: manifest maintenance across all shipped versions + docs/tooling queries. `operationName` alone is not an allowlist — must bind to stored query documents (hash or exact text). Revisit if scraping via arbitrary queries becomes the residual problem after A. |
| **G. Gateway/WAF (API Gateway, CloudFront+WAF, Cloudflare)** | Managed quotas, bot rules, DDoS absorption | **Not now.** Architecture is EC2-NGINX→ECS by design; AWS usage-plan keys are explicitly *not* authentication and quotas are best-effort. A CDN could help if B proves insufficient, but adds a new hop, TLS/cert and origin-lockdown work (origin must reject non-CDN traffic) plus per-request cost — needs Dorad's explicit approval before any AWS change. |
| **H. Keep anonymous public reads** (status quo access model) | Zero client impact, permanent old-app lane | **Adopt as the base contract.** "Free native access" stays; we harden the *work envelope* (A+B), not the caller identity. |

### Decision

**Phase 0 (compatible, do now):** A + B + keep H. Establish query budgets in
the schema and observe-mode rate limits on the api NGINX blocks; #3065 removes
Playground/introspection-adjacent tooling independently. No client ships.

**Phase 1 (measure):** dashboards on per-op cost, 429s, top IPs/UAs; decide
whether residual abuse justifies F (persisted-ops manifest) or D.

**Phase 2 (only if evidence demands):** prototype D or E on Android+iOS with a
permanent anonymous read lane; never a universal requirement. G only with
explicit approval.

**Never:** a shared secret in the app binary as an enforcement gate; a native
credential that can reach admin/mutation scope; URL-carried keys; UA/Origin as
authorization.

## 5. Request flow if D/E is ever built (reference design, not current plan)

1. App start → `POST /session` (open, rate-limited per IP+device-claim) returns
   a short-lived signed `api-read` token bound to a random per-install
   keypair generated on-device.
2. Supported platforms additionally bind attestation: Play Integrity
   `requestHash` = hash(session-challenge); App Attest assertion over the
   session nonce. Server verifies verdict, package/signature, freshness.
3. Reads carry the token; expiry ~hours; silent renewal before expiry; a
   failed renewal falls back to the **anonymous bounded lane**, not to lockout.
4. Token verification is audience+scope checked at the resolver layer exactly
   like `ApiAuth` today — `api-read` can never satisfy
   `authorize_revision_manager`/`authorize_dedication_manager`.
5. Revocation: server-side denylist by token id; rotation by re-issuance.

## 6. Non-production proof & test matrix

- Schema budgets: over-depth, over-complexity, alias fan-out, introspection
  on/off by `PROFILE`, oversized JSON body (MultipartOptions vs JSON path —
  remember `read_to_end` ignores `max_file_size`), array batch still 400.
- AuthZ matrix unchanged: valid/invalid/expired bearer per scope; `api-read`-type
  credential must fail `*_manager` checks; anonymous fails mutations,
  `dedicationsAdmin`, `tanahpediaEntryRevisions`.
- Compatibility: app client without new headers works; both api domains; HEAD/GET
  `/health` + `/health/ready` unchanged; compression unchanged.
- NGINX (staging): burst tolerance ≥ app cold-start pattern; shared-NAT
  fairness (several "devices" behind one IP); spoofed `X-Forwarded-For` must
  not shift keys (`$remote_addr` only); 429 body/headers contract for the app
  (retry/backoff — app already tolerates GraphQL errors as exceptions, verify
  UX degradation is graceful).
- Load boundary (staging only, no prod attack test): `starter` × N/s baseline
  vs post-budget behavior; `searchArticles` flood.
- If D/E prototype exists: missing/wrong/expired/replayed token; wrong
  audience; attestation outage (mock verdict service down) → bounded
  anonymous lane, not lockout; simulator/dev-build path; sideloaded-device
  verdict mapping.

## 7. Rollout stages

1. **Observe** — land budgets at generous values + NGINX zones in log-only
   (or very high limits); emit redacted metrics (op name hash, cost bucket,
   429 counts — never tokens/bodies in logs).
2. **Tighten** — lower limits to ~95–99th percentile of observed legitimate
   traffic; keep an env/config kill switch per control (schema limits are
   build-time, NGINX limits are config-reload — document both).
3. **Adoption gate for anything client-facing** — only if a later phase adds
   headers/tokens: ship app support first, monitor adoption; enforcement
   requires a separate product decision and must never strand old builds
   (anonymous lane persists forever by design).
4. **Rollback** — each control independently reversible: NGINX `reload`,
   env var for introspection/depth, no stored state to unwind.

## 8. Follow-up issues to file (not started here)

- **#3065** — immediate, independent: Playground/dev-route hardening.
- API query budgets (depth/complexity/introspection toggle + body cap +
  timeout) — D2, API.
- NGINX api-host rate limits (observe-first) — D2, AWS/devops; requires
  Dorad's approval before merge per #3066 §6 since it touches router config.
- Live-config verification: ECS SG :3003 ingress = VPC CIDR only;
  `client_max_body_size` effective value on api hosts.
- (Conditional) persisted-operations manifest; (conditional) anonymous
  session-token prototype; (conditional) attestation spike on Android/iOS.
