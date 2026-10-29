# Evidence - #2721 Masora reader input taps

On-device verification for the masora reader's reported dead taps
(`UnitPickerButton` satellite + `MasoraSource` title). Captured on the
Android emulator (1080×2400, API 36) running the release APK built from
this branch.

Note on before/after: the only source change sits inside `#if IOS`, so
the Android layout is pixel-identical before and after - a side-by-side
pair would show the same frame twice. These captures instead document
the acceptance path end to end: every interaction the issue reported as
dead fires its handler on this build. The iOS-only code cannot be
captured on this Windows host (no iOS device or simulator); CI compiles
the `net10.0-ios` target on this PR.

## What each file shows

| File | Content |
| --- | --- |
| `01-masora-reader.png` | Masora reader (מלכים פרשה צ) - `MasoraSource` title pill in the top bar and the closed circular-menu FAB. |
| `02-title-tap-picker-open.png` | After tapping `MasoraSource` - the unit picker (`MasoraPickerPopup`) opened with group/sefer/parasha columns populated, confirming the title `Clicked` handler fires. |
| `03-fan-open-satellites.png` | After tapping `CircularMenuButton` - the fan is open with the dim scrim and the three satellites (`PrevUnitButton`, `UnitPickerButton`, `NextUnitButton`) rendered at their fan positions. |
| `04-satellite-tap-picker-open.png` | After tapping the `UnitPickerButton` satellite - the unit picker opened, confirming the satellite `Clicked` handler fires. |

The accessibility dump for each step shows the same state transitions:
`MasoraSource` `[136,144][943,260]` clickable/enabled -> `MasoraPickerPopup`
visible; `UnitPickerButton` `[477,1944][603,2070]` clickable/enabled ->
`MasoraPickerPopup` visible; `CircularMenuScrim` `[0,275][1080,2337]` while
the fan is open.

## How to regenerate

Install the release APK (`adb install -r
app/BibleOnSite/bin/Release/net10.0-android/com.tanah.daily929-Signed.apk`),
enable the masora entry (flyout -> העדפות -> על הפרק ->
`MasoraMenuEnabledSwitch`), open מסורה על הפרק from the flyout, then tap
`MasoraSource` / `CircularMenuButton` / `UnitPickerButton` - coordinates
in this capture were the accessibility-bounds centers of each element.

The same wiring is pinned by contract tests in
`app/BibleOnSite.Tests/Pages/MasoraInputWiringTests.cs`.
