# Platform Back/Up navigation policy (#2467)

This document records the researched platform guidance, the app's observed
state, and the resulting policy for Back/Up navigation chrome. Implemented by
`Helpers/BackChromePolicy.cs` (pure rule), `Helpers/BackChrome.cs` (applier),
`AppShell` (applies on every navigation and on preference changes), the
Windows `TitleBar` in `App.CreateWindow`, and the Android override in
Preferences → תצוגה.

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
- Custom-chrome pages that hide the Shell nav bar render their own "חזור"
  (`→`) button when pushed: `ArticlesPage`, `ArticleDetailPage`,
  `TanahpediaEntityTypePage`, `TanahpediaEntryPage`.
- Secondary pages (Preferences tree, תנאי שימוש, יצירת קשר, תרומות, Parasha
  reader) keep the Shell nav bar and showed the platform arrow on all
  platforms.
- Root/flyout pages (`AuthorsPage`, `TanahpediaPage`, `LearningCalendarPage`,
  `ParashaListPage`) already hide the arrow via `BackButtonBehavior`.
- Windows had no title-bar Back; Alt+Left existed inside the reader only.

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
   handlers (they participate first in the shared ordering).
5. Root flyout destinations keep `BackButtonBehavior IsVisible="False"`;
   `BackChrome.Apply` re-evaluates on each `Navigated` event and on every
   `PreferencesChanged`, so the choice applies to open and future pages.

## Exceptions

- `PerekPage` manages `BackButtonBehavior` itself for its search overlay and
  hides the nav bar; the policy only reaches its in-content chrome via the
  shared names, which the reader does not use.
- `TanahpediaEntryPage`'s "חזרה לתנכפדיה" recovery button on the
  not-found state is content, not Back chrome — always visible.
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
