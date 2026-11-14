# Broad-catch remediation ledger (#2572)

Tracks every broad exception handler annotated by #2569 — each site's stable
identity, the catch's real contract, the verdict, and the test evidence.

## Reconciled inventory

The #2569 numbers never described the source:

| Number | What it actually was |
|--------|----------------------|
| 97 | accepted *review threads* classed "generic catch clause" (89 app + 8 devops) |
| 6 | sites narrowed during #2569 |
| 91 | PR-summary arithmetic (97 - 6) — counted threads, not sites |
| 87 | audit-doc count of annotated boundaries — thread-level dedupe explains the 4-site gap |
| **140** | **actual source sites needing audit: 131 unfiltered `catch(Exception)` + 1 bare `catch` in `app/BibleOnSite`, 7 bare `catch` + 1 `catch(Exception)` in `app/devops`** |

Verified identical at the pinned #2569 head `92346bf8` and main `79e4888f`:
the thread count under-reported the surface because SonarQube groups multiple
sites per file/method into one finding, and the annotation tool suppressed
*every* broad catch in the tree, not only flagged ones. A further 24 catches
carry `when` filters and are already narrow (spot-checked per batch).

## How to read the table

- **Site** — file + line at audit start; sites may move, match by method.
- **Reason** — the //NOSONAR justification the annotation tool stamped.
- **Disposition** — batch + verdict. A retained boundary keeps its pragma
  pair; a repaired site drops both annotations and gains fault coverage.

## Audit outcome (all 140 sites)

- **6 repaired** — `ArticleService` ×3 (transport failures now propagate to
  `ArticleDetailPage`'s real error surface instead of falsifying to
  empty/null) and `ContactPage` ×3 (launcher failures now alert the user,
  matching `TosPage`/`AccessibilityStatement`).
- **4 narrowed/fixed** — `PreferencesService` (catch-all → `JsonException`,
  logged instead of silent data loss), `MainPage` (try scope narrowed to the
  risky call), `AppConfig`/`FloatingSearchBar` (duplicated pragma pairs
  deduped), `ExitConfirmation` (false documented reason corrected), plus
  `FloatingSearchBar`'s copy-pasted reason fixed and `StarterService` ×4
  upgraded to full-exception logging.
- **~130 verified-retained** — each row carries its contract: layered
  degradation (required → `ErrorMessage`/alert; secondary → drop/log),
  probes (`false`/`null` = unavailable), diagnostics→report-lines, cosmetic
  best-effort, cancellation/cleanup, or platform boundaries.
- **Weak-feedback class** — log-only user-initiated taps (article-select,
  settings nav) retained as retryable; flagged for the issue's discussion.

## Unfiltered sites — production app (132)

