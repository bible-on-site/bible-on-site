# Windows desktop UX (#2766)

The Windows build shares the touch-first MAUI layouts with mobile. This
document records the desktop input model, the adaptive column rules, the
defects found in the usability audit, and what is deferred to later
increments.

## Keyboard and pointer model

| Input | Behavior |
| --- | --- |
| `Alt+Left` | Shared Back pipeline (same as title-bar Back and mouse Back). |
| Mouse X1 (Back) button | Same Back pipeline. X2 is ignored (no forward navigation). |
| `Esc` | Peels the topmost transient surface only — never navigates, never exits. |
| `Ctrl+F` | Opens/re-focuses the in-page search on Perek and Parasha readers. |
| `F11` | Toggles the reader fullscreen presentation on Perek, Parasha and Masora (`IWindowsFullscreenSurface`); `Esc`/Back still exit it first. Ignored while the flyout is open or on non-reader pages. |
| `Tab` / `Enter` / `Space` | Flyout rows are native WinUI buttons on Windows — focusable, activatable, with hover/pressed/focus visuals and automation names. |

Back ordering (title-bar button, `Alt+Left`, mouse Back — one pipeline in
`Platforms/Windows/DesktopWindowChrome.cs` → `DesktopInputPlan`):

1. Open blocking dialog (`AppDialogPopup.TryDismissTopmost`) → close it
   with the safe-dismiss result.
2. Open shell flyout *overlay* → close it. A locked nav pane is
   persistent chrome, not an overlay — it never consumes Back.
3. Page's topmost transient surface (`IWindowsDesktopSurface.DismissTopmostSurface`):
   reader pages peel fullscreen → picker popup → open fan menu → options
   menu → search → pasuk selection/recitation state.
4. In-app Shell navigation (with the exit confirmation handled by the
   existing `#2467`/`#2460` pipeline — keyboard Back never exits the app).

`Esc` runs steps 1–3 only and consumes the press when something was
dismissed. `Ctrl+F` routes to `IWindowsSearchSurface` on the reader pages.

The per-page `*WindowsBack.cs` partials (Alt+Left + focus wiring,
triplicated across Perek/Parasha/Masora) were replaced by the shared
`DesktopWindowChrome` layer plus the `IWindowsDesktopSurface`/
`IWindowsSearchSurface` page contracts. Initial focus lands on the page's
navigation button after each Shell navigation.

## Adaptive navigation pane

