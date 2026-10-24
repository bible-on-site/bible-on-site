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

## Unfiltered sites — production app (132)

| Site | Member | Reason | Disposition |
|------|--------|--------|-------------|
| app/BibleOnSite\App.xaml.cs:12 | `App` | init failure is logged then rethrown. | retained — context logging on a fatal path that may be host-swallowed; propagates via throw; |
| app/BibleOnSite\App.xaml.cs:35 | `CreateWindow` | window-creation failure is logged then rethrown. | retained — same contract for CreateWindow |
| app/BibleOnSite\Config\AppConfig.cs:109 | `ReadPackagedValueAsync` | packaged-config probe degrades to a null fallback. | retain + dedupe pragma pair (tool stamped it twice) |
| app/BibleOnSite\MainPage.xaml.cs:48 | `LoadStarterDataAsync` | starter-data load failure proceeds offline. | try scope narrowed to LoadAsync + log full exception |
| app/BibleOnSite\MauiProgram.cs:135 | `CreateMauiApp` | Firebase init failure disables analytics, not the app. | retained — Firebase init failure disables analytics, app continues; dual logged |
| app/BibleOnSite\Pages\ArticleDetailPage.xaml.cs:109 | `LoadArticleAsync` | article load failure surfaces as ErrorMessage. | retained — true boundary (surfaces `שגיאה בטעינת המאמר`); service swallows removed so transport errors now reach it |
| app/BibleOnSite\Platforms\Windows\Handlers\HtmlViewHandler.cs:115 | `UpdateContent` | HTML render failure falls back to plain text. | pending |
| app/BibleOnSite\Controls\FloatingSearchBar.xaml.cs:176 | `OpenSearchAsync` | search-init failure surfaces as a user-facing error message. | pending |
| app/BibleOnSite\Controls\FloatingSearchBar.xaml.cs:261 | `RunSearchAsync` | user-triggered search failure is logged; status refresh continues. | pending |
| app/BibleOnSite\Controls\FloatingSearchBar.xaml.cs:280 | `OnPerushimDownloadLinkTapped` | failure boundary: a navigation failure must not crash the picker. | pending |
| app/BibleOnSite\Controls\FloatingSearchBar.xaml.cs:295 | `HideKeyboardAsync` | keyboard dismissal is best-effort. | pending |
| app/BibleOnSite\Controls\FloatingSearchBar.xaml.cs:654 | `RefreshRecentHistory` | recent-searches load degrades to an empty list. | pending |
| app/BibleOnSite\Controls\FloatingSearchBar.xaml.cs:669 | `RememberSearch` | recent-search persistence is best-effort. | pending |
| app/BibleOnSite\Controls\HtmlView.cs:71 | `LoadCellContentAsync` | commentary-cell load failure swaps in fallback text. | pending |
| app/BibleOnSite\ViewModels\TanahpediaViewModel.cs:98 | `LoadAsync` | landing load failure surfaces as ErrorMessage. | retained — landing load is required content → `ErrorMessage`; `IsLoading` reset in finally |
| app/BibleOnSite\Helpers\ExitConfirmation.cs:67 | `PromptAsync` | exit-prompt failure falls through to normal exit. | retained (injected delegate; recovery test exists) + corrected false reason |
| app/BibleOnSite\ViewModels\TanahpediaSearchViewModel.cs:232 | `SearchAsync` | failure boundary: a failed search must land on the availability note, not crash the panel. | retained — failed search → availability note, version-guarded; OCE filtered |
| app/BibleOnSite\ViewModels\TanahpediaEntryViewModel.cs:201 | `LoadCoreAsync` | entry load failure surfaces as ErrorMessage. | retained — entry load → `ErrorMessage`; OCE filtered separately; version guard blocks superseded writes |
| app/BibleOnSite\ViewModels\TanahpediaEntryViewModel.cs:289 | `LoadFamilyAsync` | family-section load is best-effort. | retained — family tree is deferred secondary content; designed drop (doc :253) |
| app/BibleOnSite\ViewModels\TanahpediaEntryViewModel.cs:303 | `LoadMarkersAsync` | place-marker load is best-effort. | retained — place markers same deferred-secondary contract |
| app/BibleOnSite\ViewModels\TanahpediaEntryViewModel.cs:364 | `LoadOccurrencesAsync` | occurrences mapping failure drops the table, not the page. | retained — occurrences table secondary; inner filtered SQLite/IO catch already narrow |
| app/BibleOnSite\Helpers\HtmlAttributedStringFactory.cs:77 | `Append` | attributed-string parse failure falls back to plain text. | pending |
| app/BibleOnSite\ViewModels\TanahpediaEntityTypeViewModel.cs:119 | `LoadAsync` | homepage load degrades; entities still render. | retained — layered contract: homepage intro secondary; failure drops intro, listing renders |
| app/BibleOnSite\ViewModels\TanahpediaEntityTypeViewModel.cs:136 | `LoadAsync` | place-marker load drops the map, not the page. | retained — PLACE map markers secondary; failure drops map only |
| app/BibleOnSite\ViewModels\TanahpediaEntityTypeViewModel.cs:150 | `LoadAsync` | category load failure surfaces as ErrorMessage. | retained — required listing failure → `ErrorMessage`; correct outer boundary |
| app/BibleOnSite\ViewModels\SupportPreferencesViewModel.cs:54 | `ExportLogsAsync` | export spans IO/share platform errors; failure is reported to the user. | pending |
| app/BibleOnSite\ViewModels\SearchViewModel.cs:595 | `PasukSearchResult` | — | pending |
| app/BibleOnSite\ViewModels\SearchViewModel.cs:663 | `Add` | remote article search degrades to an availability note. | retained — merge boundary appends honest availability note (preferred degradation shape) |
| app/BibleOnSite\ViewModels\SearchViewModel.cs:715 | `Add` | remote pedia search degrades to an availability note. | pending |
| app/BibleOnSite\ViewModels\RecitationPacksViewModel.cs:158 | `LoadAsync` | the install surface spans IO/network; a failed load shows the retry hint. | pending |
| app/BibleOnSite\ViewModels\RecitationPacksViewModel.cs:216 | `RemoveAllAsync` | removal spans IO/platform errors; failure is reported and the list refreshed. | pending |
| app/BibleOnSite\ViewModels\RecitationPacksViewModel.cs:254 | `RemoveBookAsync` | removal spans IO/platform errors; failure is reported and the list refreshed. | pending |
| app/BibleOnSite\ViewModels\PreferencesViewModel.cs:185 | `LoadAsync` | — | pending |
| app/BibleOnSite\ViewModels\PreferencesViewModel.cs:189 | `LoadAsync` | — | pending |
| app/BibleOnSite\ViewModels\PerekViewModel.cs:509 | `ObserveStaleLoadAsync` | a superseded load attempt's late failure is log-only. | pending |
| app/BibleOnSite\ViewModels\PerekViewModel.cs:1145 | `PreloadedPerushimData` | carousel preload is best-effort. | pending |
| app/BibleOnSite\ViewModels\PerekViewModel.cs:1196 | `GoToArticlesAsync` | navigation failure alerts the user. | pending |
| app/BibleOnSite\ViewModels\PerekViewModel.cs:1215 | `GoToAuthorsAsync` | navigation failure alerts the user. | pending |
| app/BibleOnSite\ViewModels\PerekViewModel.cs:1242 | `ExportPerushimLogsAsync` | log export failure alerts the user. | pending |
| app/BibleOnSite\ViewModels\AuthorsViewModel.cs:110 | `LoadAuthorsAsync` | authors load failure surfaces as a user message. | pending |
| app/BibleOnSite\ViewModels\ArticlesViewModel.cs:244 | `ApplySearchAsync` | author search failure surfaces as a user message. | pending |
| app/BibleOnSite\ViewModels\ArticlesViewModel.cs:332 | `LoadArticlesAsync` | articles load failure surfaces as a user message. | pending |
| app/BibleOnSite\ViewModels\LearningCalendarViewModel.cs:168 | `InitializeAsync` | calendar load failure surfaces as ErrorMessage. | pending |
| app/BibleOnSite\Controls\TanahpediaPlacesMap.cs:101 | `OnNavigating` | map-link launcher failure must not break interception. | pending |
| app/BibleOnSite\Controls\TanahpediaSearchPanel.xaml.cs:271 | `RunSearchAsync` | failure boundary: a failed search must not crash the overlay. | pending |
| app/BibleOnSite\Controls\TanahpediaSearchPanel.xaml.cs:300 | `HideKeyboardAsync` | keyboard dismissal is best-effort and must not crash the panel. | pending |
| app/BibleOnSite\Pages\ParashaPage.Recitation.cs:83 | `InitializeRecitationAsync` | recitation-pack init is best-effort; availability simply stays off. | pending |
| app/BibleOnSite\Pages\ParashaPage.Recitation.cs:421 | `OpenFocusedPasukAsync` | focused-commentary refresh is best-effort. | pending |
| app/BibleOnSite\Pages\ParashaPage.Recitation.cs:738 | `PlaySegmentClipAsync` | playback failure shows the user alert unless the request was canceled. | pending |
| app/BibleOnSite\Pages\ParashaPage.Recitation.cs:771 | `OnRecitationMediaOpened` | a platform that cannot seek here still plays from the start. | pending |
| app/BibleOnSite\ViewModels\ExtensionPacksViewModel.cs:91 | `LoadAsync` | — | pending |
| app/BibleOnSite\ViewModels\ExtensionPacksViewModel.cs:123 | `RemovePerushimAsync` | removal spans IO/platform errors; failure is reported to the user. | pending |
| app/BibleOnSite\Pages\ParashaPage.PerushimPanel.cs:95 | `HidePerushimKeyboardAsync` | failure boundary: keyboard dismissal is best-effort and must not crash the reader. | pending |
| app/BibleOnSite\Pages\ParashaPage.PerushimPanel.cs:109 | `OnGoToPerushimSettingsClicked` | failure boundary: settings navigation is best-effort and must not crash the reader. | pending |
| app/BibleOnSite\Controls\ViewportTextView.cs:142 | `AccessibleSection` | commentary accessibility section exposure is best-effort diagnostics. | pending |
| app/BibleOnSite\Controls\ViewportTextView.cs:236 | `EnsureSectionGeometry` | commentary accessibility measurement is best-effort diagnostics. | pending |
| app/BibleOnSite\Pages\ContactPage.xaml.cs:17 | `OnWhatsAppTapped` | external launcher failure is log-only. | pending |
| app/BibleOnSite\Pages\ContactPage.xaml.cs:31 | `OnTelegramTapped` | external launcher failure is log-only. | pending |
| app/BibleOnSite\Pages\ContactPage.xaml.cs:46 | `OnEmailTapped` | external launcher failure is log-only. | pending |
| app/BibleOnSite\Pages\MasoraPage.xaml.cs:261 | `OnAppearing` | unit load failure surfaces as a user alert. | pending |
| app/BibleOnSite\Pages\MasoraPage.xaml.cs:511 | `UpdateArticlesCountAsync` | articles-count badge degrades to hidden. | pending |
| app/BibleOnSite\Pages\MasoraPage.xaml.cs:540 | `OnArticlesButtonClicked` | articles-button styling failure is log-only. | pending |
| app/BibleOnSite\Pages\MasoraPage.xaml.cs:586 | `OnArticleSelected` | article navigation failure is log-only. | pending |
| app/BibleOnSite\Pages\LoadingPage.xaml.cs:54 | `OnAppearing` | parallel-load fault observation is deliberate, then rethrown. | retained (offline-degradation is deliberate) + corrected false reason |
| app/BibleOnSite\Pages\ParashaPage.WindowsBack.cs:96 | `OnReaderKeyboardBackInvoked` | reader Back navigation failure is log-only. | retained — async-void boundary; press already consumed; Windows-only |
| app/BibleOnSite\Pages\PerekPage.Recitation.cs:67 | `InitializeRecitationAsync` | recitation-pack init is best-effort; availability simply stays off. | pending |
| app/BibleOnSite\Pages\PerekPage.Recitation.cs:391 | `OpenFocusedPasukAsync` | focused-commentary refresh is best-effort. | pending |
| app/BibleOnSite\Pages\PerekPage.Recitation.cs:594 | `PlayRecitationAsync` | playback failure shows the user alert unless the request was canceled. | pending |
| app/BibleOnSite\Pages\PerekPage.Recitation.cs:627 | `OnRecitationMediaOpened` | a platform that cannot seek here still plays from the start. | pending |
| app/BibleOnSite\Pages\MasoraPage.PerushimPanel.cs:95 | `HidePerushimKeyboardAsync` | failure boundary: keyboard dismissal is best-effort and must not crash the reader. | pending |
| app/BibleOnSite\Pages\MasoraPage.PerushimPanel.cs:110 | `OnGoToPerushimSettingsClicked` | settings navigation failure is log-only. | pending |
| app/BibleOnSite\Pages\ParashaPage.Selection.cs:358 | `TriggerHapticFeedback` | haptic feedback is best-effort. | pending |
| app/BibleOnSite\Pages\ParashaPage.Search.cs:287 | `OnSearchResultSelected` | search-result navigation failure alerts the user. | pending |
| app/BibleOnSite\Pages\TosPage.xaml.cs:33 | `OnPrivacyPolicyTapped` | launcher failures are platform-specific; the user gets an alert. | pending |
| app/BibleOnSite\Pages\PerekPage.xaml.cs:522 | `OnAppearing` | failure boundary: any load failure lands on the retryable error panel instead of crashing the reader. | retained — truthful retryable error panel + staleness guard + finally resets _isLoading |
| app/BibleOnSite\Pages\PerekPage.xaml.cs:682 | `OnPerekLoadRetryClicked` | failure boundary: a failed retry must land back on the retryable error panel, not crash the reader. | retained — same retry-panel contract on the retry path |
| app/BibleOnSite\Pages\PerekPage.xaml.cs:723 | `RefreshPerushimIfAvailabilityChangedAsync` | on-appearing refresh is best-effort. | pending |
| app/BibleOnSite\Pages\PerekPage.xaml.cs:847 | `UpdateArticlesCount` | articles-count badge degrades to hidden. | pending |
| app/BibleOnSite\Pages\PerekPage.xaml.cs:1293 | `TriggerHapticFeedback` | haptic feedback is best-effort. | pending |
| app/BibleOnSite\Pages\PerekPage.xaml.cs:1624 | `OnArticlesButtonClicked` | articles-view transition must not crash the reader. | pending |
| app/BibleOnSite\Pages\PerekPage.xaml.cs:1660 | `ShowArticlesView` | articles-view transition must not crash the reader. | pending |
| app/BibleOnSite\Pages\PerekPage.xaml.cs:1689 | `ShowPerekView` | perek-view styling failure is log-only. | pending |
| app/BibleOnSite\Pages\PerekPage.xaml.cs:1717 | `AnimateFlipAsync` | flip animation falls back to a visibility swap. | pending |
| app/BibleOnSite\Pages\PerekPage.xaml.cs:1744 | `OnArticleSelected` | articles list degrades to empty. | pending |
| app/BibleOnSite\Pages\PerekPage.xaml.cs:1763 | `LoadArticles` | articles list degrades to empty. | pending |
| app/BibleOnSite\Pages\PerekPage.xaml.cs:1852 | `HidePerushimKeyboardAsync` | failure boundary: keyboard dismissal is best-effort and must not crash the reader. | pending |
| app/BibleOnSite\Pages\PerekPage.xaml.cs:1867 | `OnGoToPerushimSettingsClicked` | settings navigation failure is log-only. | pending |
| app/BibleOnSite\Pages\PerekPage.WindowsBack.cs:96 | `OnReaderKeyboardBackInvoked` | reader Back navigation failure is log-only. | retained — async-void boundary; press already consumed; Windows-only |
| app/BibleOnSite\Pages\TanahpediaEntryPage.xaml.cs:125 | `OnOccurrenceTapped` | occurrence navigation failure alerts the user. | pending |
| app/BibleOnSite\Services\ArticleService.cs:84 | `GetArticlesByPerekIdAsync` | remote article fetch degrades to an empty list. | repaired — transport failures propagate; GraphQL errors/absent data still return empty. `ArticleResponseTests` asserts `HttpRequestException` propagates |
| app/BibleOnSite\Services\ArticleService.cs:146 | `GetArticleByIdAsync` | remote article fetch degrades to null. | repaired — single-article transport failure no longer falsified to null (real not-found still null) |
| app/BibleOnSite\Services\ArticleService.cs:204 | `GetArticlesByAuthorIdAsync` | remote author fetch degrades to an empty list. | repaired — author-list transport failure no longer falsified to empty |
| app/BibleOnSite\Services\AccessibilityStatement.cs:19 | `OpenAsync` | launcher failures are platform-specific; the user gets an alert. | pending |
| app/BibleOnSite\Pages\PerekPage.Search.cs:306 | `OnSearchResultSelected` | search-result navigation failure alerts the user. | pending |
| app/BibleOnSite\Services\AnalyticsService.cs:51 | `SetScreen` | analytics event failure must never crash the reader. | retained — telemetry must never crash the reader |
| app/BibleOnSite\Services\AnalyticsService.cs:75 | `LogSearch` | analytics event failure must never crash the reader. | retained — same telemetry boundary |
| app/BibleOnSite\Services\MpegRecitationAudioDecoder.cs:33 | `ReleaseAsync` | JS reset failure marks the decoder uninitialized so the next use retries. | retained — catch performs recovery (`_initialized=false` → next use retries) |
| app/BibleOnSite\Services\NetworkService.cs:78 | `OnConnectivityChanged` | connectivity-refresh failure is log-only. | retained — connectivity-refresh is background log-only; no state written on failure |
| app/BibleOnSite\Services\PadDeliveryService.cs:254 | `TryGetAssetPathAndroidAsync` | pack-location probe: any failure counts as unavailable. | pending |
| app/BibleOnSite\Services\PadDeliveryService.cs:358 | `FetchAndroidAsync` | pack fetch failure is surfaced via LastAndroidPadError and a false result. | pending |
| app/BibleOnSite\Services\PadDeliveryService.cs:398 | `GetDeliveryDiagnosticsAndroidAsync` | diagnostics collection: pack-location failure becomes a report line. | pending |
| app/BibleOnSite\Services\PadDeliveryService.cs:441 | `AppendInstallSourceLines` | diagnostics collection: installer-source failure becomes a report line. | pending |
| app/BibleOnSite\Services\PadDeliveryService.cs:554 | `TryGetAssetPathIosAsync` | asset-path lookup failure counts as unavailable. | pending |
| app/BibleOnSite\Services\PadDeliveryService.cs:625 | `FetchIosAsync` | delivery fetch failure is surfaced via LastIosDeliveryError and a false result. | pending |
| app/BibleOnSite\Services\PadDeliveryService.cs:818 | `SavePackFileAsync` | payload save failure returns a false result. | retained — save failure → truthful false result; caller treats as failed download |
| app/BibleOnSite\Services\PadDeliveryService.cs:845 | `CancelAssetPackDownload` | download cancel is best-effort. | pending |
| app/BibleOnSite\Services\PadDeliveryService.cs:868 | `GetDeliveryDiagnosticsIosAsync` | diagnostics collection: cached-file info failure becomes a report line. | pending |
| app/BibleOnSite\Services\PadDeliveryService.cs:886 | `GetDeliveryDiagnosticsIosAsync` | diagnostics collection: Info.plist probe failure becomes a report line. | pending |
| app/BibleOnSite\Services\PadDeliveryService.cs:901 | `GetDeliveryDiagnosticsIosAsync` | diagnostics collection: app-group probe failure becomes a report line. | pending |
| app/BibleOnSite\Services\PadDeliveryService.cs:940 | `GetDeliveryDiagnosticsIosAsync` | diagnostics collection: local-status probe failure becomes a report line. | pending |
| app/BibleOnSite\Services\PadDeliveryService.cs:952 | `GetDeliveryDiagnosticsIosAsync` | diagnostics collection: availability probe failure becomes a report line. | pending |
| app/BibleOnSite\Services\PadDeliveryService.cs:965 | `GetDeliveryDiagnosticsIosAsync` | diagnostics collection: store-pack list failure becomes a report line. | pending |
| app/BibleOnSite\Services\PadDeliveryService.cs:979 | `?` | diagnostics collection: disk-space probe failure becomes a report line. | pending |
| app/BibleOnSite\Pages\ParashaPage.xaml.cs:387 | `OnAppearing` | failure boundary: a failed parasha load lands on the retryable error panel instead of crashing the reader. | retained — same retry-panel contract |
| app/BibleOnSite\Pages\ParashaPage.xaml.cs:458 | `RefreshPerushimIfAvailabilityChangedAsync` | on-appearing refresh is best-effort. | pending |
| app/BibleOnSite\Pages\ParashaPage.xaml.cs:590 | `OnParashaLoadRetryClicked` | failure boundary: a failed retry must land back on the retryable error panel, not crash the reader. | retained — same retry-panel contract on the retry path |
| app/BibleOnSite\Pages\ParashaPage.xaml.cs:897 | `UpdateArticlesCountAsync` | articles-count badge degrades to hidden. | pending |
| app/BibleOnSite\Pages\ParashaPage.xaml.cs:926 | `OnArticlesButtonClicked` | articles-button styling failure is log-only. | pending |
| app/BibleOnSite\Pages\ParashaPage.xaml.cs:972 | `OnArticleSelected` | article navigation failure is log-only. | pending |
| app/BibleOnSite\Services\PreferencesService.cs:618 | `Load` | corrupt bookmarks JSON resets to an empty set. | narrowed to JsonException + logged (was silent data-loss risk) |
| app/BibleOnSite\Services\PerushimNotesService.cs:194 | `GetDiagnosticsAsync` | diagnostics collection: any failure becomes a report line. | pending |
| app/BibleOnSite\Services\PerushimNotesService.cs:203 | `GetDiagnosticsAsync` | diagnostics collection: any failure becomes a report line. | pending |
| app/BibleOnSite\Services\PerushimNotesService.cs:247 | `GetDiagnosticsAsync` | diagnostics collection: any failure becomes a report line. | pending |
| app/BibleOnSite\Services\PerushimNotesService.cs:265 | `AppPackageHasNotesAsync` | any package-probe failure means "no notes"; callers degrade, never abort. | pending |
| app/BibleOnSite\Services\PerushimNotesService.cs:530 | `ValidateLocalNotesCoreAsync` | validation failure rejects the pack generation. | retained — ambiguous failure rejects pack but not generation (equal-build replacement stays allowed) |
| app/BibleOnSite\Services\PerushimNotesService.cs:816 | `TryUpgradeFromPadAsync` | PAD check/upgrade is best-effort. | pending |
| app/BibleOnSite\Services\PerushimNotesService.cs:893 | `TryCopyFromPadAsync` | pack copy failure degrades to not-copied. | pending |
| app/BibleOnSite\Services\PerushimNotesService.cs:950 | `TryCopyFromAppPackageAsync` | package copy failure degrades to not-copied. | pending |
| app/BibleOnSite\Services\StarterService.cs:229 | `LoadWithRetryAsync` | starter API failure falls back to local cache. | retained (fault tests exist) + log full exception |
| app/BibleOnSite\Services\StarterService.cs:246 | `LoadWithRetryAsync` | cache load failure proceeds offline without articles. | retained (fault tests exist) + log full exception |
| app/BibleOnSite\Services\StarterService.cs:272 | `TryRefreshAsync` | background refresh failure is log-only. | retained (fault tests exist) + log full exception |
| app/BibleOnSite\Services\StarterService.cs:292 | `SaveCacheAsync` | cache save is best-effort. | retained (fault tests exist) + log full exception |

## Unfiltered sites — devops (8)

| Site | Member | Reason | Disposition |
|------|--------|--------|-------------|
| app/devops\Build.Run.cs:75 | `?` | API probe: any failure counts as not-running. | pending |
| app/devops\Build.Run.cs:91 | `IsPortOpen` | TCP probe: any failure counts as closed. | pending |
| app/devops\Build.Run.cs:214 | `session` | env-file load failure warns and continues with defaults. | pending |
| app/devops\Build.Run.cs:422 | `?` | adb package probe: any failure counts as not-installed. | pending |
| app/devops\Build.Run.cs:584 | `?` | adb device probe: any failure counts as no-device. | pending |
| app/devops\Build.Run.cs:634 | `?` | adb id probe: any failure counts as absent. | pending |
| app/devops\Build.Run.cs:687 | `?` | avd probe: any failure counts as none. | pending |
| app/devops\Build.Run.cs:769 | `?` | adb push probe: any failure counts as failed. | pending |

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
any unannotated sites that slip back in.
