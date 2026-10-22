using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using BibleOnSite.Helpers;
using BibleOnSite.Models;
using BibleOnSite.Services;

namespace BibleOnSite.ViewModels;

/// <summary>
/// ViewModel for the פרשה על הפרק reader — weekly Torah parashot plus
/// their ordered Haftarah variants. Shares the על הפרק reader's
/// carousel + perushim + articles + reading-modes pipeline through the
/// same building blocks <see cref="MasoraViewModel"/> uses, navigating
/// stable unit ids (1..54) whose rows are canonical pesukim clipped to
/// the unit's inclusive ranges — scripture is resolved from the existing
/// corpus, never copied.
/// </summary>
// Codacy: S2333 false positive — partial is required by the MVVM source
// generators ([ObservableProperty]/[RelayCommand]) and the Perushim part.
#pragma warning disable S2333
public partial class ParashaViewModel : ObservableObject //NOSONAR
#pragma warning restore S2333
{
    private readonly ParashaDataService _parashaService;
    private readonly PerekDataService _perekService;
    private readonly PerushimCatalogService _catalogService;
    private readonly PerushimNotesService _notesService;
    private readonly PreferencesService _preferencesService;
    private readonly Func<int, Task<List<Article>>>? _articlesLoader;
    private readonly Func<int, bool>? _hasPerekAudio;

    // Using fields with [ObservableProperty] - the MVVMTK0045 warnings are acceptable
    // as we're not targeting AOT scenarios for WinRT marshalling.
#pragma warning disable MVVMTK0045
    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(UnitId))]
    [NotifyPropertyChangedFor(nameof(Heading))]
    [NotifyPropertyChangedFor(nameof(Title))]
    [NotifyPropertyChangedFor(nameof(Source))]
    [NotifyPropertyChangedFor(nameof(SeferId))]
    [NotifyPropertyChangedFor(nameof(UnitOrder))]
    [NotifyPropertyChangedFor(nameof(UnitPositionText))]
    [NotifyPropertyChangedFor(nameof(NextUnitId))]
    [NotifyPropertyChangedFor(nameof(PreviousUnitId))]
    [NotifyPropertyChangedFor(nameof(CanGoToNextUnit))]
    [NotifyPropertyChangedFor(nameof(CanGoToPreviousUnit))]
    [NotifyPropertyChangedFor(nameof(ArticlesCount))]
    [NotifyPropertyChangedFor(nameof(HasArticles))]
    [NotifyPropertyChangedFor(nameof(PerushimCount))]
    [NotifyPropertyChangedFor(nameof(HasPerushim))]
#if MAUI
    [NotifyCanExecuteChangedFor(nameof(LoadNextCommand))]
    [NotifyCanExecuteChangedFor(nameof(LoadPreviousCommand))]
