# Platform Back/Up navigation policy (#2467)

This document records the researched platform guidance, the app's observed
state, and the resulting policy for Back/Up navigation chrome. Implemented by
`Helpers/BackChromePolicy.cs` (pure rule), `Helpers/BackChrome.cs` (applier),
`Controls/SharedTopBar.cs` (the shared navigation capsule),
`AppShell` (applies on every navigation and on preference changes), the
Windows `TitleBar` in `App.CreateWindow`, and the Android override in
Preferences → תצוגה.

## Shared navigation capsule layout contract

`SharedTopBar` is the one top chrome for every ordinary app page: a 56px
band + 1px separator containing, in flow order:

1. **The navigation capsule** — an elliptical pill (40px high, 14px corner
   radius, same chrome as the title pill) holding two separate, labelled
   hit targets:
   - **Hamburger** — always the first control in flow order, so it anchors
     the far-right edge in the app's RTL interface (far-left under LTR).
     Its only job is opening the Shell flyout; it is never repurposed into
     Back/Close.
   - **Back** — the hamburger's immediate neighbour toward the center.
     The slot is *reserved*: at a root destination it stays visible but
     genuinely disabled (`IsEnabled=false` + grey glyph), never
     appearing/disappearing and shifting the hamburger or the title.
     `BackEnabled` derives from exactly one navigation state — the Shell
     back-stack depth plus page-owned transient surfaces reported through
     `BackStateProvider` (focused pasuk, reader menu, open search,
     selection mode, media fullscreen, Tanahpedia in-place entry trail).
2. **The center slot** — title pill or search field (`ToolbarPill`,
   40px/14px radius), identical position on every page.
3. **The trailing slot** — page actions (share, clear), fixed 48px column.

- **Icon direction is resolved exactly once** from the *effective* flow
  direction (the nearest ancestor that explicitly pins LTR/RTL), not the
  device language: RTL → right-pointing arrow, LTR → left-pointing arrow.
  The FluentUI glyphs are not auto-mirrored; the selection in
  `SharedTopBar.BackGlyph` is the single mirroring step, so Hebrew RTL on an
  English device still shows the right-pointing arrow.
- **A disabled Back is non-actionable**: the click handler re-derives the
  live state before routing, so a stale enabled paint can never reach the
  pipeline and skip straight to leaving the app.
- Enabled Back presses route through `IWindow.BackButtonClicked` →
  `AppShell.OnBackButtonPressed` — the same pipeline as system Back, so
  transient surfaces are consumed first and an in-app Back can never exit
  the app.

## Page-family matrix

| Family | Pages | Chrome | Back semantics |
| --- | --- | --- | --- |
| Readers | `PerekPage`, `ParashaPage`, `MasoraPage` | `SharedTopBar` | Capsule Back enabled by `BackStateProvider` while reader surfaces own Back; system Back consumes those surfaces first |
| Focused pasuk | selection/focus bar | Reader chrome | Dismiss rides the shared pipeline; capsule stays enabled while focused |
| Flyout landings | `TanahpediaPage`, `LearningCalendarPage`, `ParashaListPage`, `AuthorsPage`, `ArticlesPage`, `ContactPage`, `DonationsPage`, `TosPage` | `SharedTopBar` | Stack depth decides (flyout routes sit above the preserved reader — Back returns there) |
| Pushed details | `ArticleDetailPage`, `TanahpediaEntityTypePage`, `TanahpediaEntryPage` | `SharedTopBar` | Enabled while pushed; entry page additionally enabled by its in-place entry trail |
| Preferences | `PreferencesPageBase` + all settings pages | Template `SharedTopBar` | Same capsule via `ShowBack` template binding |
| Modals/sheets | dialogs, `ExitConfirmation` | — | Platform dismissal, unchanged — not Back chrome |

## Primary guidance (researched)

- Android, principles of navigation + predictive Back: the app must support
  system Back (button, gesture, predictive) through every surface; an app-bar
  Up control is for hierarchy navigation and must never exit the app.
  https://developer.android.com/guide/navigation/principles
  https://developer.android.com/design/ui/mobile/guides/patterns/predictive-back
- Apple HIG: iOS has no universal system Back; pushed pages need a
  discoverable back affordance plus the standard edge-swipe gesture; modals
  use Close/Done.
  https://developer.apple.com/design/human-interface-guidelines/toolbars
  https://developer.apple.com/documentation/uikit/uinavigationcontroller
- Windows: backward navigation is a title-bar/navigation-chrome control plus
  keyboard accelerators (Alt+Left); a root destination shows it disabled.
  https://learn.microsoft.com/en-us/windows/apps/develop/ui/navigation/navigation-history-and-backwards-navigation
  https://learn.microsoft.com/en-us/windows/apps/design/basics/titlebar-design

