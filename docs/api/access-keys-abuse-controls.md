# Public API Defense: Access Keys and Abuse Controls

Research record for [#3066](https://github.com/bible-on-site/bible-on-site/issues/3066).
Scope: how the public GraphQL API (`api.תנך.com` / `api.תנך.co.il`, port 443 →
ECS `api:3003`) is consumed today, what it must defend against, and which
access-key / abuse-control options fit — **without ever requiring native-app
users to sign in, register, pay, or hold a personal key**, and without breaking
already-installed app releases on Android, iOS, Mac Catalyst and Windows.
Compatibility contract, reconciled with the Phase 2 cutoff below: anonymous
reads stay free and keyless, but only for *current* builds — releases
predating the signing key get a bounded ~2-week grace window to update through
the stores, after which unsigned calls are rejected. "Don't break installed
apps" means every shipped release keeps a working update path (stores +
env-reversible enforcement flag), not indefinite API access for builds that
never upgrade.

Inspected: `master` at `ab4fe9cc6` (supersedes the issue baseline `70d08d6d`;
behavior noted below is from the newer tree unless marked otherwise).
Revised 2026-11-08 (PR review): the embedded signing-key design proposed in
review (option C2 below) was evaluated against `master` `1fe2ef272`; the
packaging, auth and client claims were re-verified in code
(`app-package.yml`, `app/devops/Build.Package.cs`, `AppConfig.cs`,
`BaseGraphQLService.cs`, `web/api/src/common/auth.rs`,
`web/api/src/startup/`).
Revised again 2026-11-08 (PR review): per review decision, unsigned API calls
are **not** a permanent lane — they get a bounded grace period (~2 weeks, until
client adoption completes) after signed builds ship, then are rejected. The
unsigned lane is a rollout stage, not a forever lane.
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

**Build-time secret injection already exists for this app.** CI secrets are
compiled into every native package and never stored in the repo:
`MAPBOX_PUBLIC_TOKEN` flows through `app-package.yml` env →
`PackagePrepare` → `WriteMapboxTokenFile()` (`app/devops/Build.Package.cs`)
into the gitignored `Resources/Raw/mapbox-token.txt`, read at runtime by
`AppConfig`; `api-config.txt` uses the same channel for the API URL override.
An API signing key would reuse this exact path — this is what makes the C2
design below cheap to try.

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
| Credential leak of a future app key | Extractable by definition (RFC 8252 §8.5) — and concretely so in this app: Android Release embeds the .NET IL assemblies (`EmbedAssembliesIntoApk` + IL deliberately kept for JIT fallback, `BibleOnSite.csproj`) and the `Resources/Raw` asset is plaintext inside the APK/.app/MSIX; iOS AOT raises the effort but the runtime must still read the file. Any embedded key is effectively public on release | Structural |
| Direct origin bypass (task public IP) | SG says VPC-only; must verify live SG | Guardrail check |
| Forced-upgrade risk of any auth rollout | No version floor exists; old builds break if gated | **Accepted as a bounded window** — review decision: unsigned calls get a ~2-week grace period after signed builds ship, then are rejected; old builds must update through the stores. The gate stays env-reversible so a bad cutoff rolls back to observe mode. |

## 4. Options evaluated

