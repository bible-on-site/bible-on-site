namespace BibleOnSite.Pages;

using BibleOnSite.Helpers;
using BibleOnSite.Models;
using BibleOnSite.Services;
using BibleOnSite.ViewModels;

/// <summary>
/// Reader page for מועדים על הפרק — one published occasion of the DB-backed
/// catalogue, rendered as its ordered labelled sections (#3261). Shares the
/// על הפרק reader's interaction model (perushim sheet, articles, circular
/// menu, selection bar, focused pasuk, recitation) while navigating the
/// canonical slug; rows are canonical pesukim clipped to each section's
/// ordered inclusive ranges — never a copied scripture corpus.
/// </summary>
// Codacy: S2333 false positive — partial is required by the XAML code
// generator and by the recitation/desktop partial parts.
#pragma warning disable S2333
public partial class MoedPage : ContentPage, IQueryAttributable //NOSONAR
#pragma warning restore S2333
{
    private readonly MoedViewModel _viewModel;
    private bool _isLoading;

    // Articles view state is owned by the shared reader chrome (#2573).
    private ReaderChrome _chrome = null!;

    // Native safe-area + Back plumbing is owned by the shared platform
    // chrome coordinator (#2573).
    private ReaderPlatformChrome _platformChrome = null!;

    // Font/theme/notes availability sync is owned by the shared display-sync
    // coordinator (#2573).
    private ReaderDisplaySync _displaySync = null!;

    // Slug requested via query attributes before the initial load finished —
    // the canonical deep-link key (list taps and /moadim/{slug} links).
    private string? _pendingSlug;

    // Id requested via query attributes; resolved through the loaded catalogue.
    private int? _pendingId;

    public MoedPage()
    {
        InitializeComponent();
        _viewModel = new MoedViewModel();
        BindingContext = _viewModel;
        FinishSetup();
    }

    public MoedPage(MoedViewModel viewModel)
    {
        InitializeComponent();
        _viewModel = viewModel;
        BindingContext = _viewModel;
        FinishSetup();
    }

    private void FinishSetup()
    {
        SetupReaderChrome();
        SubscribeViewModelChanges();
        SetupDisplaySync();
        SetupNavigationReset();
        SetupPlatformChrome();
    }

    /// <summary>
    /// Wires the shared reader chrome — bottom bar, perushim sheet, articles
    /// view, fullscreen and fan prev/next refresh — through the one
    /// coordinator every reader page uses (#2573). Only the division adapters
    /// differ: unit ids, unit articles, unit navigation.
    /// </summary>
    private void SetupReaderChrome()
    {
        _chrome = new ReaderChrome(
            new ReaderChromeSurfaces
            {
                BottomBar = BottomBar,
                PerushimSheet = PerushimPanel,
                FanMenu = FanMenu,
                PreviousSatellite = PrevMoedButton,
                NextSatellite = NextMoedButton,
                ExitFullscreenButton = ExitFullScreenButton,
                ArticlesView = ArticlesCollection,
                ReaderContent = MoedRowsCollection,
                Toolbar = ReaderToolbar,
                Host = MainGrid,
                ContentArea = ContentArea,
            },
            new ReaderChromeActions
            {
                ReloadArticlesAsync = ShowUnitArticlesAsync,
                CurrentUnit = () => _viewModel.Unit,
                SelectArticle = id => _viewModel.SelectedArticleId = id,
                CanGoPrevious = () => _viewModel.CanGoToPreviousUnit,
                CanGoNext = () => _viewModel.CanGoToNextUnit,
                IsSelectableUnit = unitId => MoedService.Instance.GetMoed(unitId) != null,
                CurrentUnitId = () => _viewModel.UnitId,
                NavigateToUnitAsync = unitId => _viewModel.NavigateToUnitAsync(unitId),
            });
    }

    /// <summary>
    /// Wires the platform chrome every reader shares (#2573) — iOS safe-area
    /// and edge-back history, Android predictive-Back registration, and the
    /// capsule's enabled-state provider — through the one coordinator.
    /// The moed reader's transient return surfaces are fullscreen, the
    /// focused pasuk overlay and the perushim sheet (#2766): the capsule
    /// stays enabled while any of them is up — the same surfaces
    /// <see cref="TryHandleReaderBack"/> serves (#2467). The reader's
    /// scrolling list takes the carousel slot as the pan-vs-edge-back target.
    /// </summary>
    private void SetupPlatformChrome()
    {
        _platformChrome = new ReaderPlatformChrome(
            new ReaderPlatformChromeSurfaces
            {
                Page = this,
                Root = MainGrid,
                NavigationBar = NormalNavigationBar,
                BottomBar = BottomBar,
                FanMenu = FanMenu,
                Carousel = MoedRowsCollection,
                BackSensitiveOverlays = [ExitFullScreenButton, FocusedPasukOverlay],
                PerushimSheet = PerushimPanel,
                StatusBarColorSource = ReaderToolbar,
                SelectionSurface = SelectionBar,
            },
            new ReaderPlatformChromeActions
            {
                OwnsReturnSurface = OwnsReaderReturnSurface,
                TryHandleBack = TryHandleReaderBack,
            });
    }

    /// <summary>
    /// Wires the shared display-sync coordinator (#2573) — font resources,
    /// theme refresh of the realized pesukim and notes-materialization
    /// re-check — through the one implementation every reader page uses.
    /// </summary>
    private void SetupDisplaySync()
    {
        _displaySync = new ReaderDisplaySync(
            new ReaderDisplaySyncSurfaces
            {
                Page = this,
                Notes = PerushimNotesService.Instance,
                Preferences = PreferencesService.Instance,
            },
            new ReaderDisplaySyncActions
            {
                LoadedPasukim = () => _viewModel.Rows
                    .Select(row => row.Pasuk)
                    .OfType<Pasuk>(),
                NotesAvailable = () => _viewModel.PerushimNotesAvailable,
                NotesPending = () => _viewModel.PerushimNotesPending,
                ReloadNotesAsync = () => _viewModel.Unit is { } unit
                    ? _viewModel.LoadPerushimAsync(unit)
                    : Task.CompletedTask,
            });
    }

    /// <summary>
    /// Query attributes for deep navigation: <c>?slug=תשעה-באב</c> opens a moed
    /// by its canonical slug; <c>?id=3</c> resolves through the catalogue.
    /// </summary>
    public void ApplyQueryAttributes(IDictionary<string, object> query)
    {
        if (query.TryGetValue("slug", out var slugValue))
        {
            _pendingSlug = slugValue as string;
        }
        else if (query.TryGetValue("id", out var idValue))
        {
            _pendingId = ParsePositiveInt(idValue);
        }
    }

    private static int? ParsePositiveInt(object value) => value switch
    {
        int i when i > 0 => i,
        string s when int.TryParse(s, out var parsed) && parsed > 0 => parsed,
        _ => null
    };

    /// <summary>
    /// Subscribes to ViewModel.NavigationRequested so programmatic navigation
    /// (prev/next satellites) resets the recitation session and the scroll
    /// position — a new moed starts at its first section.
    /// </summary>
    private void SetupNavigationReset()
    {
        _viewModel.NavigationRequested += (_, _) => OnUnitChanged();
    }

    private void SubscribeViewModelChanges()
    {
        _viewModel.PropertyChanged += (_, e) =>
        {
            // When the unit changes via prev/next, refresh articles and nav buttons
            if (e.PropertyName == nameof(MoedViewModel.Unit) || e.PropertyName == "Unit")
            {
                MainThread.BeginInvokeOnMainThread(OnUnitChangedOnMainThread);
            }
        };
    }

    /// <summary>Refreshes articles and nav-button visuals after a unit change (main thread).</summary>
    private void OnUnitChangedOnMainThread()
    {
        ClearAllSelections();
        _ = UpdateArticlesCountAsync();
        if (_chrome.IsShowingArticles)
        {
            _ = ShowUnitArticlesAsync();
        }
        _chrome.RefreshPrevNext();
    }

    /// <summary>The moed swap path shared by NavigationRequested and the unit setter.</summary>
    private void OnUnitChanged()
    {
        ResetRecitationSession();
        // ScrollTo(0) throws on an empty items source — a published moed with
        // no readable ranges leaves no rows to reset.
        if (_viewModel.Rows.Count > 0)
        {
            MoedRowsCollection.ScrollTo(0, position: ScrollToPosition.Start, animate: false);
        }
        ClearAllSelections();
        _chrome.RefreshPrevNext();
        _ = UpdateArticlesCountAsync();
        if (_chrome.IsShowingArticles)
        {
            _ = ShowUnitArticlesAsync();
        }
    }

    protected override async void OnAppearing()
    {
        base.OnAppearing();
        _platformChrome.Appearing();
        SubscribeRecitation();
        await InitializeRecitationAsync();

        if (_viewModel.Unit == null && !_isLoading)
        {
            _isLoading = true;
            await LoadInitialUnitAsync();
        }
        else if (_viewModel.UnitId > 0 && !_isLoading)
        {
            // Perushim may have been installed (downloaded in Preferences) or cleared by the OS
            // since this page last appeared. Re-check and reload so they show without an app restart.
            await _displaySync.RefreshNotesIfAvailabilityChangedAsync();
        }
        // Cold-start main-thread work is done — release the deferred e2e
        // search-index warmup so it cannot starve the accessibility snapshot.
        Services.SearchIndexService.NotifyStartupSettled();
        _platformChrome.ScheduleHistoryRefresh();
    }

    private void OnReaderListLoaded(object? sender, EventArgs e) =>
        _platformChrome.ReaderSurfaceRealized();

    /// <summary>Loads the initial moed — the pending slug/id, else the catalogue's first.</summary>
    private async Task LoadInitialUnitAsync()
    {
        try
        {
            MoedLoadingOverlay.ShowLoading();

            var slug = _pendingSlug;
            var id = _pendingId;

            if (!string.IsNullOrEmpty(slug))
            {
                await _viewModel.LoadBySlugAsync(slug);
            }
            else if (id is int moedId)
            {
                await _viewModel.LoadByIdAsync(moedId);
            }
            else
            {
                await _viewModel.LoadInitialAsync();
            }

            if (_viewModel.IsUnavailable)
            {
                MoedLoadingOverlay.ShowError(new InvalidOperationException(
                    string.IsNullOrEmpty(slug)
                        ? "קטלוג המועדים אינו זמין"
                        : "המועד המבוקש אינו זמין"));
                return;
            }

            // Resolved — the requested destination is consumed. Pending values
            // survive a failed load so the retry overlay still targets the
            // deep-linked moed rather than the catalogue's first entry (#3261).
            _pendingSlug = null;
            _pendingId = null;
            MoedLoadingOverlay.Hide();
            await UpdateArticlesCountAsync();
        }
        #pragma warning disable S2221 // Deliberate failure boundary: unit load failure surfaces on the retryable overlay (#2084)
        catch (Exception ex) //NOSONAR — unit load failure surfaces on the retryable overlay (#2084).
        {
            #pragma warning restore S2221
            Console.Error.WriteLine($"Failed to load moed: {ex.Message}");
            MoedLoadingOverlay.ShowError(ex);
        }
        finally
        {
            _isLoading = false;
        }
    }

    /// <summary>Retry button on the load-failure overlay — re-runs the full fresh load.</summary>
    private async void OnMoedLoadRetryClicked(object? sender, EventArgs e)
    {
        if (_isLoading)
        {
            return;
        }
        _isLoading = true;
        await LoadInitialUnitAsync();
    }

    protected override void OnDisappearing()
    {
        _platformChrome.Disappearing();
        ResetRecitationSession();
        PreferencesService.Instance.PreferencesChanged -= OnRecitationPreferencesChanged;
        RecitationService.Instance.Changed -= OnRecitationPackageChanged;
        RecitationService.Instance.PlaybackStopRequested -= OnPlaybackStopRequested;
        base.OnDisappearing();
    }

    #region Circular Menu

    /// <summary>Handles tap on a satellite menu item — the menu closes.</summary>
    private async void OnMenuItemClicked(object? sender, EventArgs e)
    {
        // Command-based buttons already fired their command; just close.
        await FanMenu.CloseAsync();
    }

    #endregion

    #region Navigation & Catalogue

    /// <summary>Title tap — opens the moadim catalogue to pick another moed.</summary>
    private async void OnMoedSourceClicked(object? sender, EventArgs e)
    {
        await ShellAppNavigator.Instance.GoToAsync(
            AppRoutes.FlyoutPage(AppRoutes.Moadim, Shell.Current.CurrentState.Location.OriginalString));
    }

    private async void OnMoedListClicked(object? sender, EventArgs e)
    {
        await FanMenu.CloseAsync();
        await ShellAppNavigator.Instance.GoToAsync(
            AppRoutes.FlyoutPage(AppRoutes.Moadim, Shell.Current.CurrentState.Location.OriginalString));
    }

    #endregion

    #region Articles

    /// <summary>Updates the articles count badge for the current moed.</summary>
    private async Task UpdateArticlesCountAsync()
    {
        try
        {
            var unit = _viewModel.Unit;
            if (unit == null)
            {
                return;
            }
            await _viewModel.LoadArticlesAsync(unit);
        }
        #pragma warning disable S2221 // Deliberate failure boundary: articles-count badge degrades to hidden
        catch (Exception ex) //NOSONAR — articles-count badge degrades to hidden.
        {
            #pragma warning restore S2221
            Console.Error.WriteLine($"Error fetching articles count: {ex.Message}");
        }
    }

    /// <summary>
    /// Pushes the moed's loaded articles into the articles grid — the shared
    /// chrome calls this through its ReloadArticlesAsync adapter when the
    /// articles view opens or the moed changes underneath it.
    /// </summary>
    private async Task ShowUnitArticlesAsync()
    {
        var unit = _viewModel.Unit;
        if (unit == null)
        {
            return;
        }
        await _viewModel.LoadArticlesAsync(unit);
        ArticlesCollection.ItemsSource = _viewModel.Articles;
    }

    #endregion

    #region Back

    protected override bool OnBackButtonPressed()
    {
        return TryHandleReaderBack() || base.OnBackButtonPressed();
    }

    private bool TryHandleReaderBack()
    {
        // Match the other readers' foreground-first policy: a focused pasuk
        // owns Back before the commentary sheet covered by its overlay (#3307).
        var owner = ReaderBackPolicy.Resolve(
            exitFullScreenVisible: ExitFullScreenButton.IsVisible,
            unitPickerOpen: false,
            fanMenuOpen: FanMenu.IsOpen,
            menuOverlayOpen: false,
            chapterSearchOpen: false,
            focusedPasuk: _focusedPasuk != null,
            perushimSheetOpen: PerushimPanel.IsOpen,
            selectionSurfacesActive: ReaderSurfaceState.IsActive(_viewModel.SelectedPasukCount,
                _unitRecitationSelection, focusedPasuk: false, Recitation.Cursor.PlayingKey != null));
        switch (owner)
        {
            case ReaderBackSurface.ExitFullScreen:
                _chrome.ExitFullScreen();
                return true;
            case ReaderBackSurface.FanMenu:
                _ = FanMenu.CloseAsync();
                return true;
            case ReaderBackSurface.PerushimSheet:
                PerushimPanel.CloseImmediate();
                return true;
            case ReaderBackSurface.FocusedPasuk:
            case ReaderBackSurface.SelectionSurfaces:
                ClearAllSelections();
                return true;
            default:
                return false;
        }
    }

    /// <summary>
    /// The capsule back affordance stays enabled while any transient surface
    /// the back pipeline serves is up (#2467).
    /// </summary>
    private bool OwnsReaderReturnSurface() =>
        ExitFullScreenButton.IsVisible
        || PerushimPanel.IsOpen
        || ReaderSurfaceState.IsActive(_viewModel.SelectedPasukCount,
            _unitRecitationSelection, _focusedPasuk != null,
            Recitation.Cursor.PlayingKey != null);

    /// <summary>
    /// Links inside rendered note content: /929/ targets navigate natively,
    /// /pedia/ slugs open the Tanahpedia entry page, the rest open in the
    /// browser (#1227).
    /// </summary>
    private async void OnContentLinkTapped(object? sender, Controls.LinkTappedEventArgs e)
    {
        e.Handled = true;
        try
        {
            await AppLinkHelper.FollowHtmlLinkAsync(e.Url, Launcher.Default, ShellAppNavigator.Instance);
        }
        #pragma warning disable S2221 // Deliberate failure boundary: link navigation/launcher failure must not crash the reader
        catch (Exception ex) //NOSONAR — link navigation/launcher failure must not crash the reader.
        {
            #pragma warning restore S2221
            // async void - an unhandled navigation/launcher exception is a crash.
            Console.Error.WriteLine($"Content link navigation failed for {e.Url}: {ex}");
        }
    }

    #endregion
}
