# AWS cost risk audit - 2026-10-23

For the later S3 download spike, see the
[November 1 reassessment](s3-delivery-cost-2026-11-01.md). It adds a shared local
mirror and an approval-gated, asset-only CDN proposal while retaining the
legacy-URL requirements below. This dated audit remains a historical snapshot.

Production uptime and existing public/crawled URLs take priority over savings.
This audit supersedes the manual rollout instructions in #2563 and the original
#2576 checklist. Reference CloudFormation files describe configuration; none
were deployed as stacks during this audit.

## Scope and authority

Reviewed the merged cost work in [#2563](https://github.com/bible-on-site/bible-on-site/pull/2563)
and its deployment recovery [#2579](https://github.com/bible-on-site/bible-on-site/pull/2579),
plus open proposals [#2576](https://github.com/bible-on-site/bible-on-site/issues/2576),
[#2561](https://github.com/bible-on-site/bible-on-site/issues/2561),
[#2562](https://github.com/bible-on-site/bible-on-site/issues/2562),
[#2508](https://github.com/bible-on-site/bible-on-site/issues/2508) and
[#2509](https://github.com/bible-on-site/bible-on-site/issues/2509).
Related backup protection was checked against #1828. Searches of open/closed
cost, Graviton and CloudFront PRs found no additional infrastructure cost rollout.

The user authorized applying safe live changes and reverting unsafe proposals.
Every AWS-related PR still needs Dorad's explicit approval of its current changes
before merge. The rule is in root AGENTS.md and the AWS workflow instructions;
it is an agent instruction, not a newly installed GitHub branch-protection gate.
Do not enable auto-merge. Material AWS changes invalidate earlier approval.

## Verified production baseline

Verified with IAM Identity Center profile AdministratorAccess-250598594267:
account **250598594267**, region **il-central-1**. The older #2576 account
985796087238 was incorrect and must not be used for this rollout.

| Component | Observed state | Decision |
| --- | --- | --- |
| Public nginx | Sole EC2 i-0d811651c11294634, running t3.small/x86_64, EIP 51.85.17.212 | Keep running; revert t3.micro default and stop/modify/start instructions |
| ECS | website:16, api:5, admin:6; each desired/running 1, pending 0, rollout COMPLETED | Keep existing revisions and on-demand FARGATE |
| Assets | bible-on-site-assets public; no CloudFront distributions; ASSETS_BASE_URL absent on website/admin | Preserve legacy S3 access and current URL generation |
| DB populator | Active; live code last modified 2026-02-15; S3_BUCKET/SSM_PREFIX env keys; runtime SSM lookup | Keep endpoint and runtime IAM access |
| SSM endpoint | vpce-0dd7903d30e03208c available, private DNS enabled, HTTPS allowed from entire VPC | Do not delete; actual consumers are not limited to its ENIs |
| S3 gateway | vpce-0388b3ea36b6a3214 available | Keep |
| RDS | tanah-mysql available, 7-day automated backups, latest restorable time current at inspection; single AZ, deletion protection off | No DB/resource change; restore drill remains tracked by #1828 |

The private pre-change Lambda ZIP/configuration and log-retention baseline were
saved outside the repository. No decrypted SSM value was retrieved for this
audit. No DB write, data dispatch, service deployment, DNS, IAM or bucket-policy
change was performed by this audit.

## Live change applied

Only two CloudWatch retention settings changed:

| Log group | Before | After | Streams checked | Oldest existing event (UTC) | Stored bytes before/after |
| --- | --- | --- | --- | --- | --- |
| /ecs/bible-on-site-api | Never expire | 365 days | 211 | 2026-01-09 11:54:41.768 | 698679296 |
| /ecs/bible-on-site-admin | Never expire | 365 days | 112 | 2026-02-25 20:49:33.633 | 47353 |

The account and exact group/retention baselines were checked again before each
write. Every stream was inventoried and the minimum firstEventTimestamp was
compared with the 365-day cutoff. No existing event was eligible to expire.
Website retention remains **180 days**. The one-year cap bounds future storage;
it creates no immediate storage reduction at today's event ages.

The proposed 90-day limit was rejected: it would remove existing history.
[CloudWatch retention](https://docs.aws.amazon.com/AmazonCloudWatch/latest/logs/Working-with-log-groups-and-streams.html)
applies to existing events too; changing the setting later does not recover
already deleted history. Further reduction needs a verified archive/restore
or explicit acceptance of that loss.

Rollback to the prior unlimited retention, before events reach the new expiry:

```powershell
aws logs delete-retention-policy --log-group-name /ecs/bible-on-site-api --profile AdministratorAccess-250598594267 --region il-central-1
aws logs delete-retention-policy --log-group-name /ecs/bible-on-site-admin --profile AdministratorAccess-250598594267 --region il-central-1
```

## Unsafe proposals reverted

### Router downsizing and Graviton (#2561, #2509)

Stopping the only nginx instance interrupts the website even though its EIP
survives a restart. Reference defaults are restored to t3.small/2 GB. The
stop/resize recipe is removed. ARM also requires a different AMI.

Seven days of hourly CloudWatch observations (179 points, October 16-23) had
maximum CPU 4.323%, and minimum CPUCreditBalance 576. CPU credit exhaustion was
not observed in that window. These measurements do not prove memory/connection
headroom or explain the older TLS jitter. A future change needs host-level
memory/worker/connection measurements, a separately tested replacement,
connection-drain/cutover assessment and a retained original router. Moving an
EIP may interrupt connections; it is not a zero-downtime guarantee.

### Single admin task on Spot (#2576)

**Superseded for admin on 2026-10-24:** Dorad clarified that one current admin
user can tolerate some outages for savings, then explicitly requested the
admin optimization. The original decision below is retained as audit history.
The admin-only plan and data-safety prerequisite are in
[the rollout record](admin-spot-rollout.md). Public availability, links and
AWS PR approval requirements remain unchanged.

Restore LaunchType FARGATE and remove the Spot switch recipe. The sole task
has no health check, and interruption can lose in-flight edits.
[AWS documents](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/fargate-capacity-providers.html)
that Spot has a two-minute warning and does not automatically fall back to
on-demand capacity. A future mixed-capacity design must preserve available
on-demand capacity and verify edit/session recovery. Scheduled scale-to-zero
has the same availability conflict and is not an automatic fallback.

### OAC-only assets bucket and automatic CDN enablement (#2576)

Remove the untested cloudfront-assets.yaml proposal and unconditional
ASSETS_BASE_URL task settings. Retain the optional URL-builder code: with the
env var absent its tested S3 fallback preserves the existing public URLs.

Replacing the bucket policy with OAC-only access would return 403 for existing
S3 links in released apps, crawled pages and stored content. Existing paths
must continue working without a redirect dependent on a new hostname.

The removed template also assumed most keys were immutable, used a 24-hour
default cache, forwarded CORS inputs without corresponding cache variants,
and configured authors MaxTTL 3600 while claiming a five-minute cap. The live
portrait sample already has a year-long immutable browser cache header; edge
TTL alone would not fix browser freshness after an overwrite.

A replacement CDN design must be **additive**, with public S3 access retained:

1. Inventory all key families, mutable keys, manifests and signed/query URLs.
2. Use disabled caching initially; define explicit safe cache keys/TTLs per
   path after validating Origin/preflight, query-string semantics and browser
   freshness. Do not cache credentials/private variants or negative lookups
   that would hide newly created content. Hash-keyed assets can be optimized
   separately. [Cache key/TTL behavior](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/cache-key-understand-cache-policy.html).
3. Test on a candidate distribution without changing DNS or ECS: legacy S3
   reads, GET/HEAD/OPTIONS, audio Range/206 and seeking, CORS/no-Origin cache
   order, content types/encoding, uploads, mutable replacements and errors.
4. Present costs, tested rollback and the exact proposed DNS/task changes for
   explicit approval. Preserve full task definitions and current image digests.
5. Roll out gradually, retain old URLs indefinitely, verify public content and
   playback, and roll back ASSETS_BASE_URL/DNS if compatibility fails. Do not
   disable/delete a distribution while any published CDN URLs still depend on it.

### SSM endpoint removal and Lambda transition (#2579, #2576)

The old deployed handler still calls SSM. #2579 changes the caller payload,
not the function deployed in AWS. No new GetFunction or configuration-update
permissions are required by that caller; the existing role was not widened.

The next [RDS deployment succeeded](https://github.com/bible-on-site/bible-on-site/actions/runs/39939643771/job/120367620770)
on 2026-10-23 at 10:34 UTC, including the actual deploy step (not a guard skip),
with the existing handler and IAM. Do not rerun historical failed payloads.

Restore the reference runtime SSM policy, SSM_PREFIX and retained endpoint.
The checked-in new Python handler lacks an SSM fallback for legacy callers
that omit db_url; do not deploy it unmodified while those callers remain.
Before removing anything: support and test both caller contracts; package the
full handler/dependencies; validate on an isolated candidate with read-only DB
checks; prove SQL/parser/content compatibility and secret redaction; inspect
VPC-wide SSM consumers including ECS task-start secret resolution and instance
management. [Private DNS routes existing VPC clients to interface ENIs](https://docs.aws.amazon.com/vpc/latest/privatelink/privatelink-access-aws-services.html),
even when clients have public IPs. ENI listing is not a consumer audit. Retain
both endpoints until the approved migration proves independent connectivity.
Recreating an endpoint is not an instantaneous rollback; preserve working
network access while testing a replacement.

## Other open proposals

- **#2562 multi-arch Fargate:** keep amd64 images and current runtime intact.
  Multi-arch manifests alone do not switch ECS to ARM; pin ARM64 explicitly on
  a candidate task. Test native Rust/sharp dependencies, readiness, SSM startup,
  public APIs/pages and rollback to immutable prior image/task revisions. Roll
  out one service at a time only after explicit approval.
- **#2508 edge in front of nginx:** do not apply blanket caching based on
  s-maxage=31536000. Origin ISR/tag invalidation does not invalidate an independent
  edge cache. First prove RSC/navigation/query/cookie/header variants, auth,
  redirects/canonicals, robots/sitemaps, pagination, freshness and all historical
  hosts/paths. Start cache-disabled, leave admin/API mutations uncached and
  retain original routing until an approved canary succeeds.
- **#2509 TLS jitter:** retain as a measurement task. This audit does not establish
  its root cause or justify a production restart/resize.

## Compatibility and final checks

Representative existing responses checked during the audit:

| Public URL/path | Expected response |
| --- | --- |
| https://xn--febl3a.co.il/ | 200 HTML |
| https://xn--febl3a.co.il/929/315/ | 308 to /929/315 |
| https://xn--febl3a.co.il/929/315/%D7%A8%D7%A9%22%D7%99 | 200 commentary HTML |
| https://xn--febl3a.co.il/accessibility | 200 HTML |
| https://xn--febl3a.com/929/27/?book | 308 to /929/27?book= |
| https://www.xn--febl3a.co.il/929/315/ | 301 to canonical HTTPS host/path |
| http://xn--febl3a.co.il/929/315/ | 301 to HTTPS, same path |
| S3 authors/high-res/1.jpg | 200 image/jpeg; Range 0-31 returns 206/32 bytes; CORS * |
| S3 recordings/100_record.mp3 | 206 audio/mpeg, bytes 0-31/2021320, CORS * |

These are representative probes, not an exhaustive crawl or a guarantee of
future behavior. Final AWS reads confirmed unchanged ECS revisions/counts,
public bucket access, active old Lambda, and available SSM/S3 endpoints.
All four edited reference templates passed AWS ValidateTemplate after fixing
a pre-existing validation defect: their top-level Description exceeded AWS's
1024-character limit. Full documentation is preserved in Metadata.Documentation.
Local YAML/intrinsic-reference, safe-default, link and whitespace checks also
passed. ValidateTemplate checks syntax; it is not a deployment/changeset test
and does not make these reference files safe to apply as stacks. No UI or
application runtime was changed.
