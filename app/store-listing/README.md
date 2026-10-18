# Store Listing

Canonical store-listing content for the תנ"ך על הפרק app. Hebrew copy lives in
`he/` and is shared by both stores; screenshots live per platform under
`screenshots/` because each store enforces its own display size.

## Google Play

`DeployGooglePlay` and `SyncGooglePlayListing` (both in `app/devops/Build.Deploy.cs`)
push the listing through the Play Edits API, so every app deploy keeps the
listing in sync. The fields applied to the `iw` listing:

| Play field | Source |
| ---------- | ------ |
| Full description | `he/description.txt` (4000 chars max) |
| Short description | `he/short-description.txt` (80 chars max) |
| Phone screenshots | `screenshots/android/*.png` (sorted by name; replaces the existing set) |

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
| Description | `he/description.txt` (4000 chars max) |
| Promotional text | `he/promotional-text.txt` (170 chars max, also editable on the live version) |
| Keywords | `he/keywords.txt` (100 bytes max, comma separated) |
| Screenshots | `screenshots/ios/*.png` (1320x2868, iPhone 6.9" set) |

Not yet covered: the iPad 13" screenshot set and additional localizations — both
need console work or real device captures at submission time.

## Screenshots

Current captures come from the app's own mobile e2e artifacts (Appium device
screenshots, `app-mobile-e2e-shard` / `appium-android` CI artifacts), upscaled to
the stores' required pixel sizes. When UI changes, refresh them from the latest
green `App Mobile E2E` run and re-run the sync.
