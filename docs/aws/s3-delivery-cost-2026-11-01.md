# S3 download cost reassessment - 2026-11-01

Reuse a shared incremental local asset mirror, then validate an additive
asset-only CloudFront endpoint before opting consumers into it. Keep S3 as
the source of truth and preserve public S3 URLs. This is separate from the
full-website/nginx edge candidate in
[#2676](https://github.com/bible-on-site/bible-on-site/pull/2676) and
[#2788](https://github.com/bible-on-site/bible-on-site/pull/2788).

**Approval:** Dorad explicitly approved
[#2921](https://github.com/bible-on-site/bible-on-site/pull/2921), merge after
passing checks and the staged asset-CDN/build rollout on November 1 in this
chat: "Approve everything, no ask". Root AGENTS.md still governs other AWS PRs
and materially different changes. Do not enable auto-merge or deploy reference
templates.

## Accepted rollout state

The additive distribution is deployed. All 19 paired source/CDN checks passed:
metadata, CORS/preflight, exact ranges, query rejection and repeated uncached
errors. A separate short-lived signed response-override query also returned
identical 206 bytes, Content-Disposition and Cache-Control from both endpoints;
no signed URL/token was printed or saved. Cold downloads through the CDN
successfully prepared all 496 recordings in 22 Windows packs (980,081,247 bytes)
and 22 Android packs (430,379,577 bytes). Offline rebuilds with the CDN setting
unset produced identical catalogs and pack hashes. Source URLs remained S3.
Repository variable `ASSETS_BASE_URL` is now set to the accepted CDN origin for
build downloads; it was absent before rollout. Website/admin origins were not
changed. Workflow changes take effect after merge; PR CI can exercise them
before merge.

| Resource | Accepted value |
| --- | --- |
| AWS account / source region | `250598594267` / `il-central-1` |
| Distribution | `E1WMX9UV9D2726` |
| Assets delivery origin | `https://dpcnux643agl3.cloudfront.net` |
| Origin request policy | `73124065-4c86-4344-8292-29c890dda481` |
| Stable creation reference | `bible-assets-readonly-20261101` |
| Website aliases | None |

The existing bucket policy and CORS match the saved pre-rollout baseline.
Public website and legacy S3 probes still return 200. No DNS, nginx, ECS, IAM,
database or object-content change was made. The approved creation payloads were
applied through the AWS SDK after the CLI's create-policy call could not reach
its endpoint; preflight and schema checks were retained and duplicate inventory
was rechecked before creation. Baseline/configuration and compatibility reports
are saved privately outside the repository.

## Billing evidence

Cost Explorer was read with profile `AdministratorAccess-250598594267`, after
STS confirmed account `250598594267`. S3 buckets are in `il-central-1`.
The snapshot was taken November 1 Israel time / October 31 UTC. October is
**estimated and incomplete**, with a partial October 31. USD amounts exclude tax.

| S3 usage | September 1-October 1 | October 1-November 1 |
| --- | ---: | ---: |
| Internet data transfer out | 1.259 GB / $0.00 | 660.506 GB / $65.3410 |
| Tier 2 requests | negligible | 668,366 / $0.2941 |
| Tier 1 requests | negligible | 3,702 / $0.0204 |
| Storage | 0.850 GB-month / $0.0212 | 2.031 GB-month / $0.0508 |
| Total, including small regional transfers | about $0.037 | about $65.72 |

This is a download-volume problem. A cheaper storage class would barely affect
the bill. October 26-30 each had approximately 45-54 GB of S3 internet egress.
That pace exceeds 1 TB/month; a zero future bill is not a safe promise.

The assets inventory is roughly 2.3 GiB: recordings 1,344.9 MiB, article media
862.4 MiB, generated assets 81.6 MiB, chapter images 32.1 MiB and smaller other
families. Inventory listing needs `--encoding-type url` on Windows because some
keys contain Hebrew. A deployment-staging bucket also exists. Resource-level
billing, S3 request metrics and bucket access logging were not enabled in the
observed state. Service-level billing does **not** identify individual keys,
buckets, callers, visitors, bots or CI as the cause of all 660 GB.

Reproduce with `aws ce get-cost-and-usage`: monthly `UnblendedCost` and
`UsageQuantity`, service filter `Amazon Simple Storage Service`, group by
`USAGE_TYPE`, using the exclusive-end periods above. Use daily granularity for
the recent trend. Never add quantities with different units together.

## Implemented changes

`sync-from-prod` previously downloaded the entire asset bucket into a temporary
directory inside each checkout, uploaded it to local RustFS, then deleted the
download. New worktrees and forced syncs therefore fetched unchanged bytes again.
One cold mirror is roughly 2.3 GiB. Repetition is a plausible contributor, not
proven attribution of the whole bill.

`devops/asset-mirror.mjs` now keeps a shared incremental mirror at
`~/.cache/bible-on-site/s3-mirrors/<region>/<source-bucket>` (under the user home
on Windows). AWS sync downloads changed/new files and removes deleted objects
from this local mirror. Uploads write only to a validated local HTTP RustFS
endpoint and distinct development bucket, with local credentials and no
production session token. A per-mirror lock protects concurrent worktrees
through upload. Failure retains downloaded bytes, releases the lock and does
not record a successful complete-sync checkpoint. After a killed process,
verify it is gone before removing its empty `.lock` directory. Deleting an idle
mirror is safe but makes the next sync a paid cold read. This adds local disk
use and does not write production assets.

Native release builds already cache SHA-verified audio. The GitHub cache API
returned zero `recitation-audio-v1-` entries at inspection; misses/eviction are
possible, but this alone does not prove the billing source. Their combined
cache action saved only after successful job completion. The four preparation
paths now restore explicitly and save immediately after successful audio
verification, before later compilation, signing or store steps can fail. No
partial or failed audio preparation is saved. Android restore/setup now match its
unconditional preparation step; `compile_only` describes the Windows-only
compile gate. See the official
[restore](https://github.com/actions/cache/blob/v6/restore/README.md) and
[save](https://github.com/actions/cache/blob/v6/save/README.md) action contracts.
All four release
preparation steps can now use repository variable `ASSETS_BASE_URL`, passed as
`RECITATION_ASSETS_ORIGIN`, for original MP3 and derived Opus downloads. The
variable was absent at inspection. Empty/unset preserves existing S3 behavior.
Canonical catalog URLs, paths, source identities, checksums, packaged bytes
and offline playback stay the same. Corrupt CDN bytes fail integrity checks;
there is no hidden direct-S3 retry masking a bad CDN.

Recordings almost never change. `--cache-key` therefore derives a stable
`recitation-audio-v2-mp3-<hash>` or `recitation-audio-v2-opus-<hash>` from the
sorted set of actual audio hashes, not the SQLite file hash. Timing approvals,
word edits, row order and duplicate chapter references do not churn the cache.
New/changed audio bytes produce a new key; Android/iOS share the same Opus
inventory. Prefix restore still reuses unchanged files after an inventory
change, and every use rechecks file integrity. The cache includes only raw
`*.mp3` or `*.ogg` files; version-specific catalogs and ZIP packs are regenerated
and are not duplicated in GitHub cache storage.

The local S3 mirror has no expiry. GitHub Actions caches remain subject to
provider eviction/retention, so they are an optimization rather than a permanent
content archive. Stable keys and active reuse avoid unnecessary new copies;
cold/evicted CI downloads use the approved CDN. An additional GitHub release or
artifact archive would duplicate existing store/release payloads and add
version/retention management, so it is not required for this implementation.
The CDN remains pass-through: the transfer savings do not require edge caching,
and existing mutable filenames/query behavior remain compatible.

### Build downloads versus installed-app delivery

The 496 recordings / 22 books validation describes **build-machine outputs**:
fetch source audio, verify it and assemble book archives for distribution. It
does not add a CDN/S3 recording downloader to the installed mobile app.

Android Release installs book packs through Play Asset Delivery. Apple uses
managed Background Assets when available, with an existing versioned GitHub
release-payload fallback. Neither recording path has an AWS/CDN fallback to
disable. `AudioUrl` in the catalog is canonical source metadata; playback reads
verified local files installed from a book archive.

Windows currently bundles its book archives as assets inside the main MSIX,
rather than independently downloading store extension packs. Dorad requested
[#2923](https://github.com/bible-on-site/bible-on-site/issues/2923), labeled
`Devin Backlog`, to implement the Microsoft Store equivalent. AWS-backed
resources are permitted as a last resort **for Windows only**. This PR keeps
that runtime architecture unchanged; its repository variable is passed only
to Python preparation steps on build machines.

## Options and expected gain

| Option | Gain | Risk / decision |
| --- | --- | --- |
| Shared development mirror | Avoids downloading unchanged files across worktrees | Local disk and one cold read remain. Implemented; no production dependency. |
| Asset-only CloudFront pay-as-you-go, caching disabled | Free AWS origin fetch transfer; 1 TB/month internet egress and 10 million requests included | Smallest delivery change, no data copy or write-path migration. Implemented as an opt-in proposal. S3 request/storage charges remain. |
| Cache immutable hash-keyed files later | Fewer origin reads, potentially faster delivery | Separate cache-key/TTL review. Mutable filenames and browser caches make blanket caching unsafe. |
| Cloudflare R2 Standard | Free internet egress; monthly free allowances of 10 GB-month storage, 1 million Class A and 10 million Class B operations | Credible next step at sustained high volume. Requires credentials, migration/synchronization, CORS/range tests and mutable-key freshness design. No R2 account was accessed or changed. |
| Full-website CloudFront | May improve page delivery | Broader redirect/auth/API/nginx risk; unnecessary for direct asset downloads. Separate review. |

Pricing checked November 1: [CloudFront pay-as-you-go](https://aws.amazon.com/cloudfront/pricing/pay-as-you-go/)
includes free AWS origin fetch transfer and the allowances above; excess egress
for Europe/Israel starts at $0.085/GB. Allowances are shared, not per-distribution
or a budget cap. This differs from the CloudFront flat-rate Free plan.
[R2 pricing](https://developers.cloudflare.com/r2/pricing/) confirms free egress;
other Cloudflare products and source-S3 migration reads may still cost money.

If all October's observed 660 GB moved to CloudFront and the allowance were
available, most of the $65.34 transfer charge could disappear. At a sustained
1.5 TB/month, roughly the portion above the first TB would be billable (about
$40-43 for Europe/Israel), plus requests/storage and remaining direct S3 reads.
This is a scenario, not measured savings. Old direct S3 URLs still work and can
still incur egress. Reassess R2 after a week of delivery metrics if the recent
45-54 GB/day trend persists.

## Candidate contract

The reference [asset distribution](cloudformation/cloudfront-assets.yaml) and
`devops/assets-cdn.mjs` request generator add one policy and one distribution:

- Existing public regional S3 REST origin, anonymous reads; no OAC or bucket
  policy/public-access/ownership change. No aliases or ACM work.
- GET/HEAD/OPTIONS only, no upload path. No cookies or compression; HTTP/2 and
  the default CloudFront HTTPS certificate.
- `Managed-CachingDisabled` (`4135ea2d-6df8-44a3-9df3-4b5a84be39ad`). A custom
  policy forwards all queries and the three Origin/preflight headers. Managed
  CORS policies that drop query parameters are insufficient here.
- Explicit zero error-cache TTL for all configurable cached error codes,
  preserving origin status. AWS documents a one-second S3 error floor when
  caching is enabled; configuration alone is insufficient proof. Repeated
  negative probes must show no `Age` or cache-hit evidence before activation.
  [Error caching behavior](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/custom-error-pages-expiration.html).

The build-only opt-in is the first consumer. Website/admin helpers already
accept an optional assets origin, but changing ECS environment alone does not
rewrite all Next.js static HTML or native hardcoded URLs. Website/admin rollout,
build-time configuration and any image-host allowlist work require a separate
approved change after candidate validation. Preserve S3 uploads, presigned
operations and published S3 URLs. Query forwarding does not prove every signed
request works: test signed headers/credentials before signed/private clients
adopt the CDN.

## Approval-gated creation and activation

These are future operator steps **after specific approval**, not an automatic
deployment. Use pay-as-you-go, not a flat-rate subscription. Save the current
distribution inventory, repository variable state and bucket policy/CORS outside
the repository. Recheck STS account, bucket region/public policy, existing origin
policies and tagged distributions to avoid duplicates on retry. Reuse a policy
only after the generator verifies its exact forwarding contract.

From the repository root in Bash, with Node 26 and authenticated AWS CLI:

```bash
profile=AdministratorAccess-250598594267
node devops/assets-cdn.mjs --kind policy > /tmp/assets-origin-policy.json
# First live write: only after approval and confirming the policy is absent.
aws cloudfront create-origin-request-policy --profile "$profile" \
  --origin-request-policy-config file:///tmp/assets-origin-policy.json
# Record the returned UUID as policy_id; do not create another on retry.
node devops/assets-cdn.mjs --kind distribution --policy-id "$policy_id" \
  --reference bible-assets-readonly-20261101 > /tmp/assets-distribution.json
aws cloudfront create-distribution-with-tags --profile "$profile" \
  --distribution-config-with-tags file:///tmp/assets-distribution.json
# Record the returned distribution ID, ARN, domain and ETag outside the repo.
aws cloudfront wait distribution-deployed --profile "$profile" --id "$distribution_id"
node devops/assets-cdn-check.mjs --candidate "https://$distribution_domain"
```

The generator only reads STS/bucket/policy state and prints JSON; it cannot
create/update AWS resources. Validate input with AWS CLI's output skeleton
before writing. After deployment, inspect actual origin, aliases, allowed
methods, cache/error policies and query forwarding.

The paired read-only checker tests JPEG, MP3, WebP and JSON: HEAD, exact 32-byte
Range/206 with and without Origin, OPTIONS, rejected version query and two
consecutive missing-object reads. It checks bytes, metadata, CORS parity,
CloudFront identity and absent cache evidence. A server ignoring Range is
cancelled before a full download. The accepted candidate passed these probes
and a positive signed query response override. Also verify full MP3 and derived
Opus SHA-256/size and package identities before build opt-in. Browser audio
seeking and CORS order remain gates for a future browser-URL rollout; build
downloads are packaged for offline playback. Do not replace production objects
to test freshness.

Only after the candidate passes, set the build-only repository variable:

```bash
gh variable set ASSETS_BASE_URL --repo bible-on-site/bible-on-site \
  --body "https://$distribution_domain"
```

Run one cold-cache native packaging validation without store publication and
compare catalog/pack identities. No DNS, ECS task, database or content update is
included. Monitor CloudFront bytes, requests, 4xx/5xx and daily Cost Explorer
S3/CloudFront totals over at least seven complete days, allowing billing delay.
With visitor URLs unchanged, visitor savings may initially be small; CI and
development savings depend on their actual share of the bill.

## Rollback and compatibility

Before opt-in, removing the unused candidate cannot affect production. After
build-only opt-in, restore the saved repository variable value or delete it if
previously absent, then rerun the build. Catalog URLs and store-delivered audio
remain compatible. Revert the commit to restore the old development-sync
implementation if necessary; cached local files can remain idle. Never remove
a lock held by a running process.

If a later approved consumer publishes CDN URLs, **keep that distribution and
hostname serving indefinitely** even after reverting URL generation. Disabling
it breaks published links. Never revoke public S3 reads to force CDN traffic,
and never delete legacy objects for savings. Arbitrary direct-S3 traffic cannot
be stopped safely without that compatibility tradeoff.
