# Android gesture regressions

These checks run against a debug app on an Android emulator using only Python's standard library and ADB. They verify fast and sustained swipes in both directions, complete chapter snapping, vertical scrolling, deliberate long press and tap selection, scrolling while multi-selection is active, and the first swipe in both directions after app restarts. Coordinates scale to the emulator's display size. Start from a chapter in the middle of the book with enough verses to scroll, and keep the emulator free of manual input during the run.

From `app/`, build/install/launch with `dotnet run --project devops -- RunAndroid --api-env prod`, then run `python BibleOnSite.Tests.E2E/Android/gesture_regressions.py`. Use `--adb <path>` if the SDK is elsewhere and `--serial <emulator-serial>` if needed.

The unit tests in `PressGestureTrackerTests` and `SwipeNavigationTrackerTests` cover delayed timer callbacks after movement, release, chapter rebinding, and a new press without depending on machine load. Run them with the normal `TestUnit` target. Native emulator checks complement those tests and are not included in the Windows FlaUI suite.

Each swipe must reach a different chapter and fully snap within 10 seconds. Selection is checked on every poll, including transient frames; this allows cold layout/JIT work without accepting a permanently docked carousel.

## Commentary sheet visual regression

`perushim_sheet_regressions.py` uses ADB, Pillow and defusedxml against the Perek reader with the commentary pack removed. It checks that the books icon remains painted through a sustained upward drag, checks the native bounds of the icon and both actions, taps log export and verifies Android's share chooser, follows the download action to extension settings, installs the pack, verifies one Back returns to the populated reader, and collapses the sheet. It saves the actual screenshots, view hierarchies, and a JSON report.

Run on a dedicated emulator with no manual input during the check. Open a chapter and use the extension settings to remove the commentary pack first. The reported reproduction was checked at a 360 by 800 logical viewport with font scale 1.3.

```powershell
python -m pip install Pillow defusedxml grpcio
python BibleOnSite.Tests.E2E/Android/perushim_sheet_regressions.py --adb <sdk>/platform-tools/adb.exe --serial emulator-5554 --artifacts <output-directory>
```

The default Back check uses the emulator SDK's `EmulatorController.sendKey` API, which follows the toolbar's key input path. Launch the dedicated emulator with `-grpc 8554` (localhost only), or select another local port with `--emulator-grpc-port`. The app-only alternative is `--back-source injected`, which uses Android's injected Back key and does not validate the emulator toolbar. The console's generic `event send EV_KEY:KEY_BACK` command takes a different path and is not a toolbar regression check.

For the API 36 image used here, `hw.keyboard=no` omits the emulator's virtio keyboard device. Toolbar Back then delivers no key, including in Android Settings. Set `hw.keyboard=yes` in that dedicated AVD's `config.ini` and cold-start it without wiping data. Keep `hw.mainKeys=no` and the normal touch driver. Confirm Back leaves Android Settings before checking download and return in the app.
