# Dependency security follow-ups

The release-safety review also checked the repository's open Dependabot alerts on
2026-10-06. Security checks and Renovate updates remain enabled.

The data S3 populator uses AWS's current HTTPS client. Its S3 SDK default features
also selected the unused legacy Rustls client, bringing vulnerable
`rustls-webpki 0.101.7` into the lockfile. Select the current default-client features
explicitly and retain SigV4a, HTTP 1.x and Tokio support. The resolved TLS verifier
is now `rustls-webpki 0.103.15`, resolving the three data alerts. No application
content or production credentials are involved. See [AWS HTTP client configuration](https://docs.aws.amazon.com/sdk-for-rust/latest/dg/http.html).

## Dependency graph provenance

See [the snapshot provenance finding](https://github.com/bible-on-site/bible-on-site/issues/1997).

Dependency review compares the pull request's common ancestor and head SHA. The submission
SDK already labels PR snapshots with the head SHA; default checkout scans the
synthetic merge commit. Match checkout and snapshot metadata explicitly. Submit
both comparison base and head on pull requests. Resolve the common ancestor
with `git merge-base`; submitting only the current base tip leaves older PRs
without the graph GitHub actually compares. A version-only `[skip ci]` commit
can also lack a snapshot. Keep correlators stable across all workflow contexts.

Do not add duplicate correlators merely to equalize snapshot counts. A trial
that submitted the same real restored NuGet graph under both the historical
`submit-nuget` and current `nuget` names changed a two-base/one-head warning to
three-base/two-head; it did not repair the comparison. Retain one stable `nuget`
correlator and require a nonempty submission.

Keep the required `submit-nuget` check name in both PR and merge-group contexts.
Reusable and matrix jobs add prefixes/suffixes; explicit aggregate jobs must fail
if any submission fails or is skipped. Do not relax repository protection.

Run review only after both submissions complete, then wait for indexing without
relaxing vulnerability or license checks. Push and merge-group submissions retain
their own immutable source. See [GitHub's submission/review guidance](https://docs.github.com/en/code-security/concepts/supply-chain-security/dependency-review#best-practices-for-using-the-dependency-review-api-and-the-dependency-submission-api-together).

The review action can finish successfully after its snapshot retry timeout even
when GitHub still warns that the base and head snapshot counts differ. Check the
comparison API again after review and fail on any snapshot warning, HTTP or
network failure, or invalid response. An empty dependency diff is valid only
when the snapshot comparison is complete. The verification script has a bounded
network timeout and never logs its authentication token.

This guard remains an unmerged draft until GitHub returns complete comparisons.
See [the historical snapshot blocker](https://github.com/bible-on-site/bible-on-site/issues/2002). The API still reports unequal
counts after ordered, source-bound submissions and 600 seconds of indexing retries.
It exposes comparison and snapshot creation endpoints, but no supported endpoint
to list, filter by snapshot identity, or delete historical snapshots. Queue and
master runs submitted the same merge SHA under different actual refs; this is a
possible source of duplicates, not a confirmed backend diagnosis. Managed Python
graph submissions are another recorded source. Do not forge detector/ref metadata,
upload empty graphs, weaken vulnerability/license checks, or sync a conflict-free
green PR to work around this.

Use `npm --prefix devops run test:dependency-snapshots` for local regression tests.
Use `npm --prefix devops run verify:dependency-snapshots` to check a specific pair,
with `GITHUB_REPOSITORY`, immutable `DEPENDENCY_BASE_SHA`/`DEPENDENCY_HEAD_SHA`, and
`GH_TOKEN` supplied by the invoking environment. On GitHub, inspect the completed
reusable submission job logs directly; the parent workflow log may omit them.

## Upstream blockers

| Existing dependency pin | Resolved vulnerable dependency | Follow-up |
| --- | --- | --- |
| `app/mobile-e2e/package.json`: `appium-uiautomator2-driver 8.7.0` | Its published bundle includes axios 1.19.0, brace-expansion 5.0.9, morgan 1.11.0 and proxy-addr 2.0.7; 13 alerts. | [Replace the vulnerable Android driver bundle](https://github.com/bible-on-site/bible-on-site/issues/1995) |
| `web/bible-on-site/package.json`: `jest 30.5.2` | Coverage tooling resolves `sprintf-js 1.0.3` through legacy YAML/argparse; one alert. The latest sprintf-js 1.1.3 is also vulnerable. | [Remove the unpatched coverage dependency](https://github.com/bible-on-site/bible-on-site/issues/1996) |

The Android driver's vulnerable packages are marked `inBundle: true`. Exact patched
npm overrides followed by install, update and clean installation did not replace
those copies. Upstream must rebuild or remove its bundle, or provide a supported
replacement distribution. The test server listens on loopback; it is not a
production application dependency.

There is no patched sprintf-js release. Forcing a new major YAML/argparse version
into a parent still using their old API can break coverage. Adopt a supported
parent update or patched formatter, then validate website unit and coverage tests.
See the [upstream disclosure](https://github.com/alexei/sprintf.js/issues/237).

Both follow-ups are linked in their Renovate rules. Those rules document the
blockers without freezing versions or disabling automated updates. Keep the
remaining alerts visible until the resolved dependency trees are fixed.

## Validation

The S3 populator's five unit tests and local HTTP integration test pass with the
current client features and regenerated lockfile. The TLS dependency tree contains
only the patched verifier. No existing locked package version was upgraded; the
legacy client and its exclusive dependencies were removed.

The [dependency review API](https://docs.github.com/en/rest/dependency-graph/dependency-review) determines the merge base for its comparison. Branches need not merge master just to supply this graph.
