# Store Listing

Canonical store-listing content for the תנ"ך על הפרק app. Each locale directory
holds one listing's text: `he/` is shared by both stores and `en-US/` covers
Google Play's English listing. Screenshots live per platform under
`screenshots/` because each store enforces its own display size.

## Google Play

`SyncGooglePlayListing` (in `app/devops/Build.Deploy.cs`) pushes the listing
through the Play Edits API. The service account needs the Play Console
"Store presence > Manage store listings" permission for `com.tanah.daily929`;
without it the edit stages fine but `edits.commit` returns 403. Every locale
directory maps to the Play listing of the same language tag, except `he`,
which resolves to the app's legacy `iw` tag. The fields applied per listing:

| Play field | Source |
| ---------- | ------ |
| Title | `<locale>/title.txt` (30 chars max) |
| Full description | `<locale>/description.txt` (4000 chars max) |
| Short description | `<locale>/short-description.txt` (80 chars max) |
| Phone screenshots | `screenshots/android/*.png` (sorted by name; replaces the existing set on the default `iw` listing only — other locales inherit its graphic assets) |

The `en-US` copy intentionally uses English search terms (Tanakh/Tanach,
Hebrew Bible, chapter, verse) that the project terminology table otherwise
avoids: Play discovery for that locale comes from transliterated queries, so
the listing text is an accepted ASO exception (#2124) — do not "correct" it to
the internal Tanah/Perek/Pasuk terms.

To sync the listing without shipping a build, run the `Store Listing` workflow
(`.github/workflows/store-listing.yml`, `workflow_dispatch`), or locally:

```
dotnet run --project app/devops -- SyncGooglePlayListing --google-play-key-file <service-account.json>
```

## App Store

Apple binds description, keywords, screenshots, name and subtitle to a version:
they change only with a version submission. The files below are the copy source
for the next submission (App Store Connect > app > version > Localization `he`):

| App Store field | Source |
| --------------- | ------ |
| Name | `he/title.txt` (30 chars max) |
| Description | `he/description.txt` (4000 chars max) |
| Promotional text | `he/promotional-text.txt` (170 chars max, also editable on the live version) |
| Keywords | `he/keywords.txt` (100 bytes max, comma separated) |
| Screenshots | `screenshots/ios/*.png` (1320x2868, iPhone 6.9" set) |

Not yet covered: the iPad 13" screenshot set and additional localizations — both
need console work or real device captures at submission time.

## Release notes

Per-version "What's new" text is a different artifact from this listing copy:
curated Hebrew entries live in `app/store-release-notes/` and are published to
Google Play (`TrackRelease.ReleaseNotes`), TestFlight, the editable App Store
version's `whatsNew` and the Microsoft flight submission's `releaseNotes` by the
CD pipeline — see `app/store-release-notes/README.md`.

## Screenshots

Current captures come from the app's own mobile e2e artifacts (Appium device
screenshots, `app-mobile-e2e-shard` / `appium-android` CI artifacts), upscaled to
the stores' required pixel sizes. When UI changes, refresh them from the latest
green `App Mobile E2E` run and re-run the sync.
