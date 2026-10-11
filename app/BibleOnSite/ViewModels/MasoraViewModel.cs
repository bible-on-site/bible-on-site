using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using BibleOnSite.Helpers;
using BibleOnSite.Models;
using BibleOnSite.Services;

namespace BibleOnSite.ViewModels;

/// <summary>
/// ViewModel for the מסורה על הפרק reader — Masoretic parasha units delimited by
/// ptuha/stuma breaks. Mirrors <see cref="PerekViewModel"/>'s carousel +
/// perushim + articles pipeline, but navigates stable unit ids (1..N) whose
/// rows are canonical pesukim clipped to the unit's inclusive ranges —
/// scripture is resolved from the existing corpus, never copied.
/// </summary>
// Codacy: S2333 false positive — partial is required by the MVVM source
// generators ([ObservableProperty]/[RelayCommand]) and the Perushim part.
#pragma warning disable S2333
public partial class MasoraViewModel : ObservableObject
#pragma warning restore S2333
{
    private readonly MasoraDataService _masoraDataService;
    private readonly PerekDataService _perekDataService;
    private readonly PerushimCatalogService _catalogService;
    private readonly PerushimNotesService _notesService;
    private readonly PreferencesService _preferencesService;
    private readonly Func<int, Task<List<Article>>>? _articlesLoader;

    // Using fields with [ObservableProperty] - the MVVMTK0045 warnings are acceptable
    // as we're not targeting AOT scenarios for WinRT marshalling.
#pragma warning disable MVVMTK0045
    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(UnitId))]
    [NotifyPropertyChangedFor(nameof(Heading))]
    [NotifyPropertyChangedFor(nameof(SeferId))]
    [NotifyPropertyChangedFor(nameof(SeferName))]
    [NotifyPropertyChangedFor(nameof(UnitOrder))]
    [NotifyPropertyChangedFor(nameof(ClosingBreakLabel))]
    [NotifyPropertyChangedFor(nameof(HasClosingBreak))]
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
    private MasoraUnit? _unit;

    /// <summary>Carousel collection holding all units for swipe navigation.</summary>
    [ObservableProperty]
    private System.Collections.ObjectModel.ObservableCollection<MasoraUnit> _carouselUnits = new();

    /// <summary>Current carousel position (index into <see cref="CarouselUnits"/>).</summary>
    [ObservableProperty]
    private int _carouselPosition;

    /// <summary>Currently displayed carousel unit.</summary>
    [ObservableProperty]
    private MasoraUnit? _currentCarouselUnit;

    /// <summary>Available perushim for the current unit (union over its perakim, priority order).</summary>
    [ObservableProperty]
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

    /// <summary>Articles overlapping the current unit's ranges (for the articles panel/badge).</summary>
    [ObservableProperty]
    private List<Article> _articles = new();

    /// <summary>Used for article list selection highlight (rounded, theme-aware).</summary>
    [ObservableProperty]
    private int? _selectedArticleId;

    /// <summary>Font scaling factor from user preferences (0.5-2.0).</summary>
    [ObservableProperty]
    private double _fontFactor = 1.0;