#endif
    private ParashaUnit? _unit;

    /// <summary>Carousel collection holding all units for swipe navigation.</summary>
    [ObservableProperty]
    private System.Collections.ObjectModel.ObservableCollection<ParashaUnit> _carouselUnits = new();

    /// <summary>Current carousel position (index into <see cref="CarouselUnits"/>).</summary>
    [ObservableProperty]
    private int _carouselPosition;

    /// <summary>Currently displayed carousel unit.</summary>
    [ObservableProperty]
    private ParashaUnit? _currentCarouselUnit;

    /// <summary>Available perushim for the current unit (union over its readings' perakim).</summary>
    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(FilteredPerushim))]
    private List<Perush> _perushim = new();

    /// <summary>Perush IDs that are currently checked (shown inline with text).</summary>
    [ObservableProperty]
    private List<int> _checkedPerushim = new();

    /// <summary>Whether the perushim notes database is available (PAD or HTTP downloaded).</summary>
    [ObservableProperty]
    private bool _perushimNotesAvailable;

    /// <summary>Whether the perushim catalog is available (bundled).</summary>
    [ObservableProperty]
    private bool _perushimCatalogAvailable;

    /// <summary>Articles overlapping the current unit's readings (for the articles panel/badge).</summary>
    [ObservableProperty]
    private List<Article> _articles = new();

    /// <summary>Used for article list selection highlight (rounded, theme-aware).</summary>
    [ObservableProperty]
    private int? _selectedArticleId;

    /// <summary>Font scaling factor from user preferences (0.5-2.0).</summary>
    [ObservableProperty]
    private double _fontFactor = 1.0;

    /// <summary>שניים מקרא reading mode — renders every pasuk twice consecutively.</summary>
    [ObservableProperty]
    private bool _isShnayimMikraEnabled;

    /// <summary>תיקון קוראים reading mode — continuous flow with a tap-to-toggle marks.</summary>
    [ObservableProperty]
    private bool _isTikkunKorimEnabled;

    /// <summary>קריינות reading mode — header play button plus single-tap pasuk playback.</summary>
    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(ShowHeaderPlayButton))]
    private bool _isQriynotEnabled;

    /// <summary>Whether a recitation is downloaded for at least one perek of the displayed unit.</summary>
    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(ShowHeaderPlayButton))]
    private bool _hasCurrentUnitRecitation;

    /// <summary>The header play button shows only while קריינות is checked and audio exists.</summary>
    public bool ShowHeaderPlayButton => IsQriynotEnabled && HasCurrentUnitRecitation;

    /// <summary>Whether niqqud and taamim are currently hidden in תיקון קוראים mode.</summary>
    [ObservableProperty]
    private bool _tikkunMarksHidden;

    /// <summary>
    /// Bumped whenever הסתר שם השם settings change so every realized or
    /// recycled text row re-renders with the new masking.
    /// </summary>
    [ObservableProperty]
    private int _divineNameMaskingRevision;

    /// <summary>Canonical positions of the selected pesukim — (perekId, pasukNum).</summary>
    [ObservableProperty]
    private List<(int PerekId, int PasukNum)> _selectedPasukim = new();
#pragma warning restore MVVMTK0045

    partial void OnIsTikkunKorimEnabledChanged(bool value)
    {
        // Leaving the mode restores the original marked display settings.
        if (!value)
        {
            TikkunMarksHidden = false;
        }
    }

    partial void OnUnitChanged(ParashaUnit? value) => RefreshRecitationAvailability(value);

    partial void OnCurrentCarouselUnitChanged(ParashaUnit? oldValue, ParashaUnit? newValue)
    {
        if (oldValue is not null) { oldValue.IsOffscreenCarouselPage = true; }
        if (newValue is not null) { newValue.IsOffscreenCarouselPage = false; }
    }

    /// <summary>
    /// Re-evaluates whether the currently displayed unit has any downloaded
    /// recitation — controls the קריינות menu item and header play button.
    /// Called when the unit changes and after the recitation package updates.
    /// </summary>
    public void RefreshRecitationAvailability() => RefreshRecitationAvailability(Unit);

    private void RefreshRecitationAvailability(ParashaUnit? unit)
    {
        HasCurrentUnitRecitation = _hasPerekAudio != null && unit is { } current &&
            ParashaUnitText.PerekIdsForUnit(current).Any(_hasPerekAudio);
    }

    /// <summary>הסתר שם השם toggle — persisted through PreferencesService.</summary>
    public bool DivineNameMaskingEnabled
    {
        get => _preferencesService.DivineNameMaskingEnabled;
        set => _preferencesService.DivineNameMaskingEnabled = value;
    }

    /// <summary>Message shown when no perushim (empty list or not available).</summary>
    public string PerushimEmptyMessage =>
        Perushim.Count > 0 && !string.IsNullOrWhiteSpace(PerushNameFilter) ? "לא נמצאו פירושים תואמים" :
        !PerushimCatalogAvailable ? "אין קטלוג פירושים" :
        !PerushimNotesAvailable ? "להוריד פירושים" :
        "אין פרשנות לפרשה זו";

    /// <summary>Whether to show the download perushim button (notes not yet available).</summary>
    public bool ShowDownloadPerushimButton => PerushimCatalogAvailable && !PerushimNotesAvailable;

    /// <summary>
    /// The production articles loader — reads the StarterService startup
    /// snapshot (all articles + authors already in memory, ordered by
    /// Priority), so unit swipes issue no GraphQL round-trips.
    /// </summary>
    private static Func<int, Task<List<Article>>>? DefaultArticlesLoader =>
