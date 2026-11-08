# Router replacement validation (issue #2561)

Validates a replacement for the sole production nginx router **before** any
Graviton or size migration: the live instance is `i-0d811651c11294634`, a
t3.small x86_64 in `il-central-1` (account 250598594267) behind EIP
51.85.17.212. Stopping or resizing it interrupts production.
Reference audit: [cost-risk-audit-2026-10-23.md](cost-risk-audit-2026-10-23.md);
related work: [#2509 TLS jitter](https://github.com/bible-on-site/bible-on-site/issues/2509),
[#2508 edge validation](edge-rollout-validation.md),
[#2576 admin Spot](admin-spot-rollout.md).

**Research/candidate work only. Do not replace, stop or terminate the live
router, and do not merge an AWS-related PR without Dorad's explicit approval of
that specific PR's current changes. Auto-merge off.** No live AWS resource was
created, modified or deleted for this document; no AWS credentials were
available to the author, so every live-state claim below is sourced from the
committed reference IaC and prior audits, and every live check is written as an
explicit step for the approver.

## Step 0 — measure before sizing (issue requirement 1)

The October 16-23 audit window showed peak CPU 4.323% and minimum credit
balance 576, but that proves nothing about memory or connection headroom.
Collect this evidence **before** choosing a candidate size; all of it is
read-only and needs no approval beyond normal SSH/SSM access:

| Measurement | How | Why it gates the decision |
| --- | --- | --- |
| Memory baseline + peaks | `/proc/meminfo` (MemAvailable, SwapFree), `ps_mem`/`smem` per-process; CloudWatch agent `mem_used_percent` for 7+ days | t3.small→t3.micro/t4g.micro halves RAM to 1 GiB. Accept only if `MemAvailable` stays ≥ ~35% under crawler bursts. |
| nginx workers & connections | `nginx -T` (worker_processes, worker_connections, buffer sizes), `ss -s`, stub_status or `ss -tn` counts at peak | worker_connections × per-connection buffers ≈ memory per worker; also informs `nf_conntrack` sizing. |
| Traffic/crawler bursts | 5-min and 1-min request rates from `/var/log/nginx/access.log` grouped by `$bot_class`; peak req/min and concurrent conns | The March 2026 botnet hit ~300 req/min from 450+ IPs. The candidate must absorb that without OOM or conntrack exhaustion. |
| TLS latency | `latency-baseline.mjs` from an IL vantage and a remote vantage; `release-probes.log` upstream timings | Baseline to compare the candidate against; also feeds #2509. |
| CPU credits | `CPUCreditBalance`, `CPUCreditUsage`, `CPUSurplusCreditBalance` (CloudWatch, 14d) + `credit-specification` on the instance | A t4g is also burstable; confirm current spec (standard/unlimited) and whether surplus billing exists today. |
| Kernel/network limits | `ethtool -S` ENA allowance counters (`bw_in/out_allowance_exceeded`, `pps_allowance_exceeded`, `conntrack_allowance_exceeded`), `conntrack -S` usage | #2509 found no ENA allowance increase on the current instance; re-verify, and re-check on the candidate under load. Smaller instances have lower ENA allowances. |
| Disk | `df -h`, log volume growth rate | 8 GiB gp3 root volume is small; certbot logs + access logs must fit. |

**Decision gate:** if `MemAvailable` never drops below ~1.2× what the measured
peak workload needs on a 1 GiB box, a micro class is defensible; otherwise the
candidate must be `small` class (2 GiB). When in doubt, build the `t4g.small`
candidate — it is already ~20% cheaper than t3.small and carries zero memory
regression.

## Candidate evaluation (issue requirement 2)

All candidates keep **nginx** as the router software: the issue's compatibility
list (GeoIP/module, certbot, Cloud Map resolution, rate limits, redirects,
security headers) is a nginx configuration contract, and the bot-classification
`map` blocks plus `limit_req` zones have no cheap equivalent elsewhere.

| # | Candidate | RAM/CPU | il-central-1 cost/mo | vs current ($17.52) | Verdict |
| --- | --- | --- | --- | --- | --- |
| A | **t4g.small** arm64 | 2 GiB / 2 vCPU | $14.09 (0.0193/hr) | −$3.43 (−19.6%), zero RAM regression | **Primary** |
| B | **t4g.micro** arm64 | 1 GiB / 2 vCPU | $7.08 (0.0097/hr) | −$10.44 (−59.6%) | Conditional — only if Step-0 memory evidence proves headroom |
| C | t3.micro x86_64 | 1 GiB / 2 vCPU | $8.76 (0.0120/hr) | −$8.76 (−50%) | Dominated by B (B is cheaper *and* newer silicon); fallback if arm64 blocked |
| D | t4g.nano arm64 | 0.5 GiB / 2 vCPU | $3.50 (0.0048/hr) | −$14.02 | Rejected — 0.5 GiB under nginx+certbot+burst buffers is an OOM risk no measurement should endorse |
| E | **AWS ALB** | managed | ≥ $25.45 (0.02646 + 0.0084/LCU-hr) + WAF | +$8+/mo *before* WAF | Rejected — see below |
| F | NLB → nginx on Fargate | managed + task | ≥ $23.91 NLB + Fargate task | +$15+/mo | Rejected — NLB is L4; nginx still required, added moving parts |
| G | Caddy / Traefik / HAProxy on EC2 | n/a | same as A/B host cost | n/a | Rejected — full config rewrite of UA maps, referer block, limit_req zones, resolver, probe logging; rewrite risk with no compensating benefit |

Prices are on-demand Linux rates read from the AWS price-list API for
`il-central-1` on 2026-10-28; 730 h/month, compute only. Add ~$0.84/mo gp3
(8 GiB at $0.1056/GB-mo) and $3.65/mo public IPv4 to *every* EC2 option —
these are constant across candidates and already paid for the current router,
so they cancel out of the comparison. A second temporary public IPv4 during
parallel validation adds ~$3.65/mo only while it runs.

**Why E fails the requirements:** ALB cannot express the router's UA-class
maps, sitemap-referer block, per-IP+global `limit_req` zones or custom probe
log without AWS WAF ($5/web-ACL + $1/rule + $0.60/Mreq, ~$10+/mo at this
traffic) — and even then X-Bot-Class pass-through to the backend is not a WAF
feature. It also swaps Let's Encrypt for ACM (fine, but a change), introduces
per-LCU billing for zero measured CPU benefit, and its fixed floor alone
exceeds the current router's entire instance cost.

**Why arm64 is viable:** Amazon Linux 2023 ships an arm64 AMI
(`/aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-arm64`) with
the same package set — `nginx`, `nginx-mod-http-geoip`, `certbot`,
`python3-certbot-nginx` are all published for aarch64. Graviton2 typically
beats t3 per-clock, so equal-or-better TLS performance is expected; the Step-0
validation measures it rather than assumes it.

**GeoIP note:** the reference template lists "GeoIP support for geographic
routing" but the committed `router.conf` contains **no geo directives**. On the
live host, check `nginx -V`/`nginx -T | grep -i geo` to learn whether the
module is even loaded. Carry it over only if it is actually used — otherwise
record the simplification in the IaC metadata. Do not silently install it "for
parity" on the candidate if production never loads it (and vice versa: if it
*is* loaded, `nginx-mod-http-geoip` + a MaxMind database must be part of the
build, and the candidate's `nginx -t` must pass with it).

### Compatibility matrix vs current router behavior

| Behavior (source: `router.conf`, CFN metadata) | A/B/C nginx EC2 | E ALB | F NLB+Fargate | G other software |
| --- | --- | --- | --- | --- |
| HTTP→HTTPS 301 (all hosts) | identical config | redirect rule | passthrough→nginx | rewrite |
| www→bare 301 preserving path+query (both TLDs, http+https) | identical | possible per-rule | passthrough→nginx | rewrite |
| Catch-all default_server → /404 | identical | default rule → fixed response | passthrough→nginx | rewrite |
| UA bot classification (blocked/crawler/regular) + `X-Bot-Class` header | identical | WAF labels only; no backend header | passthrough→nginx | rewrite |
| Sitemap-referer 403 block | identical | WAF rule | passthrough→nginx | rewrite |
| `limit_req` ip_crawler 10r/m + global_crawler 30r/m, 429 status | identical | not available (WAF rate rule is per-IP only, min 100/5min) | passthrough→nginx | rewrite |
| Cloud Map `*.bible-on-site.local` via VPC resolver 172.31.0.2 | identical (same VPC) | target groups use task IPs directly | passthrough→nginx | rewrite |
| Let's Encrypt certbot + renewal jobs | identical (copy or DNS-01) | ACM cert (DNS validation via Route53) | ACM on NLB or certbot on task | rewrite |
| TLS 1.2/1.3, prefer server ciphers | identical | security policy | TLS on backend | equivalent |
| release-probe JSON access log + upstream timings | identical | no equivalent | passthrough→nginx | rewrite |
| `/www/` static alias + autoindex | identical | no static serving | passthrough→nginx | equivalent |
| Security-group ingress 22/80/443 | identical | ALB SG 443 only (+VPC reach) | NLB SG | same |
| Graviton-required arm64 AMI | A/B/D need arm64 AMI | n/a | n/a | n/a |

## Candidate build spec

Separate instance in the **same VPC** (any public subnet — VPC DNS
`172.31.0.2` resolves Cloud Map names VPC-wide):

| Item | Spec |
| --- | --- |
| AMI | AL2023 arm64 SSM param `al2023-ami-kernel-default-arm64` (x86_64 param for the C fallback) |
| Type | `t4g.small` first; downsize to `t4g.micro` only after Step-0 memory evidence |
| SG | `nginx-router-sg` equivalent: 22 (SSH), 80, 443 ingress; egress open |
| Software | `dnf install nginx certbot python3-certbot-nginx` (+ `nginx-mod-http-geoip` only if live uses it) |
| Config | byte-identical `router.conf` + `nginx -t` against the complete installed config, per [router README](cloudformation/ec2-nginx/router/README.md) — dedicated temp dirs, explicit worker user, never a minimal standalone test config |
| Certificates | copy `/etc/letsencrypt` verbatim first (exact SAN set). For durable parallel running adopt **certbot `--dns-route53`** — `certbot-dns-route53` via dnf `python3-certbot-dns-route53` if packaged on AL2023, else pip (DNS-01 works regardless of where A records point; needs a Route53 IAM policy — separate approval). Copying the tree preserves each lineage's *saved* HTTP-01 authenticator in `/etc/letsencrypt/renewal/*.conf`, so installing the plugin is not enough: reissue or reconfigure every copied lineage for DNS-01 (`certbot --cert-name <name> --dns-route53 -d <sans> -i dns-route53 --reinstall` or edit the lineage's renewal conf) and verify each persisted conf shows `authenticator = dns-route53` before the canary. Under weighted DNS an HTTP-01 challenge can resolve to *either* router — the one that did not initiate the renewal has no matching token — so HTTP-01 renewal is unreliable on **both** routers for the entire parallel window, not just a long one |
| Renewal | same cron `certbot renew --quiet`; on candidate prove the *persisted* path, not an override — plain `certbot renew --dry-run` uses each lineage's saved authenticator, which is exactly what the cron job will run. A `--dns-route53` override dry-run alone does not establish that the unattended job uses DNS-01; run it only after the lineage confs above are updated, on both active routers |
| Cloud Map | verify `dig website.bible-on-site.local @172.31.0.2` + `api.`/`admin.` resolve to live ECS task IPs |
| Public IP | allocate a **second EIP** for the candidate (temp cost ~$3.65/mo) — do not touch 51.85.17.212 |
| Observability | same access/error log paths + release-probe log; install nothing that changes router.conf semantics |

## Validation without touching public DNS (issue requirement 3)

Run the compat suite against the candidate through a **local resolver
override** (`/etc/hosts` or equivalent) mapping the real public names to the
candidate's EIP. Host/SNI/TLS paths stay production-identical; zero public DNS
change. Immediately runnable today:

```bash
# Runnable today, on a host where the public names resolve to the candidate EIP:
node web/bible-on-site/scripts/verify-public-content.mjs --origin https://xn--febl3a.co.il
node web/bible-on-site/scripts/verify-canonical-hosts.mjs \
  --domain xn--febl3a.co.il --domain xn--febl3a.com
node devops/latency-baseline.mjs --json
```

`edge-compat-check.mjs` (#2508) already encodes the full public-host contract
— every scheme/host redirect, encoded Hebrew paths, `?book`/`?_rsc`
queries, robots/sitemap byte parity, canonical/title equality — but its CLI
requires `--candidate` and runs CloudFront-specific edge assertions, so it
cannot be pointed at a bare IP today. A `--baseline-only` flag that reuses
only `runBaseline` is **not** sufficient: host statuses/redirects live there,
but the deep-link and response-parity cases live in `runPaired`
(`PAIRED_CASES`), so a candidate that broke e.g. the `/929/315/` redirect or
served a different `sitemap.xml` would still pass. The candidate-validation
PR should instead expose an injectable connection target — per-target DNS
override or `--resolve`-style host:port pinning — and run `PAIRED_CASES`
against the production router and the candidate, dropping only the
CloudFront-specific assertions. That reuses the asserted contract with no
duplicated case list and covers every item in the required coverage below.

Required coverage (all already asserted by the harness's baseline + paired
groups, per the audit's probe list): `.co.il`/`.com` × bare/www/api/admin × http/https; HTTP→HTTPS and
www→canonical redirects preserving path+query; trailing-slash 308;
percent-encoded Hebrew commentary paths and raw-Hebrew request targets;
`?book`/`?bookPage`/`?_rsc` queries; `robots.txt`/`sitemap.xml` byte parity;
real 404s; canonical/`<title>` equality on every HTML response; upstream
health for website/api/admin Cloud Map targets.

Plus, on the candidate specifically:

- **Bot behavior**: spoof a blocked UA (e.g. `AhrefsBot`) → 403; a crawler UA
  → `X-Bot-Class: crawler` observable at the upstream; sitemap-referer → 403;
  burst a crawler-UA sequence → 429 after the per-IP bucket.
- **TLS**: `openssl s_client` cert chain/SAN/expiry parity; TLS1.2+1.3 only;
  `certbot renew --dry-run` (and `--dns-route53 --dry-run` if adopted).
- **Load/memory evidence**: replay or synthesize a crawler-class burst at the
  March-2026 peak (~300 req/min, many source IPs — a k6/hey run from one host
  with rotating UAs is sufficient evidence of *memory* headroom, while noting
  it is not a real botnet); record `MemAvailable`, nginx RSS, conntrack
  usage, ENA allowance counters, CPUCreditBalance throughout. Any swap-in or
  `conntrack_allowance_exceeded` increment disqualifies the 1 GiB size.
- **Negative check**: confirm the candidate answers *only* via its own IP —
  production latency-baseline and UptimeRobot must show no change.

## Measured cost difference (issue requirement 4)

| Item | Current | Candidate A (t4g.small) | Candidate B (t4g.micro) |
| --- | --- | --- | --- |
| Instance | $17.52 | $14.09 | $7.08 |
| Public IPv4 | $3.65 | $3.65 | $3.65 |
| gp3 8 GiB | ~$0.84 | ~$0.84 | ~$0.84 |
| **Steady monthly** | **~$22.01** | **~$18.58 (−$3.43)** | **~$11.57 (−$10.44)** |
| Parallel-window extra | — | +$17.74 (2nd instance + 2nd IP) while both run | same |

Final decision needs the Step-0 measurements plugged into this table; a
Graviton saving below ~$3.4/mo (t4g.small) is small but risk-free on memory;
the micro's ~$10.4/mo is meaningful only with proven headroom.

## Migration plan — staged, each step separately approved (issue requirements 4–5)

Recommended path: **Route53-weighted canary → EIP reassociation cutover →
approved retirement window.** Both public zones are Route53 (`TTL 300`,
wildcard `*`-CNAMEs follow the apex), so weighted records give a real canary
and health-check-gated automatic failback.

1. **Approve + build** the candidate (above). Old router untouched.
2. **Validate** via resolver-override harness; attach JSON reports + memory
   evidence to the PR. No public traffic yet.
3. **Canary via weighted DNS** (approved live change): convert the apex A
   record to two weighted entries — weight 255 → 51.85.17.212, weight 0 →
   candidate — then ramp the candidate weight (0→10→25→50) over days.
   Attach a Route53 health check to the candidate record so Route53 pulls it
   on failure (failback ≈ TTL, no manual DNS edit). Watch: candidate error
   rate, upstream 5xx, latency-baseline from IL + remote, UptimeRobot,
   crawler 429/403 ratios, ECS target health. `api.`/`admin.`/`www.` follow
   the apex via wildcard — the canary share covers them too (they are
   replicated vhosts; flag the mobile-app API exposure in the approval ask).
   Old connections are never killed — DNS move lets clients drain naturally;
   nginx has no cross-instance connection drain, so draining *is* DNS here.
4. **Decide:** regression → weight back to 0 (instant-rollback, old router
   never left) and the canary ends; stable full-share → request final
   approval.
5. **Cutover (EIP reassociation):** move 51.85.17.212 to the candidate and
   restore the single A record → EIP. This **does interrupt live TCP
   connections** (reconnect storms are short; schedule a low-traffic window).
   New connections land on the candidate at the *same* IP — no DNS wait.
   Release the candidate's temporary second EIP. Keep the old instance
   **running** — never terminate at cutover.
6. **Observation window** (separately approved, e.g. 7 days): old router
   stays up and immediately recoverable; rollback = reassociate the EIP back
   (one controlled blip) or, during a DNS phase, set weight 0. Only after the
   window and explicit approval may the old instance be stopped (keep for a
   further agreed period before termination; EBS snapshot before any
   termination).

**Alternative endgame** if EIP reassociation is declined: keep two IPs
permanently (+$3.65/mo — likely not worth it) or repoint DNS to the
candidate's own EIP and release 51.85.17.212 (loses the known address; not
recommended — audit/docs all reference the current EIP).

**Rollback matrix:** canary phase → weight 0 or health-check failback (~TTL);
cutover → `aws ec2 associate-address` back to the old instance (seconds of
interruption); post-retirement → restore snapshot/launch replacement — do not
enter that state without the approved window.

## IaC / audit-trail updates (issue requirement 6)

- `cloudformation/ec2-nginx/ec2-nginx.yaml`: `InstanceType` AllowedValues now
  list the `t4g.*` candidate types; `AmiId` documents the arm64 SSM parameter;
  safety comment links this document. When a size is *accepted*, set it as the
  documented default in a follow-up.
- This document + the Step-0 measurement record are the audit trail; append
  the live verification record after each approved step (same convention as
  [admin-spot-rollout.md](admin-spot-rollout.md)).
- Reference templates are never deployed as stacks — unchanged.

## Recommendation

1. **Keep nginx; replace the instance, not the software.** ALB/NLB/other-proxy
   options fail on cost or feature parity (matrix above).
2. **Build `t4g.small` arm64 as the primary candidate** — −19.6% compute with
   zero memory regression — and collect Step-0 evidence in parallel to judge
   whether `t4g.micro` (−59.6%) is also safe to offer as an option.
3. **Adopt certbot DNS-01 (Route53 plugin)** on the candidate so certificate
   renewal never depends on which instance DNS points to — and reconfigure
   each copied lineage's saved authenticator (the renewal conf, not just the
   plugin install); needs a scoped Route53 IAM policy (part of the approval
   ask).
4. **Canary via Route53 weights with a health-check failback**, cut over by
   reassociating the existing EIP during a low-traffic window, and keep the
   old router running through a separately approved observation window.

## Evidence still required before any live change

- [ ] Step-0 measurements on the live router (memory, workers/connections,
      bursts, TLS, credits, ENA/conntrack, disk) — needs read access.
- [ ] `nginx -V`/`nginx -T` on live: GeoIP module actually loaded? exact
      package list; credit specification standard vs unlimited.
- [ ] Candidate build + `nginx -t` on complete installed config; Cloud Map
      resolution verified.
- [ ] Full harness JSON on the candidate via resolver override (all
      host/path/redirect/robots/sitemap/canonical cases green) +
      `verify-public-content.mjs`, `verify-canonical-hosts.mjs`, and
      `latency-baseline.mjs` paired runs.
- [ ] Burst/memory/OOM/conntrack/ENA evidence at March-2026-class load.
- [ ] Certbot proof using each lineage's *persisted* renewal config — plain
      `certbot renew --dry-run`, the exact command the cron job runs — on both
      routers (+ DNS-01 IAM policy if adopted).
- [ ] Measured cost actuals (not estimates) once the candidate has run.
- [ ] Explicit Dorad approval of the live-migration PR describing steps 3–6.
