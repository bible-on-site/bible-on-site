# Android gesture regressions

These checks run against a debug app on an Android emulator using only Python's standard library and ADB. They verify fast and sustained swipes in both directions, complete chapter snapping, vertical scrolling, deliberate long press and tap selection, scrolling while multi-selection is active, and the first swipe in both directions after app restarts. Coordinates scale to the emulator's display size. Start from a chapter in the middle of the book with enough verses to scroll, and keep the emulator free of manual input during the run.

From `app/`, build/install/launch with `dotnet run --project devops -- RunAndroid --api-env prod`, then run `python BibleOnSite.Tests.E2E/Android/gesture_regressions.py`. Use `--adb <path>` if the SDK is elsewhere and `--serial <emulator-serial>` if needed.

For the long-chapter performance reproduction, run `python BibleOnSite.Tests.E2E/Android/gesture_followup_regressions.py --case scroll-burst --serial emulator-5554`. It selects Psalm 119 in the debug app, performs five fast vertical scrolls, and reports the p90 and worst rendered frame. It currently fails because those frames exceed the 60 Hz budget; keep that failure visible until a performance fix is validated. The other cases in that script cover holds after scrolling, chapter swipes, and cross-gesture selection.

If installing an APK directly with `adb install` instead of using `RunAndroid`, build with `-p:EmbedAssembliesIntoApk=true -p:AndroidPackageFormat=apk` and verify the signed APK timestamp changed before installing. A normal incremental Debug build can update the assembly without rebuilding the APK, so installing its older APK gives a false performance comparison.

The unit tests in `PressGestureTrackerTests` and `SwipeNavigationTrackerTests` cover delayed timer callbacks after movement, release, chapter rebinding, and a new press without depending on machine load. Run them with the normal `TestUnit` target. Native emulator checks complement those tests and are not included in the Windows FlaUI suite.

Each swipe must reach a different chapter and fully snap within 10 seconds. Selection is checked on every poll, including transient frames; this allows cold layout/JIT work without accepting a permanently docked carousel.