| Option | What it actually buys | Why / why not for us |
| --- | --- | --- |
| **A. Query/resource budgets** (schema depth+complexity limits, alias control, introspection off, body cap, timeout, resolver-cost awareness) | Converts "unbounded work per request" into a hard ceiling; kills the cheapest DoS vectors with **zero client changes** | **Adopt first.** async-graphql `Schema::build().limit_depth(d).limit_complexity(c)`; pick ceilings from the app's real queries (measure, then set e.g. depth ~8–10, complexity a few hundred). Disable introspection behind `PROFILE=prod` (land via/alongside #3065). Bound execution with `tokio::time::timeout` around `schema.execute` in `graphql_request` (or a request timeout middleware) — `HttpServer::keep_alive` only bounds idle connections and does not cap resolver duration. |
| **B. Edge rate limiting on api.* NGINX blocks** | Per-IP + global request ceilings independent of query cost; absorbs startup bursts gracefully if thresholds are right | **Adopt early, observe-first.** Mirror the website pattern: `limit_req_zone $remote_addr` (per-IP) + a global zone, `burst` sized for app cold-start bursts (`starter` + perek prefetch), `limit_req_status 429`. Start generous and log-driven; mobile carrier-NAT means per-IP must be lenient. No code change in app or API. |
| **C. Static shared app key sent as a header (unsigned bearer)** | A public client identifier; coarse partitioning; a tiny hurdle for the laziest curl | **Do not adopt as a control.** Extractable/replayable and binds nothing to the request — strictly weaker than its signed variant (C2). Optional later as a low-value telemetry header (`x-app-channel`) — never a quota or authorization boundary. |
| **C2. Build-time-injected request-signing key (HMAC)** — a key held in CI secrets (never in the repo), compiled into each native build; the app uses it to *sign* requests; the API verifies the signature server-side | Cohort identification ("this request carries a valid signature from key-id X"), request-integrity binding (signature covers method + path + body hash), a bounded replay window (timestamp, optionally nonce), per-cohort revocation (drop a leaked key-id to the unsigned lane — anonymous during grace, rejected after), and *differential* treatment (the signed lane can earn more headroom) — all with zero user accounts and no issuance protocol | **Conditionally adopt — the cheapest client-facing credential available, but it is obscurity plus policy, not a security boundary.** The key is extractable from every shipped package (§3); once extracted it signs anything — it proves *key possession*, not an unmodified app, and does nothing to bound per-request work (A stays mandatory). TLS already covers wire integrity; signing's real value is that the API can distinguish known-build traffic from anonymous curl and can revoke a cohort's *privileges*. The injection path already exists (packaged `Resources/Raw` secret, §1); verification is one actix middleware + `hmac`/`sha2` crates; the client side is one `DelegatingHandler` at the single `GraphQLHttpClient` construction — mechanics in §5.1. Works on all four platforms including sideloaded Android and Windows — no attestation gaps. **Adopt observe-first; enforcement is the planned end state — unsigned calls are rejected after the ~2-week grace window (see Decision).** |
| **D. Anonymous short-lived session tokens** (open issuance endpoint → signed token → metered reads) | Per-installation metering, expiry, revocation without user accounts | **Defer.** An open bootstrap is itself scriptable, so tokens meter honest clients more than they stop abusers; adds issuance/refresh/offline-retry complexity to every app release train. Revisit only if A+B insufficient. If built: opaque signed token (HMAC or JWT, `aud=api-read`, expiry ~hours), issuance itself rate-limited, renewal idempotent, never sent per-verse. |
| **E. Attestation (Play Integrity standard / App Attest) + session binding** | Best available evidence a call came from an unmodified store-installed app | **Defer, non-universal.** No Windows equivalent; Mac Catalyst support must be verified per distribution path; sideloaded/no-Play-account Android users get weak/no verdicts — and we committed to keep them reading. So attested lane can only ever be a *preferred* lane, with a bounded anonymous read lane during any grace window — which means budgets (A) must exist anyway. Prototype only if abuse persists after A+B; server must verify challenge, nonce/requestHash, package+signature, freshness, and treat "unsupported/outage" ≠ "tampered". |
| **F. Persisted-operation allowlist / known-operation manifest** | Anonymous traffic constrained to the ~17 known read operations; arbitrary introspection/crafted queries rejected | **Defer; strongest of the deferred options.** App already sends `operationName`; a versioned manifest of allowed operations × per-app-version gives real work reduction. Costs: manifest maintenance across all shipped versions + docs/tooling queries. `operationName` alone is not an allowlist — must bind to stored query documents (hash or exact text). Revisit if scraping via arbitrary queries becomes the residual problem after A. |
| **G. Gateway/WAF (API Gateway, CloudFront+WAF, Cloudflare)** | Managed quotas, bot rules, DDoS absorption | **Not now.** Architecture is EC2-NGINX→ECS by design; AWS usage-plan keys are explicitly *not* authentication and quotas are best-effort. A CDN could help if B proves insufficient, but adds a new hop, TLS/cert and origin-lockdown work (origin must reject non-CDN traffic) plus per-request cost — needs Dorad's explicit approval before any AWS change. |
| **H. Keep anonymous public reads** (status quo access model) | Zero client impact during the grace window, permanent old-app lane | **Adopt as the base contract — time-boxed.** "Free native access" stays: no sign-in, registration, payment or per-user key. We harden the *work envelope* (A+B) and gate on build provenance (signature), not caller identity. Per review decision the *unsigned* lane is bounded: it serves old builds only until the ~2-week grace window closes, then unsigned calls are rejected — access stays free, it just has to come from a current build. |

### Decision

**Phase 0 (compatible, do now):** A + B + keep H. Establish query budgets in
the schema and observe-mode rate limits on the api NGINX blocks; #3065 removes
Playground/introspection-adjacent tooling independently. No client ships.

**Phase 1 (measure + first credential experiment):** dashboards on per-op
cost, 429s, top IPs/UAs. In parallel, land **C2 in observe mode**: package the
signing key, ship app builds that sign, and have the API verify-and-*count*
signed vs unsigned traffic — no enforcement yet. It is the lowest-cost
client-facing credential we have (proven packaging path, one handler + one
middleware, all platforms, backward-compatible while unsigned traffic stays
anonymous), and its telemetry answers the adoption question D/E would
otherwise have to bootstrap. If the data instead shows arbitrary-query
scraping as the residual problem, F outranks further credential work.

