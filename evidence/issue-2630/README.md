# Issue #2630 — Unified blocking dialogs: before/after captures

Android emulator captures (1080x2400, light theme) for the two dialog flows
called out in the issue, taken on `emulator-5554`.

`before` shots were captured on `master` (`d3ed3f304`); `after` shots on the
PR head build.

## Perushim pack removal (destructive confirmation)

| Before | After |
| --- | --- |
| `remove-perushim-before.png` | `remove-perushim-after.png` |

- **Before:** native `DisplayAlert` — platform alert chrome, `android:id/button1`
  (`הסרה`) / `android:id/button2` (`ביטול`), OS typography and colors, no app
  header styling.
- **After:** the shared `AppDialogPopup` — app surface/radius/typography tokens,
  scrim, `ביטול` (safe, primary) at reading start and `הסרה` (destructive, red
  text) at the reading end. The uiautomator dump
  `remove-perushim-after-uiautomator.xml` shows the `AppDialogCard` /
  `AppDialogTitle` / `AppDialogMessage` / `AppDialogCancel` /
  `AppDialogDestructive` ids.

## Exit confirmation

| Before | After |
| --- | --- |
| `exit-confirmation-before.png` | `exit-confirmation-after.png` |

- **Before:** bespoke `ExitConfirmationPopup` — `המשך ללמוד` (safe) rendered on
  the left and `צא מהישומון` (red) on the right of a hard-coded LTR action row.
- **After:** the same prompt through the shared presenter — the action row now
  inherits the dialog's RTL flow, so `המשך ללמוד` sits at reading start (right)
  and `צא מהישומון` at the reading end (left), the same mirrored placement
  native Hebrew alerts use. AutomationIds (`ExitConfirmationStay` /
  `ExitConfirmationExit`) are unchanged so the e2e suite still targets the same
  elements; `exit-confirmation-after-uiautomator.xml` is the live dump.
