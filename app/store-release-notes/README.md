# Store Release Notes (Hebrew)

Curated, user-facing release notes for the app stores — Google Play, the
Apple App Store / TestFlight and Microsoft Store (#2972). Each file here is
one **user-visible change**, written in Hebrew from the user's perspective,
and published automatically by the CD pipeline when a release containing it
ships to a store.

This is store copy, not the developer changelog: no commit subjects, PR
titles, hashes, issue numbers, author handles, conventional-commit prefixes,
dependency names or CI/deployment terminology. Those stay in the technical
release notes generated for the GitHub release.

## Authoring

A PR whose change is visible to app users adds one JSON file here —
`<kebab-case-id>.json`:

```json
{
  "text": "אפשר להסיר חבילות פירושים מתוך ההעדפות ולפנות מקום במכשיר.",
  "platforms": ["android", "ios", "windows"],
  "kind": "feature",
  "pr": 2972
}
```

| Field | Required | Meaning |
| ----- | -------- | ------- |
| `text` | yes | One Hebrew sentence describing what users can now do, what became easier, or which visible problem was fixed. Max 240 chars, ends with a period. |
| `platforms` | yes | Non-empty subset of `android`, `ios`, `windows` — only platforms where the change is actually available to users. |
| `kind` | no | `feature` (default), `fix` or `performance`; orders the bullets by user benefit. |
| `enabled` | no | `false` keeps the entry out of store notes until the feature truly ships (flip to `true` in the shipping release). |
| `pr` | no | Provenance only — never rendered into store text. |

`text` rules (enforced by the generator and matching `AGENTS.md` Hebrew
punctuation): Hebrew letters, digits and ASCII `"' -.,:;!?()%` only — no
Latin letters, links, `מספר #1234` forms, maqaf `־`, geresh `׳` or gershayim
`״` (use ASCII `'` / `"`), no typographic dashes/quotes. Write one clear
sentence; multiple commits behind one feature become one entry — delete,
don't duplicate.

Do **not** add entries for tests, refactors, version bumps, tooling, CI,
website-only work, or anything users cannot see on that platform.

## How it publishes

`devops/github/release/store-release-notes.mjs` runs inside each store's CD
job, after the deployment guard and under that job's lock:

1. It reads the last **successfully delivered** version for the exact
   store/channel from the GitHub deployment records (`app-android`,
   `app-windows`, `app-ios-beta`); the public App Store baseline is the
   version Apple reports READY_FOR_SALE. A tag or binary upload never counts
   — failed intermediate versions stay inside the announced range.
2. An entry is announced when it is enabled at the release tag but was
   absent or disabled at the baseline tag — exactly once per audience, even
   when the store skipped versions in between.
3. Notes render as `• …` bullets, features then fixes then performance, cut
   whole-bullet to the store's verified limit (Play 500, Apple 4000,
   Microsoft 1500 Unicode chars). A release with no user-visible change
   announces honestly: `גרסה זו כוללת שיפורים פנימיים ותחזוקה.`
4. The notes plus a manifest (baseline, feature ids, rendered text, digest)
   attach to the GitHub release as per-attempt artifacts, then write to the
   store's own field: Play `TrackRelease.ReleaseNotes`, TestFlight
   "What to Test", Apple `appStoreVersionLocalizations.whatsNew` (only on an
   editable version record, in the dedicated `publish_app_store_notes` job
   so a later-created version record can be retried without touching the
   binary), Microsoft flight-submission
   `listings.<he>.baseListing.releaseNotes`.

Releases that predate this directory carry no curated entries (`notes:
null`); the deploy leaves their store metadata untouched, and the TestFlight
path keeps its legacy changelog for such rollbacks.

## Preview and override

```bash
GITHUB_REPOSITORY=bible-on-site/bible-on-site node \
  devops/github/release/store-release-notes.mjs --generate \
  --target app-android --version 5.1.8 --tag app-v5.1.8 --dry-run
```

An editorial correction tied to the exact in-flight release can ride in
`STORE_NOTES_OVERRIDE` (validated Hebrew, whole text replaces the generated
notes for that run). To correct notes already published, fix the entry file
in a PR — delivered versions never regenerate.