**Phase 2 (grace window → enforcement):** per review decision, unsigned calls
get a **~2-week grace period** after signed builds ship — the window for
store/dev-channel updates to reach the install base, tracked by the
signed-traffic share approaching ~100%. When the window closes,
`API_REQUIRE_SIGNATURE=enforce` rejects unsigned calls (401); old builds that
never upgraded lose API access — accepted, since stores propagate updates and
the gate stays env-reversible (rollback = observe mode, not a redeploy).
**External manager clients are exempt.** The Tanahpedia revision and
dedication bearer tokens are server-held credentials strictly stronger than
the extractable app signing key, and they already authenticate their own
scopes. Signature enforcement applies only to requests that would otherwise
be anonymous: the check honors a *valid* manager bearer first (the existing
fail-closed `ApiAuth` comparison), and only unsigned, uncredentialed calls
get 401 after the grace window. Manager clients need no signing migration and
keep working unchanged in both modes; an invalid or absent bearer never earns
the exemption.
Optional on top: differential treatment for the signed lane (e.g. higher
budgets for verified signatures — the signature informs limits, it never
bypasses them); or prototype D or E on Android+iOS with a bounded anonymous
lane during any future grace window; never a universal requirement. G only
with explicit approval.

**Never:** treat an embedded client key as confidential or as proof of an
unmodified app — it is extractable by design; let a signature satisfy
`authorize_revision_manager`/`authorize_dedication_manager` or reach any
admin/mutation scope; leave the unsigned lane open past the agreed grace
window (unsigned calls are rejected once adoption completes — the env flag,
not a permanent anonymous lane, is the rollback story); carry keys in URLs;
write key material or signatures to logs; use UA/Origin as authorization.

## 5. Reference designs for deferred client-facing options

### 5.1 Embedded signing lane (C2) — mechanics if adopted

- **Key material & injection.** The server holds verification keys as a
  `key-id → secret` map in env/SSM (one entry to start; N-1 overlap during
  rotation). The client copy is *not* a secret — assume it is public on
  release; for symmetric HMAC the server-side verification material is the
  same value, so a compromised build means rotating that `key-id`. Injection
  reuses the packaged-asset path proven by `mapbox-token.txt` (§1): a new
  GitHub secret (e.g. `APP_API_SIGNING_KEY`) → env on each `Package` step in
  `app-package.yml` → devops writes `Resources/Raw/api-signing-key.txt`
  (gitignored) → `AppConfig` reads it in `InitializeAsync`. DEBUG/dev builds
  package an empty file → unsigned → anonymous lane during the grace window;
  for local dev after enforcement, run the API in observe mode or sign with a
  dev `key-id` (an env override keeps local signing tests possible).
  Per-platform or per-release `key-id`s can be added later for finer cohort
  attribution.
- **Signature format.** Canonical string
  `v1\n<key-id>\n<METHOD>\n<path>\n<unix-timestamp>\n<nonce>\n<hex-sha256(body)>`,
  HMAC-SHA256, hex-encoded. Headers: `x-api-key-id`, `x-api-timestamp`,
  `x-api-nonce`, `x-api-signature`. Client: one `DelegatingHandler` via
  `GraphQLHttpClientOptions.HttpMessageHandler` at the single
  `GraphQLHttpClient` construction in `BaseGraphQLService` — it buffers the
  JSON body once to hash it; all ~18 operations are covered with zero
  call-site changes (the app sends queries only today). Server: verification
  needs the raw body, which the `GraphQLRequest` extractor consumes — implement
  as an actix middleware that buffers + verifies before the handler, or take
  `web::Bytes` in `graphql_request` and parse manually. Adds `hmac` + `sha2`
  crates (not currently dependencies); verification cost is microseconds —
  irrelevant on the 0.25-vCPU task. Keep verification out of NGINX: it cannot
  hash bodies cheaply; NGINX stays responsible for option B.
- **Freshness & replay.** Timestamp tolerance ±5 min to absorb device clock
  skew. Nonce cache: optional bounded TTL set keyed `(key-id, nonce)` — at
  current scale (single task, modest QPS) a few-thousand-entry map is
  negligible; if the service ever runs more than one task the cache needs
  shared state — or drop nonces. Honest trade-off: for public reads, replay
  inside the window ≈ re-query, which is low harm; the nonce mainly matters
  if the lane later gates costlier operations. Timestamp-only is an
  acceptable v1.
