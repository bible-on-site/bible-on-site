# Blocking Dialogs — Shared Contract (#2630)

Every app-controlled **blocking dialog** (alerts, confirmations, destructive
confirmations, the exit prompt) goes through one presenter so action order,
colors, header styling, radius/surface and typography cannot drift between
call sites.

## Entry points

| Layer | API | Use |
| ----- | --- | --- |
| `IAppNavigator` | `DisplayAlertAsync` | One-button information/error alert (אישור) |
| `IAppNavigator` | `DisplayChoiceAsync` | Non-destructive two-choice confirm (theme-blue affirmative) |
| `IAppNavigator` | `DisplayDestructiveChoiceAsync` | Destructive two-choice confirm (red affirmative) |
| `AppDialogs` | `ShowAsync(AppDialogRequest)` | Full request form (custom AutomationIds, e.g. the exit prompt) |

View-models inject `IAppNavigator`; page code-behind uses
`ShellAppNavigator.Instance`. Never call `Page.DisplayAlertAsync` /
`DisplayActionSheet` directly — a source-scan unit test fails the build if a
call site bypasses the shared path. The only native call left is the
documented bootstrap fallback inside `AppDialogs.NativeFallbackAsync` (used
before the Shell installs the styled presenter or when no window can host a
popup).

`AppShell` installs the styled presenter at startup:
`AppDialogs.UsePresenter(Controls.AppDialogPopup.ShowAsync)`.

## Action roles and result mapping

`AppDialogActionRole` carries the meaning — never the Hebrew label or the
argument position:

| Role | Meaning | Text color | Example |
| ---- | ------- | ---------- | ------- |
| `Cancel` | Dismissal keeping current state | theme blue (`Primary`/`PrimaryLight`) | ביטול, המשך ללמוד |
| `Acknowledge` | Single alert action | theme blue | אישור |
| `Confirm` | Non-destructive affirmative | theme blue | עבור ל… |
| `Destructive` | Destructive affirmative | red (`Error`/`ErrorDark`) | הסרה, צא מהישומון |

Colors are **foreground text** — never colored button backgrounds (#2460).
`ConfirmAsync` resolves `true` only when the affirmative role is returned;
outside-tap, system Back and a missing presenter all resolve `null` → `false`
(never a false accept, never a removal on dismissal).

## Ordering (RTL)

Logical order is **dismissal first, affirmative last**. The action row
inherits the dialog's RTL flow direction — it must not override it — so in the
Hebrew UI the dismissal renders at the right edge (reading start) and the
affirmative at the left edge (reading end). That mirrors Android/iOS Hebrew
native alerts (positive at the end of the reading direction) and stays correct
if the layout is ever measured left-to-right. If actions ever wrap/stack, the
same sequence continues top-to-bottom.

This made the exit prompt swap visual sides: המשך ללמוד now sits at the right
(reading start, like every cancel) and צא מהישומון at the left — identical to
how הסרה/ביטול render in the removal confirmations.

## Surface and typography tokens

`AppDialogStyle` centralizes the tokens; `Controls/AppDialogPopup.xaml` binds
them:

- Card: `Surface`/`SurfaceDark`, transparent stroke, `RoundRectangle 12`,
  padding 24 — no painted shadow (the uniform scrim
  `AppDialogStyle.ScrimColor`, 50% black, supplies the elevation cue and
  avoids platform double-shadow artifacts).
- Title 20 bold (`Gray900`/`White`), message 16 (`Gray600`/`Gray300`),
  action 16 — UI font tokens, not scripture/perush percentage settings.
- Adaptive width `min(pageWidth - 48, 400)`; message scrolls inside a
  `max(45% pageHeight)` region so actions never clip at large font scales.
- AutomationIds: `{prefix}Card|Title|Message` plus per-action ids
  (`{prefix}{Role}`, or explicit). The exit prompt keeps
  `ExitConfirmationStay`/`ExitConfirmationExit` for the Android e2e suite.

## Modal correctness

- Outside tap / Back / Escape dismisses to the safe outcome.
- `ResolveAsync` resolves once — rapid double taps cannot double-submit a
  destructive action.
- `ExitConfirmation` keeps its one-prompt guard (#2460): repeated Back presses
  while the dialog is up are swallowed.
- Picker/content-sheet popups (`PerekPickerPopup`, `MasoraUnitPickerPopup`,
  `ParashaUnitPickerPopup`) stay their own surfaces — they share the design
  language without being forced into this interaction model. OS-owned
  permission/system dialogs remain native.

## Caller inventory (migrated)

| Call site | Dialog | Path |
| --------- | ------ | ---- |
| `ExtensionPacksViewModel` | Remove perushim pack (destructive), removal/download errors | `IAppNavigator` |
| `RecitationPacksViewModel` | Remove all / one book recordings (destructive) | `IAppNavigator` |
| `SupportPreferencesViewModel`, `PerekViewModel`, `ParashaViewModel.Perushim`, `MasoraViewModel.Perushim`, `AccessibilityStatement` | Error alerts | `IAppNavigator` |
| `ExitConfirmation` | Exit/stay (destructive) | `AppDialogs` via `SharedPrompt` |
| `ParashaPage` | Festival-Shabbat reading confirm (non-destructive) | `ShellAppNavigator` |
| `PerekPage`, `ParashaPage` (recitation, search), `ContactPage`, `TanahpediaEntryPage`, `TosPage` | Error/info alerts | `ShellAppNavigator` |
