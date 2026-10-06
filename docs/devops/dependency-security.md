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

Dependency review compares the pull request's head SHA. NuGet submission now
checks out that same SHA and sets the action's snapshot SHA/ref explicitly. Push
and merge-group runs retain their own immutable SHA/ref. This prevents snapshots
of synthetic PR merge commits from being mistaken for snapshots of the reviewed
head. Dependency review waits for the parallel submission job to publish its graph
instead of reporting a missing head snapshot immediately.

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
