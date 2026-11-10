# Issue #3252 evidence — Windows UI Automation + visuals

Tappable rows/cards/links migrated from `TapGestureRecognizer` containers to
`TappableView`, whose Windows platform view is a native WinUI `Button`.

## UIA validation (FlaUI probe, UIA3)

Verified on the running Windows app (`uia-probe` output):

- `PrivacyPolicyLink` — `ControlType=Button`, `InvokePattern`, `LegacyIAccessiblePattern`,
  `Focusable=True`, Hebrew automation name `פתיחת מדיניות הפרטיות המלאה באתר התכנית`
- `SettingsDisplayRow` / `SettingsPerekRow` / `SettingsPacksRow` /
  `RecitationSettingsRow` / `SettingsSoundRow` — all `Button`, `InvokePattern`,
  keyboard-focusable, correct Hebrew names
- `PerekTodaysOption` / `PerekLastLearntOption` — `Button` + `InvokePattern`
- Keyboard: `Focus()` lands on `SettingsDisplayRow`, `Tab` advances to
  `SettingsPerekRow` (focus rectangle visible in
  `after-preferences-keyboard-focus.png`)
- `Invoke()` on `SettingsPerekRow` navigates to the perek preferences page —
  end-to-end activation works

## Screenshots

- `after-preferences-rows.png` — settings rows render as before: Hebrew text,
  icons right, chevrons left, no native chrome bleed
- `after-preferences-keyboard-focus.png` — WinUI focus rectangle on the
  keyboard-focused row
- `after-perek-preferences.png` — migrated option cards/radio rows intact
- `after-terms-links.png` — migrated underlined links without button chrome
- `during-grey-chrome.png`, `during-terms-grey-chrome.png` — mid-work
  regression: default WinUI button fill painted a grey bar behind content
  (fixed by per-instance `ButtonBackground*` resource overrides)
- `during-flowdirection-bug.png` — mid-work regression: hosted content's
  flow direction differed from the button's, so WinUI mirrored the content's
  render rect off-window (fixed by pinning both to the resolved direction)
