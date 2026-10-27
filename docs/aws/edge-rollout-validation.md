# Edge rollout validation (issue #2508)

Researches whether a CloudFront edge in front of the EC2 nginx router improves
real-user latency **without** compromising production stability, content
freshness or existing public/crawled links. Follow-up from
[#2394](https://github.com/bible-on-site/bible-on-site/issues/2394); distinct
from the additive assets CDN tracked by
[#2576](https://github.com/bible-on-site/bible-on-site/issues/2576).
Reference audit: [cost-risk-audit-2026-10-23.md](cost-risk-audit-2026-10-23.md).

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
| Viewer hostname | default `*.cloudfront.net` cert, no aliases | Zero DNS/ACM/registrar changes; nothing public can ever resolve to it until an alias is deliberately added. |
| Origin | apex domain `xn--febl3a.co.il` over HTTPS | The name already resolves to the running nginx EIP and the existing Let's Encrypt certificate covers it, so edge→origin TLS/SNI/Host are production-identical with **no** origin change. |
| Cache policy | `Managed-CachingDisabled` (`4135ea2d-…`) | Every request reaches the origin; no object, variant, redirect or 404 can be stored. Origin ISR/tag revalidation stays authoritative — no second cache to invalidate. |
| Origin request policy | `Managed-AllViewerExceptHostHeader` (`b689b0a8-…`) | All viewer headers/cookies/query strings reach the app (realistic RSC/prefetch/auth traffic); `Host` is rewritten to the origin domain so nginx keeps serving the canonical vhost. |
| Methods | all seven allowed | POST/GraphQL-style requests forward to the origin; with caching disabled nothing is stored regardless of method. |
| HTTP version | `http2` | Protocol parity with current nginx responses; `http2and3` is a later, separately measured step (QUIC changes the TLS/UDP failure modes that #2509 investigates). |
| Compression | `Compress: false` | nginx does not gzip today, so `false` keeps byte parity while responses are diffed. Enabling edge compression is a later measured step. |
| Price class | `PriceClass_All` | Keeps the Tel Aviv PoP — the audience is mostly Israeli and IL latency is what is being measured. |
| Logging | none — CloudWatch distribution metrics + the existing nginx access log | With caching disabled every edge request reaches the origin, so the nginx access log already *is* the request mix; metrics cover edge-side volume/latency/error rates. Legacy `DistributionConfig.Logging` needs an ACL-enabled bucket (S3 ownership enforcement is required posture); if viewer-level logs are wanted later, standard logging **v2** (CloudWatch Logs delivery into an `il-central-1` bucket) is a separate approved change. |

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
   mix comes from the existing nginx access log on the router (with caching
   disabled, every edge request reaches the origin) plus CloudWatch
   distribution metrics
   (Requests/BytesDownloaded/TotalErrorRate/4xx/5xx/Latency) — all read-only.
   The running nginx router and all domain/DNS routes stay untouched.
2. **Isolated candidate, caching disabled, explicit origin/host/TLS** — the
   reference template above; the Host-override design is verified by paired
   probes returning identical vhost content (a wrong vhost would change
   status/canonical/body and fail). Admin/auth/private paths never transit
   the edge: `admin.` and `api.` subdomains keep their own DNS records and
   stay off the distribution; the baseline matrix asserts they remain
   reachable directly.
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
   on every HTML response, so a wrong-page 200 still fails.
4. **Cache keys/forwarding, isolation** — with `CachingDisabled` no cache key
   exists; the harness instead proves the *forwarding* contract a later
   cache key would be built on: `Vary` parity, RSC/`Next-Router-Prefetch`
   header variants reach the origin (different variants must not collapse —
   they can't, nothing is cached), a `Cookie:` probe returns the same
   response as no cookie on public pages, `Set-Cookie` count parity, and the
   base-side `x-amz-cf-id` guard proves the baseline really is direct.
   Cross-user poisoning is *impossible by construction* while caching is
   disabled and must be re-proven with isolated variant tests before any
   cache policy is enabled.
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
   edge-side request mix = CloudWatch distribution metrics — while caching
   is disabled the nginx log sees the identical stream. Cost evidence must
   be actuals: distribution request/data-transfer pricing read from the
   billing console — recorded in the PR before any approval ask, not
   estimated.
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
```

Exit code 1 on any failure; `--json` output is the attachable evidence.
`devops/edge-compat-check.test.mjs` covers the comparison logic
(`node --test devops/edge-compat-check.test.mjs`).

## Staged migration (each step separately approved)

1. **Create the candidate** — deploy the reference template (or the
   equivalent CLI calls). Mutating AWS action → requires explicit approval
   of this PR's described change set first. Preflight: confirm the nginx
   security group already allows inbound 443 from all sources (it must, the
   site is public) — CloudFront origins use the public EIP so no security
   group change is expected.
2. **Validate** — run the baseline matrix and the harness; attach the JSON
   report to the follow-up evidence. Expect every pair equal and every
   candidate response `Miss`.
3. **Measure** — run `latency-baseline.mjs` from IL and a remote vantage
   against both the apex and the candidate; compare TTFB/total per case and
   confirm the TLS+edge overhead does not regress. Read the request mix
   from the nginx access log (identical stream while caching is disabled)
   and the distribution's CloudWatch metrics.
4. **Decide** — if the edge does not beat direct origin on the measured
   metrics, disable and later delete the distribution (it has no published
   URLs, so deletion is safe — but never while any published URL could
   depend on it). Rollout ends here on a negative result.
5. **Pre-cutover hardening** (only if evidence supports an edge): create
   `origin.xn--febl3a.co.il` A → the nginx EIP, extend the nginx certificate
   and `server_name` to cover it, retarget the distribution origin to that
   name, and re-run the full harness. Only then request a *separate* approval
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

- [ ] Harness JSON report on a live candidate (paired parity + Miss-only).
- [ ] `verify-public-content.mjs` and `verify-canonical-hosts.mjs` style
      equivalence on the candidate hostname.
- [ ] `latency-baseline.mjs` IL + remote runs for direct vs candidate.
- [ ] Request mix from the nginx access log + CloudWatch distribution
     metrics; origin load unchanged.
- [ ] Actual cost figures (requests, transfer) — not estimates.
- [ ] Cache-key/variant matrix + publish-freshness contract — designed and
      demonstrated on an isolated path before any `CachingDisabled` change.
