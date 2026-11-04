# Evidence — #2573 Shared picker scroll-edge arrows (picker-parity increment)

This directory holds the on-device acceptance captures for the picker
increment of the reader-unification issue: the perek/parasha/masora unit
pickers now share `PickerScrollColumns`, so every division reports the same
boundary-arrow state.

## What each file shows

| File | Content |
| --- | --- |
| `after-perek-picker-open.png` | Android emulator (1080×2400): על הפרק reader with the perek picker open — the shared full-height list layout and the up/down boundary arrows rendered on each column. Up arrow reports `תחילת הרשימה`, down arrow `יש עוד פריטים למטה` (verified via accessibility descriptions). |
| `after-perek-picker-scrolled.png` | Same picker after scrolling the perek column — the up arrow flipped to `יש עוד פריטים למעלה` while the down arrow still reports more content, matching the shared `PickerScrollColumns` contract asserted in `PickerScrollColumnsTests`. |

## How to regenerate

Deploy the debug APK to an emulator (`adb install -r
app/BibleOnSite/bin/Debug/net10.0-android/com.tanah.daily929-Signed.apk`),
navigate to על הפרק, open the radial menu and tap `PerekPickerButton`
(verified through Appium UiAutomator2 on `http://127.0.0.1:4723`). The
parasha and masora pickers instantiate the same shared control, covered by
`app/BibleOnSite.Tests/Controls/PickerScrollColumnsTests.cs`.
