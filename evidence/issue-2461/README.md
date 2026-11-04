# Issue #2461 — Parasha reader ignores the פסוקים category percent

## Defect (before)

The parasha reader (`ParashaViewModel`) resolved row sizes from the bare
master `PreferencesService.FontFactor`. The perek and masora readers already
use `PasukFontFactor` (master × category %), so dragging the פסוקים slider
scaled every reader except פרשה על הפרק — pasuk rows stayed at the master
size while perushim honored their own category, which is what made
commentary look out of proportion with scripture.

`shots/before-parasha-pasuk150.png`: פסוקים 150% (master 1.0) — pasuk rows
still render 18sp (single-line row bounds 66px ≈ 18sp × 1.4 × 420dpi),
while `shots/perek-pasuk150-control.png` shows the same preference scaling
the perek reader to 27sp (bounds 186px).

## After

`ParashaViewModel` now syncs `_fontFactor`/`FontFactor` from
`PasukFontFactor` — the same effective פסוקים factor the other readers use —
at construction and inside `RefreshPreferences`. Loaded rows rebuild through
the existing `RebuildLoadedRowsAsync` path when the category changes.

`shots/after-parasha-pasuk150.png`: same פסוקים 150% session — parasha rows
now render 27sp (bounds 186/274px), matching the perek reader.

`shots/after-parasha-100-perush-parity.png`: 100%/100% with inline תרגום
יונתן — pasuk body ink ≈ 49px, perush body ink ≈ 47px on 420dpi: apparent
sizes are equivalent, no 90% commentary hack. The effective-size labels
(`shots/display-preferences-effective-18.png`) honestly report 18/18.

## Device matrix

| Build | Source | Result |
| ----- | ------ | ------ |
| Debug APK `5.1.6` (versionCode 50100006), branch `fix/2461-font-size-relative` | this worktree | pasuk%150 → parasha 27sp, perush%100 → 18sp |
| Emulator `sdk_gphone64_x86_64`, Android 15 (API 36), 1080×2400, 420dpi, font scale 1.0 | — | measurements from uiautomator bounds + PNG ink analysis |

**Pending — required by `app-deployment` policy:** Android changes must be
verified on the physical device (ADB wireless pairing), not the emulator.
No physical device was reachable during this round, so the emulator
captures above are supplementary evidence only. Physical-device before/
after and an iOS capture remain open.

Note: `adb install` does **not** clear Fast Deployment overrides —
`files/.__override__/x86_64/*.dll` shadows the APK's bundled assemblies on
this debug build. A stale override dll made an earlier verification round
look as if the fix had not shipped; `.__override__` was refreshed with the
built assemblies before the after-shots were taken.

iOS: not captured in this round — the iOS handler already multiplies by
`EffectiveFontSize` (`Platforms/iOS/Handlers/HtmlViewHandler.cs`), and the
ParashaViewModel change is platform-agnostic.
