# Edge rollout validation (issue #2508)

Researches whether a CloudFront edge in front of the EC2 nginx router improves
real-user latency **without** compromising production stability, content
freshness or existing public/crawled links. Follow-up from
[#2394](https://github.com/bible-on-site/bible-on-site/issues/2394); distinct
from the additive assets CDN tracked by
[#2576](https://github.com/bible-on-site/bible-on-site/issues/2576).
Reference audit: [cost-risk-audit-2026-10-23.md](cost-risk-audit-2026-10-23.md).

## Decision after live research

The [October 27 AWS research](edge-research-2026-10-27.md) supports an isolated
experiment, not a production cutover. Router CPU was lightly loaded, some slow
responses spent their time upstream, and S3 internet transfer cost substantially
more than EC2 internet transfer. Prioritize attributing S3 traffic and evaluating
an additive asset CDN that preserves old S3 URLs. A no-cache website edge must
demonstrate a worthwhile improvement for Israeli mobile/fixed networks and
overseas viewers; it cannot remove application work or the single-origin dependency.

**Cutover blocker:** both public zones currently use wildcard CNAMEs to their
apex. `api.` and `admin.` have no explicit records, so moving the apex would move
them too. The pre-cutover steps below must isolate these routes first. These are
historical observations, not authorization to change live AWS.

**Do not change production DNS/cache/routing and do not merge an AWS-related
PR without Dorad's explicit approval of that specific PR's current changes.
Auto-merge off.** The original `s-maxage=31536000` caching suggestion is
withdrawn: origin ISR/tag invalidation does not invalidate a separate edge
cache.

## Design: isolated candidate, caching disabled

The reference template
[cloudformation/cloudfront-edge-candidate.yaml](cloudformation/cloudfront-edge-candidate.yaml)
creates a single distribution reachable only as `https://<id>.cloudfront.net`:

| Decision | Choice | Why |
| --- | --- | --- |
| Viewer hostname | default `*.cloudfront.net` cert, no aliases | Existing public DNS stays unchanged. The candidate hostname itself is public and crawlable; approve access/indexing controls and a teardown plan before creating it. |
| Origin | apex domain `xn--febl3a.co.il` over HTTPS | The name already resolves to the running nginx EIP and the existing Let's Encrypt certificate covers it, so edge→origin TLS/SNI/Host are production-identical with **no** origin change. |
| Cache policy | `Managed-CachingDisabled` (`4135ea2d-…`) | Origin-bound requests are uncached; no object, variant, redirect or 404 can be stored. Edge-generated redirects/rejections do not reach the origin. Origin ISR/tag revalidation stays authoritative - no second cache to invalidate. |
| Origin request policy | `Managed-AllViewerExceptHostHeader` (`b689b0a8-…`) | All viewer headers/cookies/query strings reach the app (realistic RSC/prefetch/auth traffic); `Host` is rewritten to the origin domain so nginx keeps serving the canonical vhost. |
| Methods | all seven allowed | POST/GraphQL-style requests forward to the origin; with caching disabled nothing is stored regardless of method. |
| Viewer HTTP | `redirect-to-https` | Validate status and method preservation against nginx before public cutover; HTTPS-only paired probes do not establish HTTP POST redirect compatibility. |
| HTTP version | `http2` | HTTP/3 is a later measured step. Viewer protocol selection does not prove origin protocol parity; compare actual cold and reused connections. |
| Compression | `Compress: false` | Avoid adding edge compression during the initial comparison. Live nginx already has `gzip on`; check actual response encodings per content type and request rather than claiming compression is absent. |
| Price class | `PriceClass_All` | Keeps the Tel Aviv PoP — the audience is mostly Israeli and IL latency is what is being measured. |
| Logging | none - CloudWatch standard metrics + existing nginx logs | nginx measures forwarded origin requests; edge redirects/rejections do not reach it. Standard metrics cover edge request/byte/error totals. Probes measure latency; additional `OriginLatency` metrics or standard logging v2 require separate approval. Legacy logging requires an ACL-enabled bucket and is deliberately omitted. |

### Alternatives considered

- **Dedicated `origin.` hostname as origin now** — avoids the theoretical
  apex→edge→apex loop if the apex record ever moves before the origin is
  retargeted, but it requires a live nginx change (new `server_name`, a
  Let's Encrypt certificate covering it, config reload) during the research
  phase that must not touch production. Deferred to the pre-cutover step
  below; during validation the apex-as-origin loop cannot happen because the
  apex record does not move.
- **Forward viewer `Host` (`Managed-AllViewer`)** — would send
  `Host: <id>.cloudfront.net` to nginx, which falls through to the first
  port-443 `server` block (`www` → 301 to the bare host). The candidate would
  serve redirects instead of pages, so this policy is unusable without an
  nginx catch-all change — exactly the kind of production touch this phase
  avoids.
- **CloudFront continuous-deployment staging distribution** — stages config
  changes against an existing production distribution. There is no production
  distribution yet, so it does not apply; it may be used in the *cutover*
  phase for canary traffic-splitting.
- **Lambda@Edge / CloudFront Functions** — not needed for a pass-through
  candidate; they add cost, cold-start and a second place for header logic
  to drift. Revisit only if a measured need appears (e.g. normalizing the
  `Host` seen by nginx for a future edge alias).

## Requirement coverage

Each issue requirement maps to a validation step:

1. **Measure latency components and request mix** —
   `node devops/latency-baseline.mjs --json` already produces the
   DNS/TCP/TLS/TTFB breakdown per monitor URL (run from a recorded IL vantage
   and a remote vantage). The compat harness records per-request ms for every
   paired probe so the edge-added latency is visible case-by-case. Request
   mix comes from nginx logs for forwarded requests plus CloudWatch standard
   edge metrics (Requests/BytesDownloaded/TotalErrorRate/4xx/5xx). Edge redirects
   and rejections never reach nginx. The timing probes provide latency evidence;
   enabling additional paid metrics is a separately approved change.
   The running nginx router and all domain/DNS routes stay untouched.
2. **Isolated candidate, caching disabled, explicit origin/host/TLS** — the
   reference template above; the Host-override design is verified by paired
   probes returning identical vhost content (a wrong vhost would change
   status/canonical checks). Production DNS stays direct during the experiment.
   Before cutover, pin `admin.` and `api.` to explicit direct-origin records in
   both domains, independently of the apex wildcard. A direct baseline check
   alone does not prove they will stay direct after a DNS change. Website
   same-origin `/api/` paths can transit the candidate and require method/auth
   coverage; do not infer privacy from path names.
3. **All public paths/encodings** — the baseline matrix asserts today's
   semantics on every scheme/host (http/https × bare/www/api/admin ×
   .co.il/.com) so drift in production cannot masquerade as an edge
   regression. Paired cases cover: homepage and perek pages, the audit's
   trailing-slash 308, commentary URLs with percent-encoded Hebrew+quote and
   raw Hebrew request targets, `/לוח`/`/מסורה`/`/פרשה` rewrites in both raw
   and percent-encoded forms, `?book`/`?bookPage` book chrome, `?_rsc`
   navigation params, `/search` Hebrew query, legacy `/authors` and
   `/tanahpedia/entry` redirects, `robots.txt`/`sitemap.xml` byte parity, and
   a real 404 for a missing path. Canonical tags and `<title>` are compared
   on HTML responses, including the full canonical origin. These are selected
   semantic checks, not full body equivalence. The `.com`/`www` baseline only
   tests current direct routing; validate each eventual viewer alias and
   redirect chain separately before switching it.
4. **Cache keys/forwarding, isolation** — with `CachingDisabled` no cache key
   exists; the harness instead proves the *forwarding* contract a later
   cache key would be built on: selected `Vary`/RSC/prefetch/header probes,
   a synthetic `Cookie:` probe and `Set-Cookie` name/attribute parity. The
   base-side `x-amz-cf-id` guard checks that the baseline is direct.
   This is not a logged-in browser or cross-user isolation test. Disabling the
   shared edge cache avoids introducing shared edge variants, but does not
   establish correctness of browser/origin caches or forwarded authentication.
   Prove authenticated browser flows and isolated user/content variants before
   any cache policy is enabled.
5. **Freshness/invalidation** — while the edge stores nothing, origin
   `unstable_cache`/ISR/tag invalidation remains the only freshness
   mechanism; browser caches see the same `Cache-Control`/`ETag` headers
   (header parity is asserted). The missing-then-created path cannot be
   tested without a real publish: it is a mandatory gate of the *cached*
   phase — publish on staging/admin, prove the new object appears at the
   edge within the agreed TTL/invalidation contract. No shared TTLs are
   enabled until that contract exists.
6. **CORS/ranges/headers, monitoring, cost** — OPTIONS preflight parity, a
   Range probe on a discovered `/_next/static` asset (status and
   `Content-Range` parity, including the "origin ignores Range" case),
   response/security-header parity on every case, and per-request timing.
   Origin load = nginx access log + EC2/ECS CloudWatch (all read-only);
   edge request/byte/error totals = CloudWatch standard metrics. Record billed
   usage separately from any cost projection, naming the pricing model, free
   allowances, time window and attribution limits. Candidate bills and real
   user timings are still required; the historical research is a baseline.
7. **Staged migration + rollback for approval** — the section below. The
   original routing (apex A → EIP) remains in place until an approved
   canary succeeds and stays restorable afterwards.

## Running the validation

```bash
# After the approved creation of the candidate distribution:
node devops/edge-compat-check.mjs \
  --candidate https://<DistributionDomainName> \
  --base https://xn--febl3a.co.il --json | tee edge-compat-report.json

# Existing verifiers also accept an origin — reuse them against the candidate:
node web/bible-on-site/scripts/verify-public-content.mjs \
  --origin https://<DistributionDomainName>

# Equivalent website-only timing cases, from the same recorded vantage:
node devops/latency-baseline.mjs --origin https://xn--febl3a.co.il --json
node devops/latency-baseline.mjs --origin https://<DistributionDomainName> --json
```

Exit code 1 on any failure; `--json` output is the attachable evidence.
`devops/edge-compat-check.test.mjs` covers the comparison logic
(`node --test devops/edge-compat-check.test.mjs`).
Without `--origin`, the latency tool retains its production website/API monitor
matrix. With `--origin`, it measures same-origin website cases and records cold
and warm transfers; check the connection-count evidence before claiming reuse.
The first response/redirect hop is measured, not an end-to-end browser page load.

## Staged migration (each step separately approved)

1. **Create the candidate** — deploy the reference template (or the
   equivalent CLI calls). Mutating AWS action → requires explicit approval
   of this PR's described change set first. Preflight: confirm the nginx
   security group already allows inbound 443 from all sources (it must, the
   site is public) - CloudFront origins use the public EIP so no security
   group change is expected. The candidate is public: approve access/indexing
   controls before creation, account for intentional header differences in
   validation, avoid publishing its URLs, and define teardown. No such controls
   are provisioned by this reference template alone.
2. **Validate** — run the baseline matrix and the harness; attach the JSON
   report to the follow-up evidence. Expect every pair equal and every
   successful origin fetch uncached. Errors can report `Error from cloudfront`
   without being cached; reject any `Age` header (including zero) and inspect
   origin-request evidence as well as `X-Cache`.
3. **Measure** — run `latency-baseline.mjs` from IL and a remote vantage
   against both the apex and the candidate; compare TTFB/total per case and
   confirm the TLS+edge overhead does not regress. Read the request mix
   from nginx logs and compare it with edge metrics. Measure representative
   browser page loads and slow-tail TTFB across Israeli mobile/fixed providers
   and an overseas vantage; a single health request is insufficient.
4. **Decide** — if the edge does not beat direct origin on the measured
   metrics, disable and later delete the distribution (it has no published
   URLs, so deletion is safe — but never while any published URL could
   depend on it). Rollout ends here on a negative result.
5. **Pre-cutover hardening** (only if evidence supports an edge): create
   explicit `api.` and `admin.` direct-origin records in **both** public zones
   before moving either apex. Verify their TLS, API methods and admin login
   against the original origin. Inventory other wildcard consumers and decide
   their routing explicitly, including how `www` redirects on each domain.
   Create an explicit `origin.xn--febl3a.co.il` A record to the nginx EIP (the
   existing wildcard resolution is not an independent origin), extend the nginx certificate
   and `server_name` to cover it, retarget the distribution origin to that
   name, and re-run the full harness. Retargeting rewrites the origin `Host` too:
   preserve public-host redirects/canonicals/cookie domains and validate each
   intended alias, not just the candidate hostname. Configure trusted viewer-IP
   handling before public traffic: current crawler limits and `X-Real-IP` use
   `$remote_addr`, which would otherwise become a shared CloudFront address.
   Never trust arbitrary forwarded IPs from the still-public direct origin.
   Only then request a *separate* approval
   for: ACM certificate (us-east-1) for the public aliases, alias attachment,
   and the DNS switch itself. Plan for DNS/TTL lowering ahead of the switch
   and note that client/crawler caches and any published CDN links keep the
   old path reachable — the apex A→EIP record must remain restorable for at
   least the TTL window after cutover.
6. **Rollback** — DNS revert restores the original path. Keep the nginx
   router, security group and certificates running until the edge has
   survived a full content-publish cycle and the DNS TTL has expired twice.

## What this PR does not do

- No live AWS resource is created, modified or deleted.
- No DNS, nginx, ECS, S3-policy or application change.
- No caching is enabled anywhere — the template pins `CachingDisabled`.
- No `api.`/`admin.` traffic is routed through any edge; mutations and auth
  stay on the existing direct subdomains.

## Evidence still required before any routing change

- [ ] Harness JSON report on a live candidate (paired parity + no cache evidence,
      including errors and `Age: 0`).
- [ ] Candidate access/indexing controls and teardown approved and verified.
- [ ] Explicit API/admin DNS records in both domains and all wildcard consumers
      verified before apex cutover; trusted viewer-IP handling tested.
- [ ] Post-retarget origin TLS/Host, every viewer alias and browser auth flows
      preserve existing public redirects, canonicals and cookie behavior.
- [ ] `verify-public-content.mjs` and `verify-canonical-hosts.mjs` style
      equivalence on the candidate hostname.
- [ ] `latency-baseline.mjs` IL + remote runs for direct vs candidate.
- [ ] Request mix from the nginx access log + CloudWatch distribution
     metrics; origin load unchanged.
- [ ] Actual cost figures (requests, transfer) — not estimates.
- [ ] Cache-key/variant matrix + publish-freshness contract — designed and
      demonstrated on an isolated path before any `CachingDisabled` change.

Review corrections, evidence sources and the distinction between an asset CDN
and a website edge are recorded in [the research note](edge-research-2026-10-27.md).
