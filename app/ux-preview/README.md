# Native home UX preview

This is an opt-in Debug build for design iterations in the real MAUI app. Normal
Debug builds and every Release build keep the existing reader startup.

From `app/`, using the repository's pinned .NET SDK and MAUI Android workload:

```powershell
dotnet build BibleOnSite/BibleOnSite.csproj -f net10.0-android -c Debug `
  -p:TargetFrameworks=net10.0-android -p:RuntimeIdentifier=android-x64 `
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

The daily chapter and index open a reader above home, so system Back returns to
home. The reader's labelled home action also returns there. Downward scrolling
hides the reader toolbar; the first small upward movement restores it in place.
Selection/search keep their action bar visible. Chapter swipes remain active,
and the preview omits the fan's dedicated previous/next buttons.

Iteration checks: launch to home, inspect short labels and highlighted actions,
open the daily chapter, scroll down and slightly up, swipe between chapters,
return home, choose a chapter in the index, visit the calendar and a content
destination, then return. Repeat with large text and both appearance modes.
