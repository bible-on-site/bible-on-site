# API Access Locking: App Request Signing

Decision record for [#3066](https://github.com/bible-on-site/bible-on-site/issues/3066).

**Owner-approved scope (supersedes all earlier abuse-control content in this
document):** global API access locking only — a key held outside the
repository, compiled into the native apps, used to sign requests and verified
by the API. Dorad's review on #3119: *"a Hacker can always find their way but
we are at least reducing the obvious and cheap way"* and *"we don't need to
rate limit anyone"*. Approximately **two weeks of upgrade grace** for
unsigned calls after signed builds ship, then **no unsigned API calls at
all — including reads — except callers presenting a valid authenticated
credential** (today: the server-held manager API keys; user sign-in tokens
join the same lane if a verifiable credential ever reaches the API).

Explicitly outside this issue: rate limiting, quotas, per-IP/per-client
limits, NGINX `limit_req`/`limit_conn`, GraphQL depth/complexity/alias caps,
body-size caps, execution-time or concurrency budgets, query-cost or
pagination restrictions, and a persisted-operation allowlist as a substitute
for the access gate. Options evaluated during research are summarized in §7
with their disposition; they are **not** this issue's deliverable.

Related: #3065 (Playground/dev-route hardening — independent, do not gate),
#3069 (admin authorization boundary — a public-read credential must never
authorize admin operations), #3257 (open public-corpus policy — see §6).

---

## 1. Consumer inventory

| Consumer | Transport today | Credential today | Lane under the gate |
| --- | --- | --- | --- |
| Native app (Android / iOS / MacCatalyst / Windows) | HTTPS `POST /` GraphQL | **None.** `BaseGraphQLService` builds one `GraphQLHttpClient` with no auth or identifying headers. `AppConfig.ApiUrl` → `https://api.xn--febl3a.com` | **Signed** — the gate's reason to exist |
| Website (`web/bible-on-site`) | — | — | Not a GraphQL consumer (`api-client.ts` is direct MySQL) — nothing to sign |
| Admin (`web/admin`, :3101) | own REST + direct MySQL | Cognito SSO | Not a GraphQL consumer |
| Tanahpedia revision / dedication / article-relationship clients | HTTPS `POST /` GraphQL | `Authorization: Bearer` with the server-held `TANAHPEDIA_REVISION_API_KEY`, `DEDICATION_API_KEY`, `ARTICLE_API_KEY` | **Authenticated** — passes unsigned |
| `REVALIDATE_SECRET` revalidation | service-to-service | `x-revalidate-secret` | Different surface entirely (website lane) |
| Everyone else (curl, bots, scrapers) | `POST /` | none | **Unsigned** — observed during grace, 401 after |

### Operations the app sends

~18 named queries (`GetStarter`, `ArticlesByPerekId`, `ArticleById`,
`ArticlesByAuthorId`, `SearchArticles`, `Dedications`,
`SearchTanahpediaEntries`, `TanahpediaCategoryCounts`,
`TanahpediaCategoryHomepage`, `TanahpediaEntities`, `TanahpediaEntries`,
`TanahpediaEntry`, `TanahpediaPersonFamily`, `TanahpediaPlaceMarkers`,
`TanahpediaRecentEntries`, `TanahpediaSynonymTargets`,
`TanahpediaTodayEntities`) — all queries, no mutations. The signing handler
sits below them: it signs whatever `GraphQLHttpClient` sends, so every
operation is covered with zero call-site changes.

**Build-time secret injection already exists for this app.** CI secrets are
compiled into every native package and never stored in the repo:
`MAPBOX_PUBLIC_TOKEN` flows through `app-package.yml` env →
`PackagePrepare` → `WriteMapboxTokenFile()` (`app/devops/Build.Package.cs`)
into the gitignored `Resources/Raw/mapbox-token.txt`, read at runtime by
`AppConfig`. The signing credential uses the same channel
(`api-signing-key.txt`) — see §3.1. The CI/workflow half of that injection is
a separate follow-up that touches the packaging workflow and therefore needs
Dorad's approval per the issue's rollout clause.

## 2. The access contract

Three lanes, evaluated in order on every `POST /` request:

| # | Lane | Rule | Result |
| --- | --- | --- | --- |
| 1 | **Authenticated** | `Authorization: Bearer` matches a configured manager key (`TANAHPEDIA_REVISION_API_KEY`, `DEDICATION_API_KEY`, `ARTICLE_API_KEY`) — the existing fail-closed, constant-time `ApiAuth` check | Passes unsigned in every mode |
| 2 | **Signed** | All four `x-api-*` headers present, known key-id, timestamp within ±tolerance, valid HMAC-SHA256 over the canonical request, nonce not replayed | Passes |
| 3 | **Unsigned** | Anything else: no headers, partial/malformed headers, unknown key-id, stale timestamp, wrong signature, replayed nonce | `observe`: passes, logged with a reason code. `enforce`: **401** `{"errors":[{"message":"unsigned or invalid API request"}]}` |

