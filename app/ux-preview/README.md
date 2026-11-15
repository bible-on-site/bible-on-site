# Native home UX preview

This is a long-lived UX review branch. Keep PR #3385 in draft. Do not merge it,
mark it ready, or enable auto-merge without Dorad's explicit instruction.

Review the real emulator captures in [the GitHub comparison](review/REVIEW.md)
or open [the static HTML gallery](review/index.html) locally. Both contain sixteen
screen comparisons against the actual default branch (`master`), plus a
before/after continuous-scroll recording. Before is always on the right and
After on the left, including the GitHub-rendered Markdown tables.
Keep the baseline images fixed and update the same `assets/after/` filenames in
each iteration so GitHub can compare images between commits. Never use a prior
UX iteration as the Before baseline. The default-branch commit is documented in
`review/comparisons.json`. Update descriptions there and run
`python review/generate.py` from this directory to rebuild both review formats.
The daily chapter card remains the home centerpiece. Parasha and holiday cards
also span both columns, interspersed with pairs of single-column destinations.
All destinations open directly from home; there is no separate library page.

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
the tools sheet opens search and other reading options. Secondary destinations
have full-surface, single-column tiles within the same scrolling home page.

The reading viewport keeps fixed geometry throughout the controls' animations.
Both bars remain visible on entry and during a drag in any direction. After the
drag ends and 1.8 seconds pass without activity, the top bar slides out and the
bottom bar fades away. Another drag immediately brings both back. The cooldown
is never armed by initial loading. Open tools, commentary, selection and playback
hold the controls visible. The chapter heading scrolls with the text.
Selection, recitation, playback and search keep their action bar available.
Chapter swipes remain active.

Iteration checks: launch to home, inspect short labels and highlighted actions,
open the daily chapter, scroll down and slightly up, swipe between chapters,
return home, choose a chapter in the index, visit the calendar and a content
destination, then return. Repeat with large text and both appearance modes.

The editorial home uses blue for primary actions, oversized Hebrew typography
and cool neutral surfaces. The wide parasha and holiday cards share the daily
card's dark blue, oversized type and faint background glyphs. Small tiles for
Tanahpedia, traditional masora, authors, the bulletin, contact and donations
alternate between the wide cards. Search stays fixed above home content
and uses the existing `FloatingSearchBar` and `SearchViewModel`. Its `מה לחפש`
selector now includes `מסך`, with local screen matches in the same result list as
scripture and articles. Screen search is available offline and independent of
the book filter. The shared search kind is available in regular builds as well;
only the home/startup and chrome redesign are Debug opt-ins. The Bible picker is
labelled `ניווט בתנ"ך`; the masora subtitle is `חלוקה מסורתית`.

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
position above the dock, Screen filter and result navigation, Bible navigation
picker selection, and contextual return-to-verses action. The explicit fullscreen
action is absent from the preview. Title surfaces and buttons share a 52dp height;
hidden trailing actions do not reserve horizontal space.
Keep that emulator free of manual input during the run.