#if MAUI
        perekId => Task.FromResult(StarterService.Instance.GetArticlesByPerekId(perekId));
#else
        null;
#endif

    public ParashaViewModel() : this(ParashaDataService.Instance, PerekDataService.Instance,
        PreferencesService.Instance, null, null, DefaultArticlesLoader)
    {
    }

    public ParashaViewModel(ParashaDataService parashaService, PerekDataService perekService,
        PreferencesService preferencesService, PerushimCatalogService? catalogService,
        PerushimNotesService? notesService, Func<int, Task<List<Article>>>? articlesLoader)
        : this(parashaService, perekService, preferencesService, catalogService, notesService,
            articlesLoader, null)
    {
    }

    public ParashaViewModel(ParashaDataService parashaService, PerekDataService perekService,
        PreferencesService preferencesService, PerushimCatalogService? catalogService,
        PerushimNotesService? notesService, Func<int, Task<List<Article>>>? articlesLoader,
        Func<int, bool>? hasPerekAudio)
    {
        _parashaService = parashaService;
        _perekService = perekService;
        _preferencesService = preferencesService;
        _catalogService = catalogService ?? PerushimCatalogService.Instance;
        _notesService = notesService ?? PerushimNotesService.Instance;
        _articlesLoader = articlesLoader;
#if MAUI
        _hasPerekAudio = hasPerekAudio ?? (perekId => RecitationService.Instance.HasAudio(perekId));
#else
        _hasPerekAudio = hasPerekAudio;
#endif

        // Sync FontFactor from preferences and listen for changes
        _fontFactor = _preferencesService.FontFactor;
        _divineNameMaskingRevision = DivineNameMasking.Revision;
        WeakPreferencesSubscription.Subscribe(this, _preferencesService, static model => model.RefreshPreferences());
    }

    #region Unit Properties

    public int UnitId => Unit?.UnitId ?? 0;

    /// <summary>The parasha name, e.g. "בראשית".</summary>
    public string Heading => Unit?.Heading ?? string.Empty;

    /// <summary>"פרשת בראשית" — the reader's identity heading.</summary>
    public string Title => Unit == null ? string.Empty : $"פרשת {Unit.Heading}";

    /// <summary>The Torah range in original references, e.g. "בראשית א א - ו ח".</summary>
    public string Source => Unit == null ? string.Empty : RangeLabelOf(Unit.TorahRange);

    public int SeferId => Unit?.SeferId ?? 0;

    public int UnitOrder => Unit?.Order ?? 0;

    /// <summary>"פרשה N מתוך 54" — the unit's place inside the whole division.</summary>
    public string UnitPositionText =>
        Unit == null ? string.Empty : $"פרשה {UnitId} מתוך {_parashaService.UnitCount}";

    public int NextUnitId => _parashaService.GetAdjacentUnits(UnitId).Next?.UnitId ?? 0;

    public int PreviousUnitId => _parashaService.GetAdjacentUnits(UnitId).Prev?.UnitId ?? 0;

    /// <summary>True when next-unit navigation should be enabled.</summary>
    public bool CanGoToNextUnit => NextUnitId > 0;

    /// <summary>True when previous-unit navigation should be enabled.</summary>
    public bool CanGoToPreviousUnit => PreviousUnitId > 0;

    /// <summary>The count of articles overlapping the current unit.</summary>
    public int ArticlesCount => Articles.Count;

    /// <summary>Whether the current unit has any overlapping articles.</summary>
    public bool HasArticles => ArticlesCount > 0;

    /// <summary>Find commentary names in the selection menu — scrolls to the
    /// first match rather than hiding the rest.</summary>
    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(FilteredPerushim))]
    [NotifyPropertyChangedFor(nameof(PerushimEmptyMessage))]
    private string _perushNameFilter = string.Empty;

    /// <summary>Perushim matching <see cref="PerushNameFilter"/> — the list
    /// shows all of <see cref="Perushim"/>; this drives search scroll-to.</summary>
    public List<Perush> FilteredPerushim
    {
        get
        {
            if (string.IsNullOrWhiteSpace(PerushNameFilter))
            {
                return Perushim;
            }
            var filter = SearchText.Normalize(PerushNameFilter);
            return Perushim.Where(p => SearchText.Normalize(p.Name)
                .Contains(filter, StringComparison.Ordinal)).ToList();
        }
    }

    public int PerushimCount => Perushim.Count;

    /// <summary>Whether the current unit has any perushim.</summary>
    public bool HasPerushim => PerushimCount > 0;

    /// <summary>Formats a range in original references through the loaded perek metadata.</summary>
    public string RangeLabelOf(ScriptureRange range) =>
        ParashaUnitText.RangeLabel(
            range,
            perekId => _perekService.GetPerekSource(perekId),
            perekId => _perekService.GetPerek(perekId) is { } perek
                ? (perek.SeferName, perek.PerekNumber, perek.Additional)
                : null);

    /// <summary>Whether the unit renders the canonical pasuk anywhere in its readings.</summary>
    public bool UnitContainsPasuk(ParashaUnit unit, int perekId, int pasukNum) =>
        unit.Rows.Any(row => row.PerekId == perekId && row.PasukNum == pasukNum);

    /// <summary>The unit whose Torah range contains the given canonical pasuk, or null.</summary>
    public ParashaUnit? GetParashaContainingPasuk(int perekId, int pasukNum) =>
        _parashaService.GetParashaContainingPasuk(perekId, pasukNum);

    #endregion

    #region Selection

    /// <summary>Selected-pasuk count — drives the reader's selection bar.</summary>
    public int SelectedPasukCount => SelectedPasukim.Count;

    /// <summary>Toggles selection of a rendered pasuk (keyed canonically so a
    /// repeated or שניים מקרא pasuk toggles once).</summary>
    public void ToggleSelectedPasuk(int perekId, int pasukNum)
    {
        var list = new List<(int PerekId, int PasukNum)>(SelectedPasukim);
        var key = (perekId, pasukNum);
        if (list.Contains(key))
        {
            list.Remove(key);
        }
        else
        {
            list.Add(key);
        }
        SelectedPasukim = list;

        if (Unit != null)
        {
            foreach (var row in Unit.Rows)
            {
                if (row.Display is { } display && row.PerekId == perekId && display.PasukNum == pasukNum)
                {
                    display.Pasuk.IsSelected = list.Contains(key);
                }
            }
        }
        OnPropertyChanged(nameof(SelectedPasukCount));
    }

    /// <summary>Clears the whole selection.</summary>
    public void ClearSelected()
    {
        if (Unit != null)
        {
            foreach (var row in Unit.Rows)
            {
                if (row.Display is { Pasuk.IsSelected: true } display)
                {
                    display.Pasuk.IsSelected = false;
                }
            }
        }
        SelectedPasukim = new List<(int PerekId, int PasukNum)>();
        OnPropertyChanged(nameof(SelectedPasukCount));
    }

    /// <summary>Whether a canonical pasuk position is selected.</summary>
    public bool IsPasukSelected(int perekId, int pasukNum) =>
        SelectedPasukim.Contains((perekId, pasukNum));

    /// <summary>Selected pesukim in reader order (for share/copy).</summary>
    public List<(int PerekId, Pasuk Pasuk)> GetSelectedPesukim()
    {
        if (Unit == null || SelectedPasukim.Count == 0)
        {
            return new List<(int, Pasuk)>();
        }
        var selected = new HashSet<(int, int)>(SelectedPasukim);
        var seen = new HashSet<(int, int)>();
        var result = new List<(int PerekId, Pasuk Pasuk)>();
        foreach (var row in Unit.Rows)
        {
            var key = (row.PerekId, row.PasukNum);
            if (row.Display is { } display && selected.Contains(key) && seen.Add(key))
            {
                result.Add((row.PerekId, display.Pasuk));
            }
        }
        return result;
    }

    #endregion