- An *invalid* bearer earns no exemption — invalid bearer + unsigned is
  rejected under `enforce`. A *valid* signature passes even alongside a bad
  bearer (lane 2 still holds; `ApiAuth` for resolvers sees the same headers).
- Health and readiness (`/health`, `/health/ready`) are **not** gated —
  ECS/alb probes and local tooling must keep working without credentials.
  Dev-profile tooling (Playground `GET /`, `/api/shutdown`) is likewise
  outside the gate; under `enforce` a developer who wants signed traffic
  runs the API locally with a dev key or signs from the app.
- `GET /` carries no GraphQL traffic (Playground is dev-only) — the gate
  wraps the `POST /` resource only.

## 3. Signing design

### 3.1 Key material and packaging

- **Format.** `key-id:secret` (split at the first colon). One env value,
  `API_SIGNING_KEYS`, holds comma-separated pairs server-side — multiple
  entries are how rotation accepts N-1 during adoption. The app packages the
  same `key-id:secret` string as `Resources/Raw/api-signing-key.txt`
  (gitignored, CI-injected — exact analog of `mapbox-token.txt`) or reads
  the `API_SIGNING_KEY` env override for local signing tests.
- **Outside source control.** The secret lives in CI secrets/SSM only —
  never in this repository. Packaging writes it into the app bundle at
  build time; verification keys are delivered through deployment config.
- **Honest claim.** The client copy of the key is extractable (RFC 8252
  §8.5): Android Release ships managed IL (`EmbedAssembliesIntoApk`,
  R8 keeps it inspectable) plus a plaintext `Resources/Raw` asset; iOS/Catalyst/Windows
  are the same order of effort. The signature is a **hurdle that removes
  anonymous curl access and identifies build cohorts** — not proof of an
  untampered app, and not a per-user credential.
- **Redaction.** The API logs only the verdict and the key-id cohort —
  never the secret, signature, nonce or body.

### 3.2 Wire format

Canonical string, `\n`-joined:

```text
v1
<key-id>
<METHOD>
<path>
<unix-timestamp>
<nonce>
<lowercase-hex-sha256(body)>
```

Signature = lowercase-hex `HMAC-SHA256(secret, canonical)`. Headers:
`x-api-key-id`, `x-api-timestamp`, `x-api-nonce`, `x-api-signature`.
`v1` reserves a format bump. `METHOD`/`path` are signed for defense in
depth (the gate sits on `POST /` only anyway); the query string is outside
the contract — GraphQL-over-GET is unreachable on this API.

### 3.3 Verification (API side)

`web/api/src/startup/access_gate.rs` (a `from_fn` actix middleware on the
`POST /` resource) + `web/api/src/common/signing.rs` (pure primitives):

1. Header phase first — authenticated bearer, then "any headers?", "all
   headers valid?", "known key-id?", "fresh timestamp?" — so unsigned and
   unverifiable requests never pay for body buffering.
2. Body phase (candidates only): buffer the request body, hash it, verify
   HMAC in constant time, then record the nonce. The buffered bytes are
   re-injected as the request payload, so the `GraphQLRequest` extractor
   contract (JSON parse, batch rejection, error mapping) is unchanged.
   Buffering is bounded by the existing NGINX edge body cap it mirrors
   (~1 MiB) — not a new size policy; an unverifiable oversized body is a
   413, not a silent pass.
3. **Freshness/replay.** `API_SIGNATURE_TOLERANCE_SECS` (default 300)
   bounds clock skew; a bounded in-process nonce cache (65 536 entries,
   TTL = 2×tolerance, oldest-first eviction) rejects replays inside the
   acceptance window. Nonces are recorded **only for valid signatures**, so
   an attacker cannot burn a victim's nonce to deny their request.
4. **Verification is cheap** (one SHA-256 + one HMAC per request) — trivial
   on the 0.25-vCPU task; body hashing stays out of NGINX, which cannot do
   it anyway.

### 3.4 Rotation and revocation

- **Rotation:** add `k2:…` to `API_SIGNING_KEYS` and ship builds carrying
  `k2`; both cohorts verify during overlap; remove `k1` once adoption
  settles. Per-release or per-platform key-ids give finer cohort
  attribution when needed.
