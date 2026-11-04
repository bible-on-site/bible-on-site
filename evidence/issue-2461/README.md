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

## Clean-install pass

Same APK, `adb uninstall` + reinstall (shared_prefs contained only
`lastLearntPerek` — no font keys at all, so all defaults apply):

- `shots/clean-install-display-preferences.png`: master 100, פסוקים 100 →
  גודל בפועל 18, פירושים 100 → גודל בפועל 18 (מאמרים shows 16 — its own
  base size).
- `shots/clean-install-perek-perush-parity.png`: perek reader with inline
  תרגום יונתן at defaults — single-line pasuk row bounds 66px vs perush
  row 64px; body ink pasuk ≈ 50px (Taamey D incl. taamim) vs perush ≈
  47px. Equal effective size, no perush inflation.
- `shots/perush150-perek.png`: the complementary direction — פירושים 150%
  (pasuk% 100) scales only the commentary: perush body ink ≈ 72px vs 47px
  baseline (≈1.5×) while pasuk rows stay 66px / ink 50px. The categories
  are independent in both directions.

## Device matrix

| Build | Source | Result |
| ----- | ------ | ------ |
| Reported Android `5.0.210` (owner device, 2026-11-01) | store build | perushim larger than pesukim — predates both #2692's rendering fix and this fix |
| Latest released Android `app-v5.1.7` (tagged 2026-11-04) | `origin/master` | still carries the defect — `ParashaViewModel.cs:343` reads bare `FontFactor`; no released build ships this fix yet |
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