- **Verification outcome.** Missing/invalid/expired signature ⇒ **anonymous
  lane during the grace window, 401 after it** — unsigned traffic is
  legitimate only while old builds are still upgrading (pre-C2 releases, dev
  builds). `API_REQUIRE_SIGNATURE=observe|enforce` is the rollout control:
  observe counts signed vs unsigned; enforce — the planned end state once the
  ~2-week grace period closes — rejects unsigned calls. Enforce is
  env-reversible: rollback is a config change, not a redeploy. Requests with
  a valid `*_manager` bearer are exempt from this gate entirely (see Phase 2)
  — the signature requirement governs only the anonymous read lane.
- **Rotation & compromise response.** Rotate by shipping builds with a new
  `key-id` and adding it server-side; keep N-1 accepted during adoption, then
  retire. Compromise: remove the `key-id` server-side → affected builds fall
  to the unsigned lane — anonymous during grace, rejected after it, so they
  must ship a build carrying a valid `key-id`. This is the honest meaning of
  per-build revocation: a cohort's *signed status* is revocable, and after
  the grace window its *access* depends on holding any valid `key-id` — old
  apps cannot be force-updated, so revocation means forcing a re-ship.
- **Scope isolation.** A valid signature must never satisfy
  `authorize_revision_manager`/`authorize_dedication_manager` — the same
  fail-closed `ApiAuth` split as today (`api-sign` is its own scope). Signed
  requests get **no exemption** from A/B budgets: the signature informs
  limits, it never bypasses them.

### 5.2 Session tokens + attestation (D/E) — reference flow, not current plan

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
- AuthZ matrix unchanged: valid/invalid/missing bearer per scope — the current
  keys are static env secrets with no expiry, so expired-credential cases apply
  only to the deferred D/E token design; `api-read`-type credential must fail
  `*_manager` checks; anonymous fails mutations, `dedicationsAdmin`,
  `tanahpediaEntryRevisions`.
- Signature lane (if C2 lands): valid signature marks the signed lane;
  missing/invalid signature, wrong `key-id`, expired timestamp, tampered body
  and (if enabled) replayed nonce all degrade to anonymous — never 401 in
  observe mode; a **valid** signature still fails `*_manager` scopes;
  rotation overlap accepts N-1 then drops it to anonymous; unsigned → anonymous
  during the grace window and 401 under `API_REQUIRE_SIGNATURE=enforce` (the
  planned post-grace state) — both modes covered. Under `enforce`, requests
  carrying a valid `*_manager` bearer pass signature enforcement unmodified
  and reach their resolvers; a missing or invalid bearer does not earn the
  exemption (invalid bearer + no signature → 401, same as unsigned).
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
   traffic; keep an env/config kill switch per control. `build_schema` runs
   at server startup, so hardcoded schema limits can only change via a binary
   rebuild + redeploy — make them env-configurable so tightening/rollback is
   an env change + task restart; NGINX limits are config-reload — document
   both.
3. **Adoption gate → grace window → enforcement** — C2 lands observe-only
   first (app signs, API counts signed vs unsigned). Per review decision,
   unsigned calls then get a ~2-week grace period for client upgrades,
   verified by signed-traffic share; at the end of the window
   `API_REQUIRE_SIGNATURE=enforce` rejects unsigned calls (401). Old builds
   that never upgraded lose API access at cutoff — accepted; the flag stays
   env-reversible so rollback is observe mode. Manager-scope bearer clients
   (Tanahpedia revision, dedication) are exempt from signature enforcement in
   every stage — they authenticate under their own server-held keys. Optional
   on top: differential
   treatment for the signed lane (higher budgets for verified signatures —
   the signature informs limits, it never bypasses them).
4. **Rollback** — each control independently reversible: NGINX `reload`,
   env var for introspection/depth/signature-enforcement, no stored state to
   unwind.

## 8. Follow-up issues to file (not started here)

- **#3065** — immediate, independent: Playground/dev-route hardening.
- API query budgets (depth/complexity/introspection toggle + body cap +
  timeout) — D2, API.
- NGINX api-host rate limits (observe-first) — D2, AWS/devops; requires
  Dorad's approval before merge per #3066 §6 since it touches router config.
- Live-config verification: ECS SG :3003 ingress = VPC CIDR only;
  `client_max_body_size` effective value on api hosts.
- (Conditional) persisted-operations manifest; (conditional) anonymous
  session-token prototype; (conditional) attestation spike on Android/iOS;
  (conditional) C2 prototype — signing-key packaging + actix verification
  middleware + app `DelegatingHandler`, observe-only then
  `API_REQUIRE_SIGNATURE=enforce` after the ~2-week grace window (D2,
  app+API).
