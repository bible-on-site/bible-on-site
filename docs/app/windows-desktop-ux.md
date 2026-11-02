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

1. Open shell flyout → close it.
2. Page's topmost transient surface (`IWindowsDesktopSurface.DismissTopmostSurface`):
   reader pages peel fullscreen → picker popup → open fan menu → options
   menu → search → pasuk selection/recitation state.
3. In-app Shell navigation (with the exit confirmation handled by the
   existing `#2467`/`#2460` pipeline — keyboard Back never exits the app).

`Esc` runs steps 1–2 only and consumes the press when something was
dismissed. `Ctrl+F` routes to `IWindowsSearchSurface` on the reader pages.

The per-page `*WindowsBack.cs` partials (Alt+Left + focus wiring,
triplicated across Perek/Parasha/Masora) were replaced by the shared
`DesktopWindowChrome` layer plus the `IWindowsDesktopSurface`/
`IWindowsSearchSurface` page contracts. Initial focus lands on the page's
navigation button after each Shell navigation.

## Window behavior

- Minimum window size 460×560 dips.
- First run opens at 1140×840 centered in the work area.
- Bounds + maximized state persist across launches
  (`Preferences["BibleOnSite.WindowsWindowPlacement"]`, `"x,y,w,h|m"` in
  dips); a saved position is kept only when it still intersects a
  connected display, otherwise it is clamped to the primary work area.
- The normal (non-maximized) frame is tracked while running so a
  maximized close restores maximized with the previous normal rect.

## Layout rules

Caps live in `Helpers/DesktopLayout.cs` and apply on Windows only (other
platforms keep `Fill`):

| Constant | Applies to |
| --- | --- |
| `ReaderColumnMaxWidth` (920) | Scripture columns in Perek/Parasha/Masora carousel pages; expanded search results panel. |
| `ReaderBarMaxWidth` (560) | Floating reader bottom bar (its actions were scattered to window edges). |
| `ReaderSheetMaxWidth` (760) | Perushim bottom sheet. |
| `ContentColumnMaxWidth` (960) | Article detail, Tanahpedia entry, Preferences card. |

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

Known gap: the floating exit-fullscreen control is a draggable `Border`,
not a tab stop; keyboard users exit with `Esc`, `F11` or `Alt+Left`.

## Deferred

- Exit-fullscreen control as a focusable button (needs to keep its drag
  behavior).

- Adaptive *navigation* model: locking the flyout into a nav pane at wide
  widths (collapse/reveal state preserved), selected-destination
  highlight in the flyout.
- Per-page layout beyond column caps (learning calendar, corpus search
  grids, list pages), and the bottom-bar's absolute layout redesign.
- `Ctrl+F` on non-reader pages, XButton2, arrow-key pasuk navigation.
- Full Narrator/Accessibility Insights pass (increment 2 only fixed
  the UIA names found in tree dumps) and keyboard focus *containment*
  inside popups.
- Windows display-scaling matrix (100/125/150/200%) and text-scaling
  verification; wheel-scroll audit of the reader carousel.
- `Esc` on `AppDialogPopup`-hosted dialogs (CommunityToolkit popup).