Above `DesktopLayout.NavPaneBreakpoint` (1008 dips of window content
width — WinUI's own expanded-pane threshold) the Shell flyout locks into
a persistent navigation pane beside the content; below it the flyout
returns to a transient overlay. The decision logic lives in
`Helpers/DesktopNavPlan.cs` (pure, unit-tested) and is applied by
`AppShell.ApplyNavPaneWidth` on attach and on every window resize.

- Wide ↔ narrow crossings keep the user's collapse choice: widening
  restores the remembered pinned/collapsed state (an overlay open during
  the crossing counts as reveal intent and lands pinned); narrowing lands
  with the overlay closed.
- The shared hamburger is adaptive: it toggles the locked pane between
  the expanded pane and the collapsed icon rail, and opens the overlay
  in narrow mode (on touch it stays unreachable while the overlay covers
  it, so a press still always opens).
- The collapse choice persists across launches
  (`Preferences["BibleOnSite.WindowsNavPanePinned"]`, Windows only).
  WinUI's locked pane materializes open and can sync `FlyoutIsPresented`
  back to true after the state was applied — the Shell clamps it back to
  collapsed while the remembered choice is collapsed
  (`AppShell.OnShellPropertyChanged`).
- The current destination is highlighted on the pane rows
  (`FlyoutMenuState.CurrentDestination` → per-row `IsSelected`, resolved
  from `CurrentState.Location` via the `AppRoutes` map so registration
  and selection cannot drift) and exposed to screen readers as UIA
  `ItemStatus` (`נבחר` — a `Button` has no SelectionItem pattern).
- A page-level `FlyoutBehavior.Disabled` override (reader selection /
  open search) still wins; on exit the page returns to the ambient
  adaptive behavior instead of forcing Flyout.

## Window behavior

- Minimum window size 460×560 dips.
- First run opens at 1140×840 centered in the work area.
- Bounds + maximized state persist across launches
  (`Preferences["BibleOnSite.WindowsWindowPlacement"]`, `"x,y,w,h|m"` in
  dips); a saved position is kept only when it still intersects a
  connected display, otherwise it is clamped to the primary work area.
- The normal (non-maximized) frame is tracked while running so a
  maximized close restores maximized with the previous normal rect.
- Stacking is ordinary overlapped by default; the Windows-only
  always-on-top opt-in (Preferences → תצוגה) is the single switch that
  moves the window into the topmost band, applied immediately and
  persisted (see increment 4).

## Layout rules

Caps live in `Helpers/DesktopLayout.cs` and apply on Windows only (other
platforms keep `Fill`):

| Constant | Applies to |
| --- | --- |
| `ReaderColumnMaxWidth` (920) | Scripture columns in Perek/Parasha/Masora carousel pages; expanded search results panel. |
| `ReaderBarMaxWidth` (560) | Floating reader bottom bar (its actions were scattered to window edges). |
| `ReaderSheetMaxWidth` (760) | Perushim bottom sheet. |
| `ContentColumnMaxWidth` (960) | Article detail, Tanahpedia entry, Preferences card. |
| `NavPaneBreakpoint` (1008) | Window width at which the flyout locks into the persistent nav pane. |

`PointerOver` in the shared Button/ImageButton styles now dims to 0.85 —
touch platforms never enter that state.

Reader Back additionally peels the perek/unit picker and the open fan
menu after fullscreen but before menu/search/selection — the pickers
previously fell through to page navigation while still visible (all
platforms benefit).

## Audited defects addressed in this increment

Observed on the pre-change build (master `55797a0`) with UIA + window
rect measurements:

- Flyout destination rows surfaced as `ControlType.Text`/`Custom` with
  `IsKeyboardFocusable=false` — `TapGestureRecognizer` grids: not tab
  stops, no Enter/Space activation, no focus visual, no automation name.
  Now `ControlType.Button`, focusable, with `title, subtitle` names.
- The window opened at the unmanaged OS default — measured 3072×807
  (full monitor width) — and never restored size or position. It now
  opens at 1140×840 centered, clamps resize to a 460×560 minimum, and
  persists bounds + maximized state across launches.
- Icon-only reader controls reported empty UIA names
  (`FullScreenButton`, `ArticlesButton`, `PerekPickerButton`,
  `NextPerekButton`, `PrevPerekButton`, `TodayButton`,
  `PerushimChevronButton`): no automation name, no tooltip. All now
  carry Hebrew descriptions and pointer labels.
- `Esc` did nothing anywhere (verified: the open flyout ignored it —
  pixels unchanged). Now shared dismissal of flyout + page surfaces.
- Alt+Left wiring was triplicated per reader page with fragile
  lifecycle bookkeeping; picker popups and the open fan menu were not in
  any Back chain (Back navigated away underneath them).
- Maximized window stretched scripture, the perushim sheet, search
  results, articles and preferences edge-to-edge; the bottom bar's
  proportional offsets pushed its actions to the window corners.

## Audited defects addressed in increment 2

Observed on master `e6787d9` (Windows Server 2022, 100% scale, 1140×840
window) with UIA tree dumps of the running Debug build:

- The native `NavigationView` pane toggle stayed in the title bar as a
  second menu button with the English UIA name `Open Navigation`, next
  to the shared top-bar hamburger, and swapped sides with the title-bar
  Back between root and pushed pages. It is now kept hidden
  (`DesktopWindowChrome.OnShellHandlerChanged`); the shared hamburger is
  the single menu entry point.
- Every `CollectionView`/`CarouselView` row (each pasuk, article, list
  and calendar row) was announced by UIA/Narrator as
  `Microsoft.Maui.Controls.Platform.ItemTemplateContext`. Rows now get a
  name composed from their own visible text
  (`Platforms/Windows/ListItemAutomationNames.cs` +
  `Helpers/AccessibleItemText.cs`), rebuilt on container recycling;
  nested buttons keep their own names.
- The inactive title-bar Back at a navigation root rendered as a filled
  grey tile (shared Disabled style) — the heaviest glyph in the title
  bar. It is now a transparent, dimmed glyph.
- The fullscreen action had no keyboard shortcut; `F11` now toggles it
  and the tooltips advertise `F11` / `Esc`.

## Audited defects addressed in increment 3

Nav-pane, overlay, highlight and fullscreen behaviors verified on the
Debug build at 125% display scale with UIA bounds and screenshots; the
dialog-dismissal ordering is unit-level reviewed code (live dialog
triggering needs a real pointer on tap-gesture rows):

- A wide window kept navigation behind a transient flyout — the pane now
  locks open beside the content (≈375 px rows) and collapses to a 60 px
  icon rail on hamburger press; the choice persists across restarts.
- The nav pane gave no sense of place — the current destination now
  paints the Fluent-style accent indicator and reports `נבחר` as UIA
  `ItemStatus`; the marker follows detail pages pushed inside a
  destination (deepest route segment owns the highlight).
- `Esc`/Back ignored the shared blocking dialogs — both now peel an open
  `AppDialogPopup` first (a weak-reference open-dialog registry) before
  overlay/page surfaces, and the card carries its own `Escape`
  accelerator for focus inside the dialog.
- The floating exit-fullscreen circle was a draggable `Border` — no tab
  stop, no keyboard activation, no UIA button role. It is now a native
  WinUI `Button` (`ReaderExitFullscreenButtonHandler`): focusable,
  Enter/Space invocable, with its drag-to-reposition preserved on raw
  pointer events (a press that travels past the slop becomes a drag and
  its trailing Click is suppressed).
- The hamburger was open-only; on a locked pane a press had no collapse
  path. It now toggles the pane/overlay through `IAdaptiveNavPane`.
- A collapsed locked pane silently reopened on startup — WinUI's locked
  presenter materializes open and syncs `FlyoutIsPresented` back to
  true; the Shell now clamps the drift while the remembered choice is
  collapsed (verified: restart restores the icon rail).

## Audited defects addressed in increment 4

Owner acceptance criteria for the newest pass: one Windows Back control
whenever history exists, and ordinary window stacking by default behind a
clearly labelled Windows-only always-on-top opt-in.

- **Duplicate Back.** UIA dumps on a pushed page showed *two* enabled Back
  buttons: the title-bar `TitleBarBackButton` and the native WinUI
  `NavigationViewBackButton`. The earlier `BackChromePolicy` carve-out was
  insufficient because `BackChrome.Apply` only writes
  `BackButtonBehavior` while `Shell.GetNavBarIsVisible(page)` is true, and
  every destination sets `NavBarIsVisible=false` — so the Shell toolbar
  state that drives the native arrow was never touched. The suppression
  now lives at the platform layer
  (`DesktopWindowChrome.OnShellHandlerChanged`): once the Shell handler's
  `NavigationView` materializes, MAUI's `Toolbar→IsBackButtonVisible`
  binding is severed (`ClearValue`), the arrow is pinned
  `Collapsed`, and a property-changed callback re-clamps any later
  template/toolbar re-show — the same pattern already used for the pane
  toggle. Verified on the running build: root shows only the disabled
  title-bar Back; pushed Tanahpedia/Preferences pages show only the
  enabled title-bar Back; returning to root disables it again. The
  title-bar button, `Alt+Left` and mouse Back all still ride the shared
  `RunBack()` ordering.
- **Window stacking.** Windows had no always-on-top control at all and no
  documented stacking contract. Ordinary overlapped stacking is now the
  explicit default, and Preferences → תצוגה gained a Windows-only
  **"תמיד מעל חלונות אחרים"** switch (off by default, persisted under the
  non-synced `alwaysOnTop` key so it never leaks to other platforms or
  reinstalls). WinUI 3 exposes no managed topmost API, so
  `Platforms/Windows/WindowZOrder.cs` applies the choice with
  `SetWindowPos`/`HWND_TOPMOST|HWND_NOTOPMOST` (`SWP_NOACTIVATE` — it never
  steals focus or raises the window). `DesktopWindowChrome` applies the
  stored value once the platform HWND exists, re-applies on every
  `PreferencesChanged` (immediate toggle), and force re-asserts after a
  presenter swap so fullscreen/presenter transitions restore the chosen
  band. Verified at runtime via `WS_EX_TOPMOST`: absent key → not topmost;
  `alwaysOnTop=True` → topmost after relaunch; `alwaysOnTop=False` →
  ordinary stacking restored.

## Deferred

- Per-page layout beyond column caps (learning calendar, corpus search
  grids, list pages), and the bottom-bar's absolute layout redesign.
- `Ctrl+F` on non-reader pages, XButton2, arrow-key pasuk navigation.
- Full Narrator/Accessibility Insights pass (increments 2–3 fixed the
  UIA names/roles found in tree dumps) and keyboard focus *containment*
  inside popups.
- Windows display-scaling matrix (100/125/150/200%) and text-scaling
  verification; wheel-scroll audit of the reader carousel.
- Preferences settings rows (`SettingsDisplayRow`, `SettingsPerekRow`,
  `SettingsPacksRow`, `RecitationSettingsRow`, `SettingsSoundRow`,
  `SettingsSupportRow`) are `TapGestureRecognizer` grids surfacing to UIA
  as `ControlType.Pane` with no Invoke/Legacy pattern — not tab stops and
  not keyboard-activatable, unlike the flyout rows fixed in increment 1.
  They need the same button-ification pass (or an equivalent focusable
  row control) to satisfy keyboard-only navigation on the settings pages.
- Live verification of gesture-driven controls (settings rows, in-page
  tap targets) from an automated session: `SendInput`/`mouse_event`/
  `PostMessage` injection did not reach MAUI `TapGestureRecognizer`s or
  `KeyboardAccelerator`s in the audit environment, and those rows expose
  no UIA invoke pattern — so toggle/apply behavior on them was verified
  at the persistence + platform-API level (`WS_EX_TOPMOST`, unit tests)
  rather than by a synthesized pointer press. A physical-input pass is
  still owed for the remaining gesture surfaces.