## Observed app state (before this change)

- Every Back press on Android already reaches one shared pipeline:
  `MainActivity.AppBackPressedCallback` → `IWindow.BackButtonClicked` →
  `AppShell.OnBackButtonPressed`, which orders fullscreen media dismissal
  (#2117) → page/overlay handling → Shell navigation → root exit
  confirmation (#2118). Predictive-Back-safe because the dispatcher callback
  is always enabled.
- Chrome was fragmented per page family: `SharedTopBar` had only a
  hamburger; `ArticleDetailPage`/`TanahpediaEntryPage` drew their own text
  "→/חזור" headers; `TanahpediaPage`, `TanahpediaEntityTypePage`,
  `LearningCalendarPage` and `ParashaListPage` duplicated `Shell.TitleView`
  hamburger+title grids; `ContactPage`/`DonationsPage`/`TosPage` fell back
  to the native Shell nav bar; preferences used a separate template Back.
- Root Back could not render a disabled state anywhere — pages simply
  omitted the affordance, so chrome widths jumped between root and pushed
  pages.
- Windows had a title-bar Back (#2496); Alt+Left existed inside the reader
  only.

## Decided policy

| Platform | In-app Back/Up control | System/history Back | Exit protection |
| --- | --- | --- | --- |
| Android | Hidden by default; persisted tri-state override (default / show / hide) in Preferences → תצוגה | `OnBackPressedDispatcher` → shared Shell pipeline; predictive Back safe; reader overlays (`ReaderBackCallback`) consume search/selection/fullscreen first | Exit confirmation at root (#2118) |
| Windows | Title-bar Back button (`Window.TitleBar.LeadingContent`), disabled at root; Alt+Left in the reader | `IWindow.BackButtonClicked` → same shared pipeline | Exit confirmation at root |
| iOS / iPadOS / MacCatalyst | Visible in-app control on pushed pages (no universal system Back); native edge-swipe Back preserved (`SharedFlyoutEdgePan` yields above root) | UINavigationController interactive pop + `BackButtonClicked` | Exit confirmation at root |

Rules:

1. One navigation state: every Back input (system, gesture, title bar,
   in-app button, keyboard) lands in `IWindow.BackButtonClicked` /
   `AppShell.OnBackButtonPressed`. No parallel pop handlers.
2. Up is history only. `ShowNavBarBack` returns false at a root destination,
   so no in-app control can exit the app.
3. The Android override is visibility-only: it never disables OS Back,
   gestures, history, or modal dismissal, and is ignored on iOS/Windows (the
   setting UI is Android-only; the policy also ignores it off-Android).
4. Contextual surfaces unchanged: the focused-pasuk selection bar's dismiss
   button, media fullscreen release, search dismissal, flyout, and the
   exit-confirmation dialog are not Back/Up chrome and keep their existing
   handlers (they participate first in the shared ordering — and they are
   exactly the surfaces `BackStateProvider` reports to keep the capsule
   Back enabled at root).
5. `BackChrome.Apply` re-evaluates on each `Navigated` event and on every
   `PreferencesChanged`, so the visibility choice applies to open and future
   pages, and `RefreshBackState` re-derives the enabled state from the live
   navigation stack plus page-owned surfaces.

## Exceptions

- `PerekPage`/`ParashaPage` still manage `BackButtonBehavior` themselves
  for their search overlay state; the capsule inside their `SharedTopBar`
  is the in-app Back surface.
- `TanahpediaEntryPage`'s "חזרה לתנכפדיה" recovery button on the
  not-found state is content, not Back chrome — always visible. Its capsule
  Back rides the shared pipeline, which steps the in-place person trail
  before leaving the page (the same ordering `OnBackButtonPressed` gives
  system Back).
- Windows never shows a capsule Back (`ShowCapsuleBack`): the title bar
  owns Back there, so an in-content button would be a second Windows Back.
- `#2460` owns the exit-confirmation/blank-screen policy; this change does
  not alter it.

## Persistence

`PreferencesService.InAppBackButton` → key `inAppBackButton` (int). Unset or
unrecognized stored values resolve to `PlatformDefault`. Renaming the
setting later requires migrating the key; values are forward-compatible.

## Validation notes

- Unit coverage: `BackChromePolicyTests` (per-platform × preference matrix,
  root-suppression rule) and `PreferencesServiceTests` (persistence +
  fallback for stale values).
- Platform checks to run on hardware: Windows title-bar click/drag
  (unverifiable from CI, which cross-builds only), Android button + gesture +
  predictive Back against the three preference states, iPhone/iPad arrow +
  edge swipe + modal dismissal.