- **Revocation (compromise):** remove the leaked key-id → that cohort's
  calls become unsigned → observed during grace / rejected under enforce.
  Honest consequence: since no forced-update mechanism exists, revoking a
  key forces affected builds back onto the unsigned lane — i.e., it
  effectively demands a re-ship, same as any leaked packaged secret.
- **Rollback of the gate itself:** `API_REQUIRE_SIGNATURE=observe` is an
  env change + task restart — no redeploy of code.

### 3.5 Scope isolation

Passing the gate grants **read access only** — it changes nothing about
resolver authorization. A valid app signature does **not** satisfy
`authorize_revision_manager`, `authorize_dedication_manager` or
`authorize_article_manager` (they check the bearer against their own
server-held keys; the signature is not a bearer). The gate's authenticated
lane is a *recognition* of existing credentials, not a new scope. A signed
request attempting a privileged mutation still fails exactly like an
unsigned one.

## 4. Platform and installed-release coverage

All four platforms share one .NET `HttpMessageHandler` — no per-platform
crypto or attestation plumbing:

| Platform | Signing | Notes |
| --- | --- | --- |
| Android | `ApiSigningHandler` + packaged `api-signing-key.txt` | Store + sideloaded builds sign identically — no Play-services dependency |
| iOS | same | Same packaged-asset channel |
| Mac Catalyst | same | No attestation gap to manage |
| Windows | same | MSIX/direct builds covered |

- **Debug/dev builds** package an empty/absent key file → unsigned → they
  ride the grace lane while it exists, then need a dev key-id for local
  work (`API_SIGNING_KEY` env or a dev `API_SIGNING_KEYS` entry — never the
  production key in the repo or in dev `.env` files).
- **Installed-release inventory:** every shipped release lacks the signing
  handler, so the *entire* current install base is unsigned. There is no
  min-version/forced-update mechanism — the ~2-week grace window is the
  upgrade path, and the unsigned lane's residual population is accepted at
  cutoff (stores propagate updates; the env flag stays reversible).
- **User authentication:** the app has Firebase anonymous sign-in
  (Android/iOS, `FirebaseUserIdentity`) for preference sync, but no token
  reaches the API today, so there is nothing new to verify. If a verifiable
  user credential is ever sent, it joins lane 1 — the contract already
  reserves it.

## 5. Rollout

| Stage | State | Exit criteria |
| --- | --- | --- |
| 1. Observe | `API_REQUIRE_SIGNATURE=observe`, keys configured | Signed vs unsigned share visible in logs; signed fraction ≈100% of current-version traffic |
| 2. Grace (~2 weeks from signed builds reaching stores) | still `observe` | Signed share approaches ~100%; store rollout complete on all four platforms |
| 3. Enforce | `API_REQUIRE_SIGNATURE=enforce` | Unsigned → 401; old releases that never updated lose API access (accepted) |
| 4. Rollback | flip back to `observe` | Config change, no redeploy |

- **Adoption verification:** the gate logs a one-line structured verdict
  per request (`api_access_verdict=signed|unsigned|authenticated` +
  reason) — counting signed vs unsigned in logs is the adoption metric;
  no key material, signature, nonce or body is ever logged.
- **Production impact at enforce:** anonymous `POST /` calls that are not
  signed and not manager-authenticated get 401. `/health`, `/health/ready`
  unchanged. Response shape for rejects is a GraphQL-flavored
  `{"errors":[…]}` body, so clients that inspect errors see a normal
  failure rather than a transport exception.
- **Approval boundary:** observing needs no production change (the flag
  defaults to `observe`). Flipping `enforce`, changing deployed keys, and
  the packaging-workflow injection are production/workflow changes that
  require Dorad's explicit approval per the issue.

## 6. Public-content boundary (#3257)

#3257 keeps the public learning corpus freely accessible to people,
crawlers and agents. After `enforce`, **anonymous programmatic access to
the GraphQL API ends** — a crawler's `POST /` without a signature is 401.
The corpus itself remains open through the surfaces that actually serve it:

- the website (`api-client.ts` → MySQL directly — unaffected), public pages
  and sitemaps;
- bundled app content (pesukim/commentary ship inside the app and via
  GitHub-release asset packs, not through the API).

**Open boundary question to settle before the enforce flip:** the owner's
contract says unsigned calls are rejected *unless the caller is
authenticated*. If Dorad intends agents/crawlers to keep a programmatic
corpus lane on the API itself (rather than the website surfaces), that
needs an explicit decision — e.g. a documented public export, or a
distinct unsigned crawler lane — none of which this issue authorizes.
Until then the honest reading is: the GraphQL endpoint is app+authenticated
traffic; public corpus discovery is the website's job.