#pragma warning restore MVVMTK0045

    /// <summary>Message shown when no perushim (empty list or not available).</summary>
    public string PerushimEmptyMessage =>
        !PerushimCatalogAvailable ? "אין קטלוג פירושים" :
        !PerushimNotesAvailable ? "להוריד פירושים" :
        "אין פרשנות ליחידה זו";

    /// <summary>Whether to show the download perushim button (notes not yet available).</summary>
    public bool ShowDownloadPerushimButton => PerushimCatalogAvailable && !PerushimNotesAvailable;

    public MasoraViewModel() : this(MasoraDataService.Instance, PerekDataService.Instance,
        PreferencesService.Instance, null, null, null)
    {
    }

    public MasoraViewModel(MasoraDataService masoraDataService, PerekDataService perekDataService,
        PreferencesService preferencesService, PerushimCatalogService? catalogService,
        PerushimNotesService? notesService, Func<int, Task<List<Article>>>? articlesLoader)
    {
        _masoraDataService = masoraDataService;
        _perekDataService = perekDataService;
        _preferencesService = preferencesService;
        _catalogService = catalogService ?? PerushimCatalogService.Instance;
        _notesService = notesService ?? PerushimNotesService.Instance;
#if MAUI
        _articlesLoader = articlesLoader ?? ArticleService.Instance.GetArticlesByPerekIdAsync;
#else
        _articlesLoader = articlesLoader;
#endif

        // Sync FontFactor from preferences and listen for changes
        _fontFactor = _preferencesService.FontFactor;
        _preferencesService.PreferencesChanged += (_, _) =>
        {
            if (Math.Abs(_fontFactor - _preferencesService.FontFactor) > 0.001)
            {
                FontFactor = _preferencesService.FontFactor;
            }
        };
    }

    #region Unit Properties

    public int UnitId => Unit?.UnitId ?? 0;

    public string Heading => Unit?.Heading ?? string.Empty;

    public int SeferId => Unit?.SeferId ?? 0;

    public string SeferName => Unit?.SeferName ?? string.Empty;

    public int UnitOrder => Unit?.UnitOrder ?? 0;

    /// <summary>"פרשה פתוחה"/"פרשה סתומה", empty for the sefer-closing unit.</summary>
    public string ClosingBreakLabel => Unit?.ClosingBreakLabel ?? string.Empty;

    public bool HasClosingBreak => Unit?.HasClosingBreak ?? false;

    /// <summary>"יחידה N מתוך M" — the unit's place inside the whole division.</summary>
    public string UnitPositionText =>
        Unit == null ? string.Empty : $"יחידה {UnitId} מתוך {_masoraDataService.UnitCount}";

    public int NextUnitId => _masoraDataService.GetAdjacentUnits(UnitId).Next?.UnitId ?? 0;

    public int PreviousUnitId => _masoraDataService.GetAdjacentUnits(UnitId).Prev?.UnitId ?? 0;

    /// <summary>True when next-unit navigation should be enabled.</summary>
    public bool CanGoToNextUnit => NextUnitId > 0;

    /// <summary>True when previous-unit navigation should be enabled.</summary>
    public bool CanGoToPreviousUnit => PreviousUnitId > 0;

    /// <summary>The count of articles overlapping the current unit.</summary>
    public int ArticlesCount => Articles.Count;

    /// <summary>Whether the current unit has any overlapping articles.</summary>
    public bool HasArticles => ArticlesCount > 0;

    /// <summary>Count of available perushim for the current unit.</summary>
    public int PerushimCount => Perushim.Count;

    /// <summary>Whether the current unit has any perushim.</summary>
    public bool HasPerushim => PerushimCount > 0;

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
        if (!_masoraDataService.IsLoaded)
        {
            await _masoraDataService.LoadAsync();
        }
        if (!_perekDataService.IsLoaded)
        {
            await _perekDataService.LoadAsync();
        }

        var unit = _masoraDataService.GetUnit(unitId);
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
        var index = IndexOfUnit(unitId);
        if (CarouselUnits.Count > 0 && index >= 0)
        {
            var target = _masoraDataService.GetUnit(unitId);
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

    /// <summary>
    /// Loads the next unit in canonical order.
    /// </summary>
    [RelayCommand(CanExecute = nameof(CanGoToNextUnit))]
    public async Task LoadNextAsync()
    {
        if (NextUnitId > 0 && NextUnitId != UnitId)
        {
            await NavigateToUnitAsync(NextUnitId);
        }
    }

    /// <summary>
    /// Loads the previous unit in canonical order.
    /// </summary>
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
        if (Unit == null || _masoraDataService.Units == null)
        {
            return;
        }

        var unit = Unit;
        var list = await Task.Run(() => _masoraDataService.Units.ToList());

        // Assign collection on the main thread.
        // NOTE: CarouselView resets Position to 0 when ItemsSource changes — the
        // code-behind ScrollTo(targetPos, animate:false) corrects this immediately.
        CarouselUnits = new System.Collections.ObjectModel.ObservableCollection<MasoraUnit>(list);
        CurrentCarouselUnit = unit;
    }

    /// <summary>
    /// Ensures the unit's clipped display rows are loaded (idempotent —
    /// cached on the unit object).
    /// </summary>
    public async Task EnsureRowsLoadedAsync(MasoraUnit unit)
    {
        if (unit.Rows.Count > 0)
        {
            return;
        }

        unit.Rows = await MasoraUnitText.BuildRowsAsync(
            unit,
            perekId => _perekDataService.LoadPasukimAsync(perekId),
            perekId => _perekDataService.GetPerekSource(perekId),
            FontFactor);
    }

    /// <summary>
    /// Pre-loads rows for units adjacent to the given center so the next swipe
    /// is instant. Runs on a background thread — never blocks the UI.
    /// </summary>
    public async Task PreloadAdjacentRowsAsync(int centerUnitId)
    {
        var units = _masoraDataService.Units;
        if (units == null)
        {
            return;
        }
        var index = IndexOfUnit(centerUnitId);
        if (index < 0)
        {
            return;
        }
        var start = Math.Max(0, index - RowsBufferHalf);
        var end = Math.Min(units.Count - 1, index + RowsBufferHalf);

        // Rows assignment hits bound carousel cells, so load off-thread then
        // assign on the UI context (same pattern as AssignLoadedPasukim).
        var toLoad = new List<MasoraUnit>();
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
            var result = new List<(MasoraUnit Unit, List<MasoraPasukRow> Rows)>();
            foreach (var u in toLoad)
            {
                var rows = await MasoraUnitText.BuildRowsAsync(
                    u,
                    perekId => _perekDataService.LoadPasukimAsync(perekId),
                    perekId => _perekDataService.GetPerekSource(perekId),
                    FontFactor);
                result.Add((u, rows));
            }
            return result;
        });

        foreach (var (u, rows) in loaded)
        {
            if (u.Rows.Count == 0)
            {
                u.Rows = rows;
            }
        }
    }

    /// <summary>Index of a unit inside the ordered Units list (-1 when missing).</summary>
    private int IndexOfUnit(int unitId)
    {
        var units = _masoraDataService.Units;
        if (units == null)
        {
            return -1;
        }
        for (var i = 0; i < units.Count; i++)
        {
            if (units[i].UnitId == unitId)
            {
                return i;
            }
        }
        return -1;
    }

    /// <summary>
    /// The unit containing the last-learnt perek — the reader's resume point.
    /// Falls back to the first unit when the stored perek is unreadable.
    /// </summary>
    public async Task<int> GetInitialUnitIdAsync()
    {
        if (!_masoraDataService.IsLoaded)
        {
            await _masoraDataService.LoadAsync();
        }
        var perekId = _preferencesService.LastLearntPerek ?? 1;
        var unit = _masoraDataService.GetUnitContainingPasuk(perekId, 1);
        return unit?.UnitId ?? 1;
    }

    /// <summary>The unit whose primary range contains the given perek's first pasuk.</summary>
    public int? GetUnitIdForPerek(int perekId) =>
        _masoraDataService.GetUnitContainingPasuk(perekId, 1)?.UnitId;

    /// <summary>
    /// Ensures the service is loaded, then resolves the unit containing the
    /// given perek's first pasuk (used by <c>?perekId=</c> deep navigation).
    /// </summary>
    public async Task<int?> GetUnitIdForPerekAsync(int perekId)
    {
        if (!_masoraDataService.IsLoaded)
        {
            await _masoraDataService.LoadAsync();
        }
        return GetUnitIdForPerek(perekId);
    }

    #endregion

    #region Articles

    /// <summary>
    /// Loads articles overlapping the current unit — the union of each covered
    /// perek's articles, deduplicated by id (an article may attach to several
    /// of the unit's perakim).
    /// </summary>
    public async Task LoadArticlesAsync(MasoraUnit unit)
    {
        if (_articlesLoader == null)
        {
            Articles = new List<Article>();
            unit.ArticlesCount = 0;
            return;
        }

        var perekIds = MasoraUnitText.PerekIdsForUnit(unit);
        var byId = new Dictionary<int, Article>();
        foreach (var perekId in perekIds)
        {
            var articles = await _articlesLoader(perekId);
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
    private void SetUnit(MasoraUnit unit)
    {
        Unit = unit;
    }
}
