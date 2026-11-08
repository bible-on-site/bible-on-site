# Evidence — #2926 Perushim shortcut locks Back and Preferences navigation

Captures for the fix that replaced the unbounded `_navigationInFlight` flag
with `NavigationSettleWatch` (armed only for location-changing proposals,
bounded two-second consume window) and made `PreferencesPage` restore the
settings overview when a later entry carries no `section` query.

## What each file shows

| File | Content |
| --- | --- |
| `appium-flyout-preferences-back.png` | Real-device CI capture: `PerekPilotTests.NativeFlyoutOpensPreferencesAndBackReturnsToThePerek` — flyout → Preferences → Android Back returns to the invoking perek — **passed** on this PR's build (Appium Android lane of run 41883008991, `mobile-e2e.trx` outcome `Passed`). This is the app's own e2e artifact exercising the fixed pipeline end to end. |
| `emulator-perushim-sheet.png` | Dev emulator (sdk_gphone64_x86_64, debug build): the perushim sheet open over the reader — the sheet whose "הורדת חבילת פירושים" entry routes to `PreferencesPage?section=packs`. |
| `emulator-preferences-pack-missing.png` | Preferences overview reporting `פירושים: לא מותקנת` — the missing-pack state recreated by deleting only `sefaria-dump-5784-sivan-4.perushim_notes.sqlite` from app data, leaving the rest of the install intact. |
| `emulator-back-returns-to-reader.png` | The reader reconnecting after Back popped the preferences stack — logcat shows real `Back` keyevents driving `PerekPage` appearing again instead of being swallowed by a stale navigation flag. |

## Limitations

The scripted shortcut round trip (empty sheet → הורדת חבילת פירושים → packs →
Back → העדפות) could not be captured end-to-end on this emulator: the debug
build was ANR-killed every few minutes under software rendering (repeated
System UI and app ANRs, LMK kills). The packs→overview→packs transition is
covered deterministically at the real-Shell level by
`NavigationBoundaryTests` (same `PreferencesPage` instance, exact flyout
route, no `Navigated` on the no-op re-entry, overview restored) and by
`PreferencesPageTests` mode-swap round trips; the flyout→Preferences→Back
pipeline is covered on real hardware by the Appium capture above.
