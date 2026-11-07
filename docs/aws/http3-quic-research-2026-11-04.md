# HTTP/3 / QUIC research - 2026-11-04

Read-only verification of [#2990](https://github.com/bible-on-site/bible-on-site/issues/2990).
Repo state inspected at `origin/master` `6bfddecd5`; public endpoints re-probed
on 2026-11-04 UTC. No AWS, DNS, nginx, ECS or repository production state was
changed. This document records a recommendation; it is not rollout or merge
approval. Any AWS-impacting follow-up needs Dorad's explicit approval of that
specific PR per root `AGENTS.md` and `.cursor/rules/aws-workflows.mdc`.

## Recommendation

1. **Enable `http2and3` on the existing asset CDN as the bounded pilot** —
   one distribution setting on `E1WMX9UV9D2726`, via an approval-gated PR that
   also updates the reference template and request generator. CloudFront keeps
   h2/HTTP/1.1 over TCP automatically; clients that lack QUIC fall back without
   URL or behavior changes. AWS documents no separate HTTP/3 fee.
2. **Close the router's simpler transport gap first: HTTP/2.** All HTTPS
   virtual hosts negotiate HTTP/1.1 only. Enabling h2 over the existing TCP/TLS
   listeners is a smaller change than QUIC and benefits every page view today —
   a measurable prerequisite, not a blocker, for the CDN pilot.
3. **Defer direct-nginx HTTP/3.** It requires an `http_v3`-capable build
   (nginx documents the module as experimental), a QUIC-compatible TLS library,
   a UDP 443 listener plus matching security-group/network exposure, and its
   own compatibility/performance validation. Revisit after the h2 baseline and
   the CDN pilot are measured.
4. **Expectation setting:** the asset CDN's only live consumer today is build
   downloads (`RECITATION_ASSETS_ORIGIN` in CI). The website task definition
   deliberately leaves `ASSETS_BASE_URL` unset, so browser asset requests still
   go to S3 over HTTP/1.1 and cannot use h3 regardless of this flag. Enabling
   h3 on the distribution is safe groundwork and prepares verified evidence for
   future consumer adoption — it is not a browser-facing speedup by itself.

## Verified production baseline (2026-11-04)

| Endpoint | Observed |
| --- | --- |
| `xn--febl3a.co.il:443` | TLS 1.3; offered `h2,http/1.1,h3`, negotiated **http/1.1**; `Server: nginx/1.24.0 (Ubuntu)`; no `Alt-Svc` |
| `api.xn--febl3a.co.il:443` | TLS 1.3; ALPN **http/1.1**; root 404 (no health-endpoint conclusion drawn) |
| `dpcnux643agl3.cloudfront.net` | TLS 1.3; offered `h3,h2,http/1.1`, negotiated **h2**; no `Alt-Svc` |
| CDN asset `HEAD authors/high-res/1.jpg` | 200; `X-Cache: Miss from cloudfront`; byte/range semantics unchanged |
| Page `GET /929/307` | Still references `bible-on-site-assets.s3.il-central-1.amazonaws.com` directly for images and recordings; no CloudFront host |

Windows `curl` 8.21.0 (Schannel) has no HTTP/2 or HTTP/3 feature, so response
lines above are TCP/TLS evidence only; h3 verification needs an h3-capable
client (`curl --http3` builds, aioquic, or browser devtools protocol column).

## Repository evidence

- `docs/aws/cloudformation/cloudfront-assets.yaml:34` — `HttpVersion: http2`
  on the reference distribution config (reference-only, never deployed as a
  stack; actual writes go through reviewed SDK calls).
- `devops/assets-cdn.mjs:57` — the request generator emits `HttpVersion:
  "http2"`; `devops/assets-cdn.test.mjs` does not pin the field today.
- `docs/aws/cloudformation/ec2-nginx/router/router.conf` — every TLS vhost
  uses `listen 443 ssl;` with no `http2` parameter → HTTP/1.1 only.
- `docs/aws/cloudformation/ec2-nginx/ec2-nginx.yaml:210-225` — security-group
  ingress is TCP 22/80/443 only; there is no UDP 443 rule anywhere in the
  stack, so QUIC cannot reach the router even with a capable build.
- `docs/aws/cloudformation/ecs-services.yaml:338-340` and `:548` —
  `ASSETS_BASE_URL` intentionally unset for website and admin consumers.
- `docs/aws/cloudformation/cloudfront-edge-candidate.yaml:46` — the whole-site
  edge candidate already defers h3 to a separately measured step.
- `devops/assets-cdn-check.mjs` — existing paired source/CDN checks (metadata,
  CORS/preflight, exact 206 ranges, query rejection, repeated uncached errors)
  to reuse for post-change verification.
- `docs/aws/s3-delivery-cost-2026-11-01.md` — #2921 rollout evidence: the CDN
  exists additively, public S3 URLs remain the source of truth.

## Enabling diff (pilot, approval-gated)

Reference IaC and generator alignment — the actual change is an
`update-distribution` on `E1WMX9UV9D2726` with the current config+ETag and a
single field flip; no new resources, aliases, DNS, bucket-policy, cache or
origin-request changes:

```diff
# docs/aws/cloudformation/cloudfront-assets.yaml
-        HttpVersion: http2
+        HttpVersion: http2and3

# devops/assets-cdn.mjs (distributionRequest)
-			HttpVersion: "http2",
+			HttpVersion: "http2and3",
```

Plus: pin `HttpVersion` in `devops/assets-cdn.test.mjs` so a future revert is
caught; save the complete current distribution config privately before the
approved update for exact rollback. A successful `update-distribution`
rotates the ETag, so rollback submits the saved config body with a freshly
fetched ETag (`get-distribution-config`), not the pre-update one.

## Why not the whole site / direct nginx h3 now

- CloudFront viewer h3 does not require h3 at the origin; conversely, moving
  apex/www/api/admin behind CloudFront (#2508) is a routing decision that must
  stand on its own measured evidence — not a prerequisite and not a shortcut
  for a protocol flag.
- nginx 1.24's QUIC support requires the experimental `http_v3` module and a
  QUIC-capable TLS stack; the reference config and live SG have no UDP 443.
  The server header alone is not a build inventory — verify compiled modules
  and distro patches on-host before any listener change.
- HTTP/3 does not fix rendering stalls, PDF CPU, cache misses or a single
  unavailable origin; its benefit here is a hypothesis until measured.
- 0-RTT/early data is not needed for the pilot; do not enable it for admin/API
  write flows as a side effect.

## Acceptance and rollback (post-approval)

- Verify real h3 negotiation with an h3-capable client and browser protocol
  evidence; confirm the distribution's HTTPS DNS record/`Alt-Svc` appears.
- Verify h2 and HTTP/1.1 fallback explicitly per protocol (e.g. an h3-capable
  `curl` with `--http2`/`--http1.1`, or the browser devtools protocol column):
  the paired checks below use `fetch`, which negotiates ALPN automatically and
  neither selects nor records a protocol, so they prove functional parity only.
- Re-run `devops/assets-cdn-check.mjs --candidate https://dpcnux643agl3.cloudfront.net`:
  all 19 paired checks must stay green.
- Compare equal-resource downloads h2 vs h3 (build-download path is the live
  consumer); predefined sample count and error criteria, recorded per the
  issue's measurement plan.
- Rollback: restore `HttpVersion: http2` via `update-distribution` with the
  saved config body and the then-current ETag (re-fetched after the pilot
  update rotated it), wait for deploy, verify asset access. Clients may
  retain `Alt-Svc` briefly; TCP service and public URLs never change.

## Related

- #2990 (this research), #2992 (compression — kept independently measurable)
- #2921 merged (asset CDN exists), #2576 (cost gating), #2508 (whole-site
  edge validation), #2561 (router replacement), #2509 closed (origin stalls)

## Primary sources

- RFC 9114 (HTTP/3 discovery/fallback/early data)
- CloudFront supported viewer `HttpVersion` values (http2and3) and FAQ
  (origin independence, Alt-Svc advertisement, no separate h3 fee)
- nginx QUIC deployment guide and `ngx_http_v3_module` status
- Apple TN3102 / .NET QUIC platform notes (only if native adoption is pursued)
