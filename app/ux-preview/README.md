# Native home UX preview

This is a long-lived UX review branch. Keep PR #3385 in draft. Do not merge it,
mark it ready, or enable auto-merge without Dorad's explicit instruction.

Review the real emulator captures in [the GitHub comparison](review/REVIEW.md)
or open [the static HTML gallery](review/index.html) locally. Both contain thirteen
screen comparisons against the actual default branch (`master`), plus a
before/after continuous-scroll recording. Before is always on the right and
After on the left, including the GitHub-rendered Markdown tables.
Keep the baseline images fixed and update the same `assets/after/` filenames in
each iteration so GitHub can compare images between commits. Never use a prior
UX iteration as the Before baseline. The default-branch commit is documented in
`review/comparisons.json`. Update descriptions there and run
`python review/generate.py` from this directory to rebuild both review formats.
The daily chapter card remains the home centerpiece; the library is an
additional destination, not a replacement home screen.

This is an opt-in Debug build for design iterations in the real MAUI app. Normal
Debug builds and every Release build keep the existing reader startup.

From `app/`, using the repository's pinned .NET SDK and MAUI Android workload:

```powershell
dotnet build BibleOnSite/BibleOnSite.csproj -f net10.0-android -c Debug `
  -p:TargetFrameworks=net10.0-android -p:RuntimeIdentifier=android-x64 `
  -p:RuntimeIdentifiers=android-x64 `
  -p:EmbedAssembliesIntoApk=true -p:HomeUxPreview=true
```

Install the signed APK from `BibleOnSite/bin/Debug/net10.0-android/android-x64/`
with `adb -s <emulator-serial> install -r <apk>`, then launch
`com.tanah.daily929`. Scope every ADB command to the intended emulator.
For live article counters, use the existing ignored
`BibleOnSite/Resources/Raw/api-config.txt` override with the production API URL;
without it the existing Debug local API setting and offline fallback apply.

The home screen uses the packaged scripture and the existing daily schedule.
Verse counts are loaded from the database; article counters come from the live
or cached starter response, with an explicit offline label when unavailable.
The chapter index, calendar, authors, other learning sections and settings reuse
their existing native screens. No demonstration content is added to the database.

The daily chapter and index open a reader above home. All pages use the same
large Back and Home controls. The preview disables the side drawer and removes
the reader fan. Its dock uses explicit action labels: `תצוגת הטקסט` opens actual
font/display preferences, `בחירת פירושים` opens the picker for inline commentary,
and `מאמרי הפרק` opens articles with a separate count badge. In articles mode the
first action becomes `חזרה לפסוקים`. Its chapter title opens the chapter picker;
the tools sheet contains content search and other reading options. Secondary learning destinations
live in the library rather than a row of small links on home.

The reading viewport keeps fixed geometry while the toolbar moves above it.
Android physical drag deltas drive the toolbar; list layout and fling callbacks
cannot feed back into its visibility. The chapter heading scrolls with the text.
A small upward gesture restores navigation without jumping to the chapter start.
Selection, recitation, playback and search keep their action bar available.
Chapter swipes remain active.

Iteration checks: launch to home, inspect short labels and highlighted actions,
open the daily chapter, scroll down and slightly up, swipe between chapters,
return home, choose a chapter in the index, visit the calendar and a content
destination, then return. Repeat with large text and both appearance modes.

The editorial home uses blue for primary actions, oversized Hebrew typography
and cool neutral surfaces. The library shares the daily card's dark blue,
oversized type and faint background glyphs. Global search stays fixed at the top while the home
content scrolls. It finds app destinations immediately from a local catalog
(including synonyms), alongside the existing content-search results. Selecting
a destination or content hit opens its real native page. The separate chapter
picker is labelled `אינדקס התנ"ך`; the masora subtitle is `חלוקה מסורתית`.

After the first installation, iterate with `-t:Install`,
`-p:EmbedAssembliesIntoApk=false` and `-p:Device=<emulator-serial>` to deploy
updated assemblies to that emulator. Restart the app after deploying.

Run the native smoke checks against the installed preview (Python, defusedxml
and ADB):

```powershell
python -m pip install -r BibleOnSite.Tests.E2E/Android/requirements-home-ux.txt
python BibleOnSite.Tests.E2E/Android/home_ux_preview.py `
  --serial emulator-5564 --artifacts <output-directory>
```

The checks exercise real native controls, record screenshots, and verify toolbar
visibility, chapter swipes, system Back, index selection, populated calendar,
destination returns, navigation search, content-result navigation, articles after
a hidden text toolbar, and app links with two reader instances. An Android
ANR fails the run immediately and records its screen. The reading-options check
also verifies the display-settings destination, commentary explanation and
contextual return-to-verses action.
Keep that emulator free of manual input during the run.
