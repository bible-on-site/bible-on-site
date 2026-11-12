# Issue #3316 — popup surround verification after CommunityToolkit.Maui 16.0.0

Verification captures for the review thread on PR #3279 (toolkit 15.0.1 → 16.0.0),
checking whether v16's changed popup `BackgroundColor` defaults paint an opaque
black rectangle around the shared `AppDialogPopup` rounded card.

**Result: no regression reproduced.** The v16 popup surround renders the dimmed
page (the app-owned `#80000000` scrim) exactly like v15 — the rounded
theme-colored `Card` border is the only painted popup surface.

## Test builds

| Build | CommunityToolkit.Maui | Configuration |
|-------|----------------------|---------------|
| before (`v15-*`) | 15.0.1 | Debug `net10.0-android`, `android-x64`, offline E2E (packaged data) |
| after (`v16-*`) | 16.0.0 | same Debug configuration, only the package line changed |
| `windows-v16-*` | 16.0.0 | Debug `net10.0-windows10.0.19041.0`, unpackaged `win-x64` |

## Device / environment

- Android emulator `emulator-5554` (`bos_shots` AVD): Pixel-class, Android API 36,
  x86_64, 1080×2400. Light and dark themes via `cmd uimode`.
- Windows 11 desktop: unpackaged Debug run (`BibleOnSite.exe`).

## Dialogs exercised (shared `AppDialogPopup` presenter)

- `DisplayAlertAsync` — one-action information alert (Contact → WhatsApp launch
  failure on Android): "שגיאה / לא ניתן לפתוח את וואטסאפ. נסו שוב / אישור".
- `ExitConfirmation` — two-action destructive confirmation via system Back at the
  reader root: "תנ"ך על הפרק / צא מהתכנית / המשך לקרוא" — also re-captured under
  Android larger font scale.
- Underlying page kept visible so scrim, card corners, margins and surround are
  distinguishable; native `uiautomator` dumps confirmed popup/card bounds and
  RTL action order (dismissal first, destructive last).

## Pixel comparison (v15 → v16, sampled points)

| Sample | v15 light | v16 light | v15 dark | v16 dark |
|--------|-----------|-----------|----------|----------|
| left rim (surround) | 146,146,146 | 146,146,146 | 91,91,91 | 91,91,91 |
| right rim (surround) | 47,47,47 | 51,51,51 | 8,8,8 | 9,9,9 |
| top rim (surround) | 146,146,146 | 146,146,146 | 87,87,87 | 87,87,87 |
| top-left corner arc | 124,124,124 | 124,124,124 | 15,15,15 | 15,15,15 |
| scrim midpoint | 127,127,127 | 127,127,127 | 22,22,22 | 22,22,22 |
| card surface | 255,255,255 | 255,255,255 | 45,45,45 | 45,45,45 |

Surround pixels are the scrim-dimmed page, never opaque black (0,0,0 or the
dark-theme popup default). Card surface matches `Surface`/`SurfaceDark`.

## Platform coverage

- **Android** — fully verified (light + dark, alert + destructive/exit,
  larger text). No surround regression.
- **Windows** — v16 build clean (0 warnings/0 errors); app launches and the
  reader, flyout, Preferences and Contact pages render correctly. The shared
  popup was not reachable through in-app flows in this environment: the exit
  confirmation is Android-only by design (`DesktopBackRoute.Consume` at root,
  title-bar Back disabled), the extension-pack removal dialog needs content
  packs that are not installed, and MAUI's Windows `Launcher.OpenAsync`
  returns `false` rather than throwing, so the Contact launch-failure alerts
  cannot fire. Popup layer is the same toolkit control verified on Android.
- **iOS / MacCatalyst** — not verifiable on a Windows host; recorded as
  unverified targets.