#if MAUI
    #region Load Methods

    /// <summary>
    /// Asynchronously loads a unit by its stable id: resolves ranges against
    /// the canonical pesukim corpus, clips boundary pesukim, then loads
    /// perushim and initializes the carousel.
    /// </summary>
    public async Task LoadByUnitIdAsync(int unitId)
    {
        if (!_parashaService.IsLoaded)
        {
            await _parashaService.LoadAsync();
        }
        if (!_perekService.IsLoaded)
        {
            await _perekService.LoadAsync();
        }

        var unit = _parashaService.GetParasha(unitId);
        if (unit == null)
        {
            return;
        }

        await EnsureRowsLoadedAsync(unit);
        SetUnit(unit);
        await LoadPerushimAsync(unit);
        await InitializeCarouselAsync();
    }

    /// <summary>
    /// Raised when the ViewModel needs the CarouselView to jump to a new position.
    /// The code-behind subscribes and calls <c>ScrollTo(index, animate: false)</c>
    /// so the CarouselView jumps instantly instead of animating through every
    /// intermediate item.
    /// </summary>
    public event EventHandler<int>? NavigationRequested;

    /// <summary>
    /// Navigates to a unit by id. Prepares all ViewModel state first, then
    /// asks the code-behind to scroll the CarouselView without animation.
    /// </summary>
    public async Task NavigateToUnitAsync(int unitId)
    {
        var index = _parashaService.GetUnitIndex(unitId);
        if (CarouselUnits.Count > 0 && index >= 0)
        {
            var target = _parashaService.GetParasha(unitId);
            if (target != null)
            {
                await EnsureRowsLoadedAsync(target);
                SetUnit(target);
                // Load perushim before scrolling so the UI doesn't flash
                await LoadPerushimAsync(target);
                // Ask code-behind to scroll without animation
                NavigationRequested?.Invoke(this, index);
            }
        }
        else
        {
            // Carousel not yet initialized — full load
            await LoadByUnitIdAsync(unitId);
        }
    }

    /// <summary>Loads the next unit in canonical order.</summary>
    [RelayCommand(CanExecute = nameof(CanGoToNextUnit))]
    public async Task LoadNextAsync()
    {
        if (NextUnitId > 0 && NextUnitId != UnitId)
        {
            await NavigateToUnitAsync(NextUnitId);
        }
    }

    /// <summary>Loads the previous unit in canonical order.</summary>
    [RelayCommand(CanExecute = nameof(CanGoToPreviousUnit))]
    public async Task LoadPreviousAsync()
    {
        if (PreviousUnitId > 0 && PreviousUnitId != UnitId)
        {
            await NavigateToUnitAsync(PreviousUnitId);
        }
    }

    /// <summary>
    /// Half-window size for row pre-loading around the current unit. Units can
    /// hold a whole sidra of pesukim, so the buffer stays small.
    /// </summary>
    private const int RowsBufferHalf = 3;

    /// <summary>
    /// Initializes the carousel with ALL units (lightweight metadata — rows are
    /// lazy-loaded per unit on demand). List building runs on a background
    /// thread so the UI stays responsive.
    /// </summary>
    public async Task InitializeCarouselAsync()
    {
        if (Unit == null || _parashaService.Parashiot == null)
        {
            return;
        }

        var unit = Unit;
        var list = await Task.Run(() => _parashaService.Parashiot.ToList());

        // Assign collection on the main thread.
        // NOTE: CarouselView resets Position to 0 when ItemsSource changes — the
        // code-behind ScrollTo(targetPos, animate:false) corrects this immediately.
        CarouselUnits = new System.Collections.ObjectModel.ObservableCollection<ParashaUnit>(list);
        CurrentCarouselUnit = unit;
    }

    /// <summary>
    /// Ensures the unit's clipped display rows are loaded (idempotent —
    /// cached on the unit object).
    /// </summary>
    public async Task EnsureRowsLoadedAsync(ParashaUnit unit)
    {
        if (unit.Rows.Count > 0)
        {
            return;
        }

        var (rows, tikkunPasukim) = await ParashaUnitText.BuildRowsAsync(
            unit,
            perekId => _perekService.LoadPasukimAsync(perekId),
            perekId => _perekService.GetPerekSource(perekId),
            FontFactor,
            IsShnayimMikraEnabled);
        unit.TikkunPasukim = tikkunPasukim;
        unit.Rows = rows;
        unit.RangeLabel = RangeLabelOf(unit.TorahRange);
    }

    /// <summary>
    /// Rebuilds rows of every already-loaded unit after a display-mode change
    /// (שניים מקרא, font factor) — the same contract the perek reader's
    /// ItemsSource converter applies automatically.
    /// </summary>
    public async Task RebuildLoadedRowsAsync()
    {
        var loaded = CarouselUnits.Where(u => u.Rows.Count > 0).ToList();
        foreach (var unit in loaded)
        {
            var (rows, tikkunPasukim) = await ParashaUnitText.BuildRowsAsync(
                unit,
                perekId => _perekService.LoadPasukimAsync(perekId),
                perekId => _perekService.GetPerekSource(perekId),
                FontFactor,
                IsShnayimMikraEnabled);
            unit.TikkunPasukim = tikkunPasukim;
            unit.Rows = rows;
            unit.RangeLabel = RangeLabelOf(unit.TorahRange);
        }
        if (Unit != null)
        {
            FillFilteredPerushContents(Unit);
        }
    }

    /// <summary>
    /// Pre-loads rows for units adjacent to the given center so the next swipe
    /// is instant. Runs on a background thread — never blocks the UI.
    /// </summary>
    public async Task PreloadAdjacentRowsAsync(int centerUnitId)
    {
        var units = _parashaService.Parashiot;
        if (units == null)
        {
            return;
        }
        var index = _parashaService.GetUnitIndex(centerUnitId);
        if (index < 0)
        {
            return;
        }
        var start = Math.Max(0, index - RowsBufferHalf);
        var end = Math.Min(units.Count - 1, index + RowsBufferHalf);

        var toLoad = new List<ParashaUnit>();
        for (var i = start; i <= end; i++)
        {
            var u = units[i];
            if (u.Rows.Count == 0)
            {
                toLoad.Add(u);
            }
        }
        if (toLoad.Count == 0)
        {
            return;
        }

        var loaded = await Task.Run(async () =>
        {
            // Adjacent units share boundary perakim — one task-level cache
            // serves the whole batch so each perek hits SQLite once.
            var pasukimCache = new Dictionary<int, Task<List<Pasuk>>>();
            Task<List<Pasuk>> LoadPasukimCached(int perekId) =>
                pasukimCache.TryGetValue(perekId, out var pending)
                    ? pending
                    : pasukimCache[perekId] = _perekService.LoadPasukimAsync(perekId);
            var result = new List<(ParashaUnit Unit, List<ParashaDisplayItem> Rows, List<Pasuk> Tikkun)>();
            foreach (var u in toLoad)
            {
                var (rows, tikkun) = await ParashaUnitText.BuildRowsAsync(
                    u, LoadPasukimCached, perekId => _perekService.GetPerekSource(perekId),
                    FontFactor, IsShnayimMikraEnabled);
                result.Add((u, rows, tikkun));
            }
            return result;
        });

        foreach (var (u, rows, tikkun) in loaded)
        {
            if (u.Rows.Count == 0)
            {
                u.TikkunPasukim = tikkun;
                u.Rows = rows;
                u.RangeLabel = RangeLabelOf(u.TorahRange);
            }
        }
    }

    /// <summary>
    /// The parasha containing the last-learnt perek — the reader's resume
    /// point. Falls back to the first parasha when the stored perek is
    /// unreadable or outside the Torah corpus.
    /// </summary>
    public async Task<int> GetInitialUnitIdAsync()
    {
        if (!_parashaService.IsLoaded)
        {
            await _parashaService.LoadAsync();
        }
        var perekId = _preferencesService.LastLearntPerek ?? 1;
        var unit = _parashaService.GetParashaContainingPasuk(perekId, 1);
        return unit?.UnitId ?? 1;
    }

    /// <summary>The unit whose Torah range contains the given perek's first pasuk.</summary>
    public int? GetUnitIdForPerek(int perekId) =>
        _parashaService.GetParashaContainingPasuk(perekId, 1)?.UnitId;

    /// <summary>
    /// Ensures the service is loaded, then resolves the unit containing the
    /// given perek's first pasuk (used by <c>?perekId=</c> deep navigation).
    /// </summary>
    public async Task<int?> GetUnitIdForPerekAsync(int perekId)
    {
        if (!_parashaService.IsLoaded)
        {
            await _parashaService.LoadAsync();
        }
        return GetUnitIdForPerek(perekId);
    }

    /// <summary>
    /// The parasha containing a search hit's canonical position, or null when
    /// the pasuk sits outside every Torah range — used to keep a result
    /// inside the selected reading instance.
    /// </summary>
    public async Task<int?> GetUnitIdForPasukAsync(int perekId, int pasukNum)
    {
        if (!_parashaService.IsLoaded)
        {
            await _parashaService.LoadAsync();
        }
        return _parashaService.GetParashaContainingPasuk(perekId, pasukNum)?.UnitId;
    }

    #endregion

    #region Articles

    /// <summary>
    /// Loads articles overlapping the current unit — the union of each
    /// covered perek's articles over the unit's Torah and Haftarah readings,
    /// deduplicated by id (an article may attach to several perakim).
    /// </summary>
    public async Task LoadArticlesAsync(ParashaUnit unit)
    {
        if (_articlesLoader == null)
        {
            Articles = new List<Article>();
            unit.ArticlesCount = 0;
            return;
        }

        var perekIds = ParashaUnitText.PerekIdsForUnit(unit);
        // Per-perek fetches run in parallel; WhenAll preserves input order,
        // so the dedup sees them exactly as the sequential loop did.
        var perPerek = await Task.WhenAll(perekIds.Select(perekId => _articlesLoader(perekId)));
        var byId = new Dictionary<int, Article>();
        foreach (var articles in perPerek)
        {
            foreach (var article in articles)
            {
                byId[article.Id] = article;
            }
        }

        if (Unit?.UnitId != unit.UnitId)
        {
            return; // Stale load — a newer unit is already on screen.
        }

        Articles = byId.Values.ToList();
        unit.ArticlesCount = Articles.Count;
    }

    #endregion
#endif

    /// <summary>Sets the current unit.</summary>
    private void SetUnit(ParashaUnit unit)
    {
        Unit = unit;
    }

    private void RefreshPreferences()
    {
        var rebuild = Math.Abs(_fontFactor - _preferencesService.FontFactor) > 0.001;
        if (rebuild)
        {
            FontFactor = _preferencesService.FontFactor;
        }
        if (_divineNameMaskingRevision != DivineNameMasking.Revision)
        {
            DivineNameMaskingRevision = DivineNameMasking.Revision;
            rebuild = true;
        }
        OnPropertyChanged(nameof(DivineNameMaskingEnabled));
        OnPropertyChanged(nameof(InlineCommentaryLimitMessage));
        OnPropertyChanged(nameof(InlineCommentaryLimit));
        if (CheckedPerushim.Count > _preferencesService.InlineCommentaryLimit)
        {
            CheckedPerushim = CheckedPerushim.Take(_preferencesService.InlineCommentaryLimit).ToList();
#if MAUI
            if (Unit != null) { FillFilteredPerushContents(Unit); }
#endif
        }
        if (rebuild)
        {
            _ = RebuildLoadedRowsAsync();
        }
    }
}