| Site | Member | Reason | Disposition |
|------|--------|--------|-------------|
| app/BibleOnSite\App.xaml.cs:12 | `App` | init failure is logged then rethrown. | retained — context logging on a fatal path that may be host-swallowed; propagates via throw; |
| app/BibleOnSite\App.xaml.cs:35 | `CreateWindow` | window-creation failure is logged then rethrown. | retained — same contract for CreateWindow |
| app/BibleOnSite\Config\AppConfig.cs:109 | `ReadPackagedValueAsync` | packaged-config probe degrades to a null fallback. | retain + dedupe pragma pair (tool stamped it twice) |
| app/BibleOnSite\MainPage.xaml.cs:48 | `LoadStarterDataAsync` | starter-data load failure proceeds offline. | try scope narrowed to LoadAsync + log full exception |
| app/BibleOnSite\MauiProgram.cs:135 | `CreateMauiApp` | Firebase init failure disables analytics, not the app. | retained — Firebase init failure disables analytics, app continues; dual logged |
| app/BibleOnSite\Pages\ArticleDetailPage.xaml.cs:109 | `LoadArticleAsync` | article load failure surfaces as ErrorMessage. | retained — true boundary (surfaces `שגיאה בטעינת המאמר`); service swallows removed so transport errors now reach it |
| app/BibleOnSite\Platforms\Windows\Handlers\HtmlViewHandler.cs:115 | `UpdateContent` | HTML render failure falls back to plain text. | retained — Windows render failure → plain-text fallback paragraph (real recovery) |
| app/BibleOnSite\Controls\FloatingSearchBar.xaml.cs:176 | `OpenSearchAsync` | search-init failure surfaces as a user-facing error message. | retained — search-init failure surfaces `ErrorMessage` on the VM |
| app/BibleOnSite\Controls\FloatingSearchBar.xaml.cs:261 | `RunSearchAsync` | user-triggered search failure is logged; status refresh continues. | retained — last-resort net for VM-unsurfaced errors; OCE filtered; status refresh continues |
| app/BibleOnSite\Controls\FloatingSearchBar.xaml.cs:280 | `OnPerushimDownloadLinkTapped` | failure boundary: a navigation failure must not crash the picker. | retained + corrected copy-pasted NOSONAR reason (said "keyboard dismissal" on a navigation catch); log-only nav tap, retryable |
| app/BibleOnSite\Controls\FloatingSearchBar.xaml.cs:295 | `HideKeyboardAsync` | keyboard dismissal is best-effort. | retained — keyboard dismissal cosmetic |
| app/BibleOnSite\Controls\FloatingSearchBar.xaml.cs:654 | `RefreshRecentHistory` | recent-searches load degrades to an empty list. | retained — history-read failure → empty list (secondary UI) |
| app/BibleOnSite\Controls\FloatingSearchBar.xaml.cs:669 | `RememberSearch` | recent-search persistence is best-effort. | retained — history-write best-effort; logged |
| app/BibleOnSite\Controls\HtmlView.cs:71 | `LoadCellContentAsync` | commentary-cell load failure swaps in fallback text. | retained — commentary cell → truthful fallback text; serial guard prevents stale writes |
| app/BibleOnSite\ViewModels\TanahpediaViewModel.cs:98 | `LoadAsync` | landing load failure surfaces as ErrorMessage. | retained — landing load is required content → `ErrorMessage`; `IsLoading` reset in finally |
| app/BibleOnSite\Helpers\ExitConfirmation.cs:67 | `PromptAsync` | exit-prompt failure falls through to normal exit. | retained (injected delegate; recovery test exists) + corrected false reason |
| app/BibleOnSite\ViewModels\TanahpediaSearchViewModel.cs:232 | `SearchAsync` | failure boundary: a failed search must land on the availability note, not crash the panel. | retained — failed search → availability note, version-guarded; OCE filtered |
| app/BibleOnSite\ViewModels\TanahpediaEntryViewModel.cs:201 | `LoadCoreAsync` | entry load failure surfaces as ErrorMessage. | retained — entry load → `ErrorMessage`; OCE filtered separately; version guard blocks superseded writes |
| app/BibleOnSite\ViewModels\TanahpediaEntryViewModel.cs:289 | `LoadFamilyAsync` | family-section load is best-effort. | retained — family tree is deferred secondary content; designed drop (doc :253) |
| app/BibleOnSite\ViewModels\TanahpediaEntryViewModel.cs:303 | `LoadMarkersAsync` | place-marker load is best-effort. | retained — place markers same deferred-secondary contract |
| app/BibleOnSite\ViewModels\TanahpediaEntryViewModel.cs:364 | `LoadOccurrencesAsync` | occurrences mapping failure drops the table, not the page. | retained — occurrences table secondary; inner filtered SQLite/IO catch already narrow |
| app/BibleOnSite\Helpers\HtmlAttributedStringFactory.cs:77 | `Append` | attributed-string parse failure falls back to plain text. | retained — parse → null → caller renders plain text |
| app/BibleOnSite\ViewModels\TanahpediaEntityTypeViewModel.cs:119 | `LoadAsync` | homepage load degrades; entities still render. | retained — layered contract: homepage intro secondary; failure drops intro, listing renders |
| app/BibleOnSite\ViewModels\TanahpediaEntityTypeViewModel.cs:136 | `LoadAsync` | place-marker load drops the map, not the page. | retained — PLACE map markers secondary; failure drops map only |
| app/BibleOnSite\ViewModels\TanahpediaEntityTypeViewModel.cs:150 | `LoadAsync` | category load failure surfaces as ErrorMessage. | retained — required listing failure → `ErrorMessage`; correct outer boundary |
| app/BibleOnSite\ViewModels\SupportPreferencesViewModel.cs:54 | `ExportLogsAsync` | export spans IO/share platform errors; failure is reported to the user. | retained — export failure → user-facing alert |
| app/BibleOnSite\ViewModels\SearchViewModel.cs:595 | `PasukSearchResult` | — | retained — bare catch sets `ErrorMessage` then `throw;` (stack preserved); version guard; outer panel catch logs |
| app/BibleOnSite\ViewModels\SearchViewModel.cs:663 | `Add` | remote article search degrades to an availability note. | retained — merge boundary appends honest availability note (preferred degradation shape) |
| app/BibleOnSite\ViewModels\SearchViewModel.cs:715 | `Add` | remote pedia search degrades to an availability note. | retained — remote pedia search → availability note (same shape as :663) |
| app/BibleOnSite\ViewModels\RecitationPacksViewModel.cs:158 | `LoadAsync` | the install surface spans IO/network; a failed load shows the retry hint. | retained — load failure → `Status` retry hint (user-visible) |
| app/BibleOnSite\ViewModels\RecitationPacksViewModel.cs:216 | `RemoveAllAsync` | removal spans IO/platform errors; failure is reported and the list refreshed. | retained — removal failure → `Status` + `Refresh()` (state stays truthful) |
| app/BibleOnSite\ViewModels\RecitationPacksViewModel.cs:254 | `RemoveBookAsync` | removal spans IO/platform errors; failure is reported and the list refreshed. | retained — same per-book removal contract |
| app/BibleOnSite\ViewModels\PreferencesViewModel.cs:185 | `LoadAsync` | — | retained — perushim-catalog init optional; settings page must still render |
| app/BibleOnSite\ViewModels\PreferencesViewModel.cs:189 | `LoadAsync` | — | retained — recitation-catalog init optional; same contract |
| app/BibleOnSite\ViewModels\PerekViewModel.cs:509 | `ObserveStaleLoadAsync` | a superseded load attempt's late failure is log-only. | retained — superseded-load observer is log-only by design; newer attempt owns state |
| app/BibleOnSite\ViewModels\PerekViewModel.cs:1145 | `PreloadedPerushimData` | carousel preload is best-effort. | retained — carousel preload is an optimization; failure = slower first swipe only |
| app/BibleOnSite\ViewModels\PerekViewModel.cs:1196 | `GoToArticlesAsync` | navigation failure alerts the user. | retained — nav failure → user alert (honest convention) |
| app/BibleOnSite\ViewModels\PerekViewModel.cs:1215 | `GoToAuthorsAsync` | navigation failure alerts the user. | retained — nav failure → user alert |
| app/BibleOnSite\ViewModels\PerekViewModel.cs:1242 | `ExportPerushimLogsAsync` | log export failure alerts the user. | retained — export failure → user alert |
| app/BibleOnSite\ViewModels\AuthorsViewModel.cs:110 | `LoadAuthorsAsync` | authors load failure surfaces as a user message. | retained — required load → `ErrorMessage` + full-exception log |
| app/BibleOnSite\ViewModels\ArticlesViewModel.cs:244 | `ApplySearchAsync` | author search failure surfaces as a user message. | retained — search failure → availability message; OCE separated; token/version guards |
| app/BibleOnSite\ViewModels\ArticlesViewModel.cs:332 | `LoadArticlesAsync` | articles load failure surfaces as a user message. | retained — articles load → `ErrorMessage`; finally resets `IsLoading` |
| app/BibleOnSite\ViewModels\LearningCalendarViewModel.cs:168 | `InitializeAsync` | calendar load failure surfaces as ErrorMessage. | retained — calendar load → `ErrorMessage`; finally resets `IsLoading` |
| app/BibleOnSite\Controls\TanahpediaPlacesMap.cs:101 | `OnNavigating` | map-link launcher failure must not break interception. | retained — e.Cancel already consumed nav; launcher failure must not break interception |
| app/BibleOnSite\Controls\TanahpediaSearchPanel.xaml.cs:271 | `RunSearchAsync` | failure boundary: a failed search must not crash the overlay. | retained — last-resort net; VM surfaces own errors; status refresh continues |
| app/BibleOnSite\Controls\TanahpediaSearchPanel.xaml.cs:300 | `HideKeyboardAsync` | keyboard dismissal is best-effort and must not crash the panel. | retained — keyboard dismissal cosmetic |
| app/BibleOnSite\Pages\ParashaPage.Recitation.cs:83 | `InitializeRecitationAsync` | recitation-pack init is best-effort; availability simply stays off. | retained — recitation-pack init best-effort; availability stays off (truthful) |
| app/BibleOnSite\Pages\ParashaPage.Recitation.cs:421 | `OpenFocusedPasukAsync` | focused-commentary refresh is best-effort. | retained — focused-commentary refresh best-effort; panel shows cached |
| app/BibleOnSite\Pages\ParashaPage.Recitation.cs:738 | `PlaySegmentClipAsync` | playback failure shows the user alert unless the request was canceled. | retained — playback failure → alert unless cancelled (honest surface) |
| app/BibleOnSite\Pages\ParashaPage.Recitation.cs:771 | `OnRecitationMediaOpened` | a platform that cannot seek here still plays from the start. | retained — seek failure → plays from start (real recovery) |
| app/BibleOnSite\ViewModels\ExtensionPacksViewModel.cs:91 | `LoadAsync` | — | retained — perushim init optional; page still renders |
| app/BibleOnSite\ViewModels\ExtensionPacksViewModel.cs:123 | `RemovePerushimAsync` | removal spans IO/platform errors; failure is reported to the user. | retained — removal failure → alert + `NotifyPerushimState()` |
| app/BibleOnSite\Pages\ParashaPage.PerushimPanel.cs:95 | `HidePerushimKeyboardAsync` | failure boundary: keyboard dismissal is best-effort and must not crash the reader. | retained — keyboard dismissal cosmetic |
| app/BibleOnSite\Pages\ParashaPage.PerushimPanel.cs:109 | `OnGoToPerushimSettingsClicked` | failure boundary: settings navigation is best-effort and must not crash the reader. | retained — settings nav log-only; retryable tap |
| app/BibleOnSite\Controls\ViewportTextView.cs:142 | `AccessibleSection` | commentary accessibility section exposure is best-effort diagnostics. | retained — iOS a11y section exposure best-effort; content still renders |
| app/BibleOnSite\Controls\ViewportTextView.cs:236 | `EnsureSectionGeometry` | commentary accessibility measurement is best-effort diagnostics. | retained — iOS a11y measurement best-effort |
| app/BibleOnSite\Pages\ContactPage.xaml.cs:17 | `OnWhatsAppTapped` | external launcher failure is log-only. | repaired — was log-only dead tap; now alerts on launcher failure (TosPage/AccessibilityStatement convention) |
| app/BibleOnSite\Pages\ContactPage.xaml.cs:31 | `OnTelegramTapped` | external launcher failure is log-only. | repaired — same: Telegram launcher now alerts |
| app/BibleOnSite\Pages\ContactPage.xaml.cs:46 | `OnEmailTapped` | external launcher failure is log-only. | repaired — same: email launcher now alerts |
| app/BibleOnSite\Pages\MasoraPage.xaml.cs:261 | `OnAppearing` | unit load failure surfaces as a user alert. | retained — unit load failure → alert (stronger than Perek mirror) |
| app/BibleOnSite\Pages\MasoraPage.xaml.cs:511 | `UpdateArticlesCountAsync` | articles-count badge degrades to hidden. | retained — badge → hidden on count failure |
| app/BibleOnSite\Pages\MasoraPage.xaml.cs:540 | `OnArticlesButtonClicked` | articles-button styling failure is log-only. | retained — articles-view transition no-crash; weak-feedback tap flagged |
| app/BibleOnSite\Pages\MasoraPage.xaml.cs:586 | `OnArticleSelected` | article navigation failure is log-only. | retained — article-select nav log-only; retryable tap (weak-feedback class) |
| app/BibleOnSite\Pages\LoadingPage.xaml.cs:54 | `OnAppearing` | parallel-load fault observation is deliberate, then rethrown. | retained (offline-degradation is deliberate) + corrected false reason |
| app/BibleOnSite\Pages\ParashaPage.WindowsBack.cs:96 | `OnReaderKeyboardBackInvoked` | reader Back navigation failure is log-only. | retained — async-void boundary; press already consumed; Windows-only |
| app/BibleOnSite\Pages\PerekPage.Recitation.cs:67 | `InitializeRecitationAsync` | recitation-pack init is best-effort; availability simply stays off. | retained — recitation-pack init best-effort; availability stays off |
| app/BibleOnSite\Pages\PerekPage.Recitation.cs:391 | `OpenFocusedPasukAsync` | focused-commentary refresh is best-effort. | retained — focused-commentary refresh best-effort; panel shows cached |
| app/BibleOnSite\Pages\PerekPage.Recitation.cs:594 | `PlayRecitationAsync` | playback failure shows the user alert unless the request was canceled. | retained — playback failure → alert unless cancelled |
| app/BibleOnSite\Pages\PerekPage.Recitation.cs:627 | `OnRecitationMediaOpened` | a platform that cannot seek here still plays from the start. | retained — seek failure → plays from start (real recovery) |
| app/BibleOnSite\Pages\MasoraPage.PerushimPanel.cs:95 | `HidePerushimKeyboardAsync` | failure boundary: keyboard dismissal is best-effort and must not crash the reader. | retained — keyboard dismissal cosmetic |
| app/BibleOnSite\Pages\MasoraPage.PerushimPanel.cs:110 | `OnGoToPerushimSettingsClicked` | settings navigation failure is log-only. | retained — settings nav log-only; retryable tap |
| app/BibleOnSite\Pages\ParashaPage.Selection.cs:358 | `TriggerHapticFeedback` | haptic feedback is best-effort. | retained — haptic feedback cosmetic |
| app/BibleOnSite\Pages\ParashaPage.Search.cs:287 | `OnSearchResultSelected` | search-result navigation failure alerts the user. | retained — search-result nav failure → alert |
| app/BibleOnSite\Pages\TosPage.xaml.cs:33 | `OnPrivacyPolicyTapped` | launcher failures are platform-specific; the user gets an alert. | retained — launcher failure → alert (already the honest shape) |
| app/BibleOnSite\Pages\PerekPage.xaml.cs:522 | `OnAppearing` | failure boundary: any load failure lands on the retryable error panel instead of crashing the reader. | retained — truthful retryable error panel + staleness guard + finally resets _isLoading |
| app/BibleOnSite\Pages\PerekPage.xaml.cs:682 | `OnPerekLoadRetryClicked` | failure boundary: a failed retry must land back on the retryable error panel, not crash the reader. | retained — same retry-panel contract on the retry path |
| app/BibleOnSite\Pages\PerekPage.xaml.cs:723 | `RefreshPerushimIfAvailabilityChangedAsync` | on-appearing refresh is best-effort. | retained — on-appearing perushim refresh best-effort |
| app/BibleOnSite\Pages\PerekPage.xaml.cs:847 | `UpdateArticlesCount` | articles-count badge degrades to hidden. | retained — badge → hidden on count failure |
| app/BibleOnSite\Pages\PerekPage.xaml.cs:1293 | `TriggerHapticFeedback` | haptic feedback is best-effort. | retained — haptic feedback cosmetic |
| app/BibleOnSite\Pages\PerekPage.xaml.cs:1624 | `OnArticlesButtonClicked` | articles-view transition must not crash the reader. | retained — articles-view transition no-crash; weak-feedback tap flagged |
| app/BibleOnSite\Pages\PerekPage.xaml.cs:1660 | `ShowArticlesView` | articles-view transition must not crash the reader. | retained — same transition boundary (ShowArticlesView) |
| app/BibleOnSite\Pages\PerekPage.xaml.cs:1689 | `ShowPerekView` | perek-view styling failure is log-only. | retained — styling failure log-only (cosmetic) |
| app/BibleOnSite\Pages\PerekPage.xaml.cs:1717 | `AnimateFlipAsync` | flip animation falls back to a visibility swap. | retained — flip animation → visibility-swap fallback (real recovery) |
| app/BibleOnSite\Pages\PerekPage.xaml.cs:1744 | `OnArticleSelected` | articles list degrades to empty. | retained — article-select nav log-only; retryable tap (weak-feedback class) |
| app/BibleOnSite\Pages\PerekPage.xaml.cs:1763 | `LoadArticles` | articles list degrades to empty. | retained — local-snapshot list failure → empty ItemsSource (visible empty state) |
| app/BibleOnSite\Pages\PerekPage.xaml.cs:1852 | `HidePerushimKeyboardAsync` | failure boundary: keyboard dismissal is best-effort and must not crash the reader. | retained — keyboard dismissal cosmetic |
| app/BibleOnSite\Pages\PerekPage.xaml.cs:1867 | `OnGoToPerushimSettingsClicked` | settings navigation failure is log-only. | retained — settings nav log-only; retryable tap |
| app/BibleOnSite\Pages\PerekPage.WindowsBack.cs:96 | `OnReaderKeyboardBackInvoked` | reader Back navigation failure is log-only. | retained — async-void boundary; press already consumed; Windows-only |
| app/BibleOnSite\Pages\TanahpediaEntryPage.xaml.cs:125 | `OnOccurrenceTapped` | occurrence navigation failure alerts the user. | retained — occurrence nav failure → alert |
| app/BibleOnSite\Services\ArticleService.cs:84 | `GetArticlesByPerekIdAsync` | remote article fetch degrades to an empty list. | repaired — transport failures propagate; GraphQL errors/absent data still return empty. `ArticleResponseTests` asserts `HttpRequestException` propagates |
| app/BibleOnSite\Services\ArticleService.cs:146 | `GetArticleByIdAsync` | remote article fetch degrades to null. | repaired — single-article transport failure no longer falsified to null (real not-found still null) |
| app/BibleOnSite\Services\ArticleService.cs:204 | `GetArticlesByAuthorIdAsync` | remote author fetch degrades to an empty list. | repaired — author-list transport failure no longer falsified to empty |
| app/BibleOnSite\Services\AccessibilityStatement.cs:19 | `OpenAsync` | launcher failures are platform-specific; the user gets an alert. | retained — launcher failure → alert |
| app/BibleOnSite\Pages\PerekPage.Search.cs:306 | `OnSearchResultSelected` | search-result navigation failure alerts the user. | retained — search-result nav failure → alert |
| app/BibleOnSite\Services\AnalyticsService.cs:51 | `SetScreen` | analytics event failure must never crash the reader. | retained — telemetry must never crash the reader |
| app/BibleOnSite\Services\AnalyticsService.cs:75 | `LogSearch` | analytics event failure must never crash the reader. | retained — same telemetry boundary |
| app/BibleOnSite\Services\MpegRecitationAudioDecoder.cs:33 | `ReleaseAsync` | JS reset failure marks the decoder uninitialized so the next use retries. | retained — catch performs recovery (`_initialized=false` → next use retries) |
| app/BibleOnSite\Services\NetworkService.cs:78 | `OnConnectivityChanged` | connectivity-refresh failure is log-only. | retained — connectivity-refresh is background log-only; no state written on failure |
| app/BibleOnSite\Services\PadDeliveryService.cs:254 | `TryGetAssetPathAndroidAsync` | pack-location probe: any failure counts as unavailable. | retained — pack-location probe → null=unavailable; callers degrade to no-pack path |
| app/BibleOnSite\Services\PadDeliveryService.cs:358 | `FetchAndroidAsync` | pack fetch failure is surfaced via LastAndroidPadError and a false result. | retained — fetch → `LastAndroidPadError`+false (diagnostically surfaced); OCE cancels then rethrows |
| app/BibleOnSite\Services\PadDeliveryService.cs:398 | `GetDeliveryDiagnosticsAndroidAsync` | diagnostics collection: pack-location failure becomes a report line. | retained — diagnostics collection → report line |
| app/BibleOnSite\Services\PadDeliveryService.cs:441 | `AppendInstallSourceLines` | diagnostics collection: installer-source failure becomes a report line. | retained — diagnostics collection → report line |
| app/BibleOnSite\Services\PadDeliveryService.cs:554 | `TryGetAssetPathIosAsync` | asset-path lookup failure counts as unavailable. | retained — iOS asset-path probe → null=unavailable; cancellation re-raised in catch |
| app/BibleOnSite\Services\PadDeliveryService.cs:625 | `FetchIosAsync` | delivery fetch failure is surfaced via LastIosDeliveryError and a false result. | retained — iOS fetch → `LastIosDeliveryError`+false; OCE/NSErrorException narrowed separately |
| app/BibleOnSite\Services\PadDeliveryService.cs:818 | `SavePackFileAsync` | payload save failure returns a false result. | retained — save failure → truthful false result; caller treats as failed download |
| app/BibleOnSite\Services\PadDeliveryService.cs:845 | `CancelAssetPackDownload` | download cancel is best-effort. | retained — best-effort cancel of system-managed download; rejection logged |
| app/BibleOnSite\Services\PadDeliveryService.cs:868 | `GetDeliveryDiagnosticsIosAsync` | diagnostics collection: cached-file info failure becomes a report line. | retained — diagnostics collection → report line (iOS) |
| app/BibleOnSite\Services\PadDeliveryService.cs:886 | `GetDeliveryDiagnosticsIosAsync` | diagnostics collection: Info.plist probe failure becomes a report line. | retained — diagnostics collection → report line (iOS) |
| app/BibleOnSite\Services\PadDeliveryService.cs:901 | `GetDeliveryDiagnosticsIosAsync` | diagnostics collection: app-group probe failure becomes a report line. | retained — diagnostics collection → report line (iOS) |
| app/BibleOnSite\Services\PadDeliveryService.cs:940 | `GetDeliveryDiagnosticsIosAsync` | diagnostics collection: local-status probe failure becomes a report line. | retained — diagnostics collection → report line (iOS) |
| app/BibleOnSite\Services\PadDeliveryService.cs:952 | `GetDeliveryDiagnosticsIosAsync` | diagnostics collection: availability probe failure becomes a report line. | retained — diagnostics collection → report line (iOS) |
| app/BibleOnSite\Services\PadDeliveryService.cs:965 | `GetDeliveryDiagnosticsIosAsync` | diagnostics collection: store-pack list failure becomes a report line. | retained — diagnostics collection → report line (iOS) |
| app/BibleOnSite\Services\PadDeliveryService.cs:979 | `?` | diagnostics collection: disk-space probe failure becomes a report line. | retained — diagnostics collection → report line (iOS) |
| app/BibleOnSite\Pages\ParashaPage.xaml.cs:387 | `OnAppearing` | failure boundary: a failed parasha load lands on the retryable error panel instead of crashing the reader. | retained — same retry-panel contract |
| app/BibleOnSite\Pages\ParashaPage.xaml.cs:458 | `RefreshPerushimIfAvailabilityChangedAsync` | on-appearing refresh is best-effort. | retained — on-appearing perushim refresh best-effort |
| app/BibleOnSite\Pages\ParashaPage.xaml.cs:590 | `OnParashaLoadRetryClicked` | failure boundary: a failed retry must land back on the retryable error panel, not crash the reader. | retained — same retry-panel contract on the retry path |
| app/BibleOnSite\Pages\ParashaPage.xaml.cs:897 | `UpdateArticlesCountAsync` | articles-count badge degrades to hidden. | retained — badge → hidden on count failure |
| app/BibleOnSite\Pages\ParashaPage.xaml.cs:926 | `OnArticlesButtonClicked` | articles-button styling failure is log-only. | retained — articles-view transition no-crash; weak-feedback tap flagged |
| app/BibleOnSite\Pages\ParashaPage.xaml.cs:972 | `OnArticleSelected` | article navigation failure is log-only. | retained — article-select nav log-only; retryable tap |
| app/BibleOnSite\Services\PreferencesService.cs:618 | `Load` | corrupt bookmarks JSON resets to an empty set. | narrowed to JsonException + logged (was silent data-loss risk) |
| app/BibleOnSite\Services\PerushimNotesService.cs:194 | `GetDiagnosticsAsync` | diagnostics collection: any failure becomes a report line. | retained — diagnostics collection: init failure becomes a report line |
| app/BibleOnSite\Services\PerushimNotesService.cs:203 | `GetDiagnosticsAsync` | diagnostics collection: any failure becomes a report line. | retained — diagnostics collection: delivery-path probe → report line |
| app/BibleOnSite\Services\PerushimNotesService.cs:247 | `GetDiagnosticsAsync` | diagnostics collection: any failure becomes a report line. | retained — diagnostics collection → report line |
| app/BibleOnSite\Services\PerushimNotesService.cs:265 | `AppPackageHasNotesAsync` | any package-probe failure means "no notes"; callers degrade, never abort. | retained — package probe → "no notes" (can't confirm presence; callers degrade) |
| app/BibleOnSite\Services\PerushimNotesService.cs:530 | `ValidateLocalNotesCoreAsync` | validation failure rejects the pack generation. | retained — ambiguous failure rejects pack but not generation (equal-build replacement stays allowed) |
| app/BibleOnSite\Services\PerushimNotesService.cs:816 | `TryUpgradeFromPadAsync` | PAD check/upgrade is best-effort. | retained — PAD upgrade best-effort; existing local notes still work |
| app/BibleOnSite\Services\PerushimNotesService.cs:893 | `TryCopyFromPadAsync` | pack copy failure degrades to not-copied. | retained — pack copy → truthful `copied=false` |
| app/BibleOnSite\Services\PerushimNotesService.cs:950 | `TryCopyFromAppPackageAsync` | package copy failure degrades to not-copied. | retained — package copy → false; FileNotFoundException filtered separately |
| app/BibleOnSite\Services\StarterService.cs:229 | `LoadWithRetryAsync` | starter API failure falls back to local cache. | retained (fault tests exist) + log full exception |
| app/BibleOnSite\Services\StarterService.cs:246 | `LoadWithRetryAsync` | cache load failure proceeds offline without articles. | retained (fault tests exist) + log full exception |
| app/BibleOnSite\Services\StarterService.cs:272 | `TryRefreshAsync` | background refresh failure is log-only. | retained (fault tests exist) + log full exception |
| app/BibleOnSite\Services\StarterService.cs:292 | `SaveCacheAsync` | cache save is best-effort. | retained (fault tests exist) + log full exception |

## Unfiltered sites — devops (8)

| Site | Member | Reason | Disposition |
|------|--------|--------|-------------|
| app/devops\Build.Run.cs:75 | `?` | API probe: any failure counts as not-running. | retained — API liveness probe → false (genuine probe semantics) |
| app/devops\Build.Run.cs:91 | `IsPortOpen` | TCP probe: any failure counts as closed. | retained — TCP port probe → closed |
| app/devops\Build.Run.cs:214 | `session` | env-file load failure warns and continues with defaults. | retained — env-file load → warn + continue with defaults |
| app/devops\Build.Run.cs:422 | `?` | adb package probe: any failure counts as not-installed. | retained — adb package probe → not-installed |
| app/devops\Build.Run.cs:584 | `?` | adb device probe: any failure counts as no-device. | retained — adb device probe → no-device |
| app/devops\Build.Run.cs:634 | `?` | adb id probe: any failure counts as absent. | retained — adb id probe → absent |
| app/devops\Build.Run.cs:687 | `?` | avd probe: any failure counts as none. | retained — avd probe → none |
| app/devops\Build.Run.cs:769 | `?` | adb push probe: any failure counts as failed. | retained — adb push probe → failed |

## Already-filtered catches (24)

These carry `when` filters and need no S2221 suppression. Each batch
spot-checks that the filter is genuinely narrow — e.g.
`when (ex is not GraphQLException)` is functionally a broad catch and gets
re-audited, while `when (ex is IOException or UnauthorizedAccessException)`
is already the right shape.

| Site | Member |
|------|--------|
| app/devops\Build.Deploy.cs:457 | `TryParseFlightId` |
| app/BibleOnSite\Controls\FloatingSearchBar.xaml.cs:74 | `AttachAvailabilityWatchers` |
| app/BibleOnSite\Controls\FloatingSearchBar.Filters.cs:152 | `RefreshKindAvailabilityAsync` |
| app/BibleOnSite\ViewModels\TanahpediaEntryViewModel.cs:337 | `LoadOccurrencesAsync` |
| app/BibleOnSite\ViewModels\SearchViewModel.cs:145 | `CancelSearch` |
| app/BibleOnSite\ViewModels\SearchViewModel.cs:164 | `CancelSearch` |
| app/BibleOnSite\ViewModels\RecitationPacksViewModel.cs:342 | `DownloadAsync` |
| app/BibleOnSite\Helpers\PackagedDatabase.cs:92 | `CurrentSourceVersion` |
| app/BibleOnSite\Helpers\PackagedDatabase.cs:148 | `ReadMarkerAsync` |
| app/BibleOnSite\Helpers\PackagedDatabase.cs:168 | `WriteMarkerAsync` |
| app/BibleOnSite\Services\BaseGraphQLService.cs:72 | `BaseGraphQLService` |
| app/BibleOnSite\Services\ArticleService.cs:317 | `Select` |
| app/BibleOnSite\Services\PadDeliveryService.cs:80 | `DownloadReleasePayloadsAsync` |
| app/BibleOnSite\Services\PerushimNotesService.cs:583 | `RejectNotesAsync` |
| app/BibleOnSite\Services\PerushimNotesService.cs:608 | `IsRejectedGenerationAsync` |
| app/BibleOnSite\Services\PerushimNotesService.cs:635 | `SweepStaleTempFiles` |
| app/BibleOnSite\Services\PerushimNotesService.cs:650 | `TryDelete` |
| app/BibleOnSite\Services\PerushimNotesService.cs:923 | `TryCopyPadIndexAsync` |
| app/BibleOnSite\Services\PerushimNotesService.cs:978 | `TryCopyPackageIndexAsync` |
| app/BibleOnSite\Services\SearchIndexService.cs:381 | `DeleteObsoleteCaches` |
| app/BibleOnSite\Services\SearchIndexService.cs:651 | `TryAdoptDeliveredVersesAsync` |
| app/BibleOnSite\Services\SearchIndexService.cs:723 | `DeleteStagedIndexFile` |
| app/BibleOnSite\Services\RecitationService.cs:476 | `PrepareAudioAsync` |
| app/BibleOnSite\Services\RecitationService.cs:502 | `IsCompleteWav` |

## Batch plan

- **batch-1 (this PR)** — startup/exit/back + persistence caches: verified
  retained boundaries, corrected two false reasons, narrowed the corrupt-
  bookmarks catch to JsonException with logging, deduped the annotation
  tool's double-stamped pragma pairs, retired the one-off justify/dump tools.
- **data/services** — ArticleService empty/null degradations, SearchIndexService,
  PerushimNotesService + PadDeliveryService probes, Tanahpedia loaders.
- **reader pages** — PerekPage/ParashaPage/MasoraPage article lists, styling,
  recitation, perushim panels.
- **search/UI** — SearchViewModel, FloatingSearchBar, TanahpediaSearchPanel,
  ViewportTextView diagnostics.
- **devops probes** — Build.Run.cs adb/avd/api probes; keep or replace with
  evidenced narrow catches.

Regenerate the site table: `node devops/review-audit/scan-catch.cjs` lists
any unannotated sites that slip back in — the same check runs as the
`catch-boundary` pre-commit hook on staged `app/**/*.cs`, so new generic
catches can no longer slip without a `//NOSONAR` reason (S2221's async-void/
catch-rethrow exemption included). Post-audit additions it caught on first
run: `TanahpediaEntryPage.xaml.cs` `OnEntryLinkTapped` and
`TanahpediaEntityTypePage.xaml.cs` `OnIntroLinkTapped` (#2596 async-void
link handlers) and `SearchViewModel.cs` `:595` bare catch-rethrow — all now
annotated with their retained-boundary reasons.