## 7. Options evaluated and set aside

The earlier revision of this document recommended defense-in-depth layers.
Per owner review they are **not** this issue's work; recorded here for
completeness.

| Option | Disposition |
| --- | --- |
| Query/resource budgets (depth/complexity caps, body caps, timeouts) | **Out of scope** per owner — "we don't need to rate limit anyone"; superseded by this issue's correction |
| NGINX rate limiting / `limit_req`/`limit_conn` on `api.*` | **Out of scope** — same review; also needs the workflow/infra approval path it doesn't have |
| Static unsigned app-key header | **Rejected** — strictly weaker than signing (identifies nothing, binds nothing) |
| **Embedded request-signing key (this design)** | **Adopted** — the owner-requested control; PoC in this PR |
| Anonymous session tokens | **Set aside** — an open issuance endpoint is itself scriptable; adds renewal machinery without blocking abuse |
| Attestation (Play Integrity / App Attest) | **Set aside** — no Windows equivalent, sideload gaps; revisit only if signature cohorts get abused at scale |
| Persisted-operation allowlist | **Set aside** — explicitly outside this issue |
| API Gateway / WAF / Cloudflare | **Rejected for now** — new hop + origin lockdown + cost; needs explicit AWS approval |
| Keep anonymous public reads forever | **Superseded** — the unsigned lane is a rollout stage (~2-week grace), not a forever lane |

## 8. Non-production proof delivered in this change

- **API (`web/api/`):** `common/signing.rs` (canonicalization, HMAC-SHA256,
  freshness) and `startup/access_gate.rs` (env-resolved `AccessGate`,
  `from_fn` middleware on `POST /`, nonce replay cache, 401 contract).
  `ActixApp::new` resolves the gate once — `enforce` without keys fails
  startup rather than silently locking out clients. `common/auth.rs` adds
  `ApiAuth::is_authorized_manager()` (the authenticated lane).
- **App (`app/`):** `ApiSigningHandler` (`DelegatingHandler` on the single
  `GraphQLHttpClient` construction in `BaseGraphQLService`),
  `ApiSigningCredential`, and `AppConfig.GetApiSigningCredentialAsync`
  (env `API_SIGNING_KEY` → packaged `api-signing-key.txt`). Pass-through
  without a credential — nothing signs until CI packages a key.
- **Shared test vector:** one independently computed golden signature
  asserted byte-for-byte by both the Rust and C# suites.

### Test matrix covered

- **Signatures:** valid (golden vector + fresh timestamps), missing,
  partial/malformed headers, wrong key-id, stale/expired timestamp,
  tampered body, wrong secret, malformed signature hex.
- **Replay:** identical signed request twice → second is `nonce-replayed`;
  nonce expiry and oldest-first eviction under capacity pressure.
- **Lanes:** manager bearer passes unsigned under `enforce`; invalid
  bearer does not; signed request still fails `*_manager` scopes (scope
  isolation — the gate never touches resolver authorization).
- **Modes:** `observe` passes everything and logs; `enforce` rejects
  unsigned with 401 + JSON error; mode parsing (default/observe/enforce/
  garbage→observe); `enforce` without keys fails `resolve`.
- **Rotation:** two key-ids verify during overlap; retiring one degrades
  its cohort to `unknown-key-id`.
- **Contract preservation:** signed `POST /` reaches the real GraphQL
  handler (body re-injected, extractor unchanged); array batches still
  400; `/health` + `/health/ready` unsigned in every mode; oversized
  signed body → 413 (mirroring the existing edge bound).
- **App side:** golden-vector signature, header set, pass-through without
  credential, single credential resolution, `key-id:secret` parsing,
  packaged/env resolution and caching.

## 9. Follow-ups (not in this PR)

- **CI signing-key injection** — new GitHub secret → `app-package.yml` env
  → `WriteApiSigningKeyFile()` in `Build.Package.cs` → packaged
  `api-signing-key.txt`. Touches the packaging workflow → needs Dorad's
  approval on that specific PR.
- **Deploy verification keys** (`API_SIGNING_KEYS` via SSM/env) and the
  `API_REQUIRE_SIGNATURE` flag in the API's task environment — production
  config, same approval requirement.
- **Observe → grace → enforce transition** per §5, driven by signed-share
  logs; the enforce flip is a production setting change.
- **#3257 boundary decision** (§6) — resolve whether crawlers keep any
  programmatic lane before enforcement.
- **Optional:** per-platform/per-release key-ids for finer cohort
  attribution; metrics/alerting on the signed-share log stream.
