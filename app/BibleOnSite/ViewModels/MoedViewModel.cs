using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using BibleOnSite.Helpers;
using BibleOnSite.Models;
using BibleOnSite.Services;

namespace BibleOnSite.ViewModels;

/// <summary>
/// ViewModel for the מועדים על הפרק reader (#3261) — one published occasion
/// of the DB-backed catalogue, rendered as stacked labelled sections. Shares
/// the other readers' pipeline: rows are canonical pesukim clipped to the
/// moed's ordered inclusive ranges (never a copied corpus), perushim/articles
/// scope over the same slices, and recitation plans through the shared
/// range planner — whole-moed playback keys on <c>moed:{id}</c>, per-section
/// on <c>moed:{id}:s{sectionId}</c>.
/// </summary>
// Codacy: S2333 false positive — partial is required by the MVVM source
// generators ([ObservableProperty]/[RelayCommand]) and the Perushim part.
#pragma warning disable S2333
public partial class MoedViewModel : ObservableObject, IPerushimSheetViewModel //NOSONAR
#pragma warning restore S2333
{
    private readonly MoedService _moedService;
    private readonly PerekDataService _perekDataService;
    private readonly PerushimCatalogService _catalogService;
    private readonly PerushimNotesService _notesService;
    private readonly PreferencesService _preferencesService;
    private readonly Func<List<Article>>? _articlesProvider;
    private readonly Func<int, bool> _hasPerekAudio;
    private readonly Func<int, RecitationTrack?> _getTrack;
    private readonly IAppNavigator _navigator;
    private readonly IFileSystem _fileSystem;
    private readonly IShare _share;

    // Using fields with [ObservableProperty] - the MVVMTK0045 warnings are acceptable
    // as we're not targeting AOT scenarios for WinRT marshalling.
#pragma warning disable MVVMTK0045
    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(UnitId))]
    [NotifyPropertyChangedFor(nameof(Heading))]
    [NotifyPropertyChangedFor(nameof(ContextText))]
    [NotifyPropertyChangedFor(nameof(HasContext))]
    [NotifyPropertyChangedFor(nameof(SummaryText))]
    [NotifyPropertyChangedFor(nameof(HasSummary))]
    [NotifyPropertyChangedFor(nameof(UnitPositionText))]
    [NotifyPropertyChangedFor(nameof(NextUnitId))]
    [NotifyPropertyChangedFor(nameof(PreviousUnitId))]
    [NotifyPropertyChangedFor(nameof(CanGoToNextUnit))]
    [NotifyPropertyChangedFor(nameof(CanGoToPreviousUnit))]
    [NotifyPropertyChangedFor(nameof(ArticlesCount))]
    [NotifyPropertyChangedFor(nameof(HasArticles))]
    [NotifyPropertyChangedFor(nameof(PerushimCount))]
    [NotifyPropertyChangedFor(nameof(HasPerushim))]
    [NotifyPropertyChangedFor(nameof(Rows))]
    [NotifyPropertyChangedFor(nameof(HasUnit))]
    [NotifyPropertyChangedFor(nameof(IsUnavailable))]
#if MAUI
    [NotifyCanExecuteChangedFor(nameof(LoadNextCommand))]
    [NotifyCanExecuteChangedFor(nameof(LoadPreviousCommand))]
#endif
    private MoedUnit? _unit;

    /// <summary>The current moed's display rows (built before the unit is set).</summary>
    public List<MoedDisplayRow> Rows => Unit?.Rows ?? [];

    /// <summary>Available perushim for the current moed (union over its perakim, priority order).</summary>
    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(FilteredPerushim))]
    private List<Perush> _perushim = new();

    /// <summary>Perush IDs that are currently checked (shown inline with text).</summary>
    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(PerushimSelectionStatus))]
    [NotifyPropertyChangedFor(nameof(PerushimLimitReached))]
    private List<int> _checkedPerushim = new();

    /// <summary>Whether the perushim notes database is available (PAD or HTTP downloaded).</summary>
    [ObservableProperty]
    private bool _perushimNotesAvailable;

    /// <summary>Whether the first-launch notes pack is still materializing off the reader path (#2430).</summary>
    [ObservableProperty]
    private bool _perushimNotesPending;

    /// <summary>Whether the perushim catalog is available (bundled).</summary>
    [ObservableProperty]
    private bool _perushimCatalogAvailable;

    /// <summary>The moed's linked articles (range-linked union explicit, API order).</summary>
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
        Perushim.Count > 0 && !string.IsNullOrWhiteSpace(PerushNameFilter) ? "לא נמצאו פירושים תואמים" :
        !PerushimCatalogAvailable ? "אין קטלוג פירושים" :
        PerushimNotesPending ? "טוען פירושים..." :
        !PerushimNotesAvailable ? "להוריד פירושים" :
        "אין פרשנות למועד זה";

    /// <summary>Whether to show the download perushim button (notes not yet available).</summary>
    public bool ShowDownloadPerushimButton => PerushimCatalogAvailable && !PerushimNotesAvailable && !PerushimNotesPending;

    /// <summary>
    /// The production articles provider — the StarterService startup
    /// snapshot (all articles already in memory), so the moed's resolved id
    /// union joins with no GraphQL round-trips and stays offline-readable.
    /// </summary>
    private static Func<List<Article>>? DefaultArticlesProvider =>
#if MAUI
        () => StarterService.Instance.Articles;
#else
        null;
#endif

    public MoedViewModel() : this(MoedService.Instance, PerekDataService.Instance,
        PreferencesService.Instance, null, null)
    {
    }

    public MoedViewModel(MoedService moedService, PerekDataService perekDataService,
        PreferencesService preferencesService, PerushimCatalogService? catalogService,
        PerushimNotesService? notesService)
        : this(moedService, perekDataService, preferencesService, catalogService, notesService,
            DefaultArticlesProvider, null, null, null, null, null)
    {
    }

    public MoedViewModel(MoedService moedService, PerekDataService perekDataService,
        PreferencesService preferencesService, PerushimCatalogService? catalogService,
        PerushimNotesService? notesService, Func<List<Article>>? articlesProvider,
        Func<int, bool>? hasPerekAudio, Func<int, RecitationTrack?>? getTrack)
        : this(moedService, perekDataService, preferencesService, catalogService, notesService,
            articlesProvider, hasPerekAudio, getTrack, null, null, null)
    {
    }

    public MoedViewModel(MoedService moedService, PerekDataService perekDataService,
        PreferencesService preferencesService, PerushimCatalogService? catalogService,
        PerushimNotesService? notesService, Func<List<Article>>? articlesProvider,
        Func<int, bool>? hasPerekAudio, Func<int, RecitationTrack?>? getTrack,
        IAppNavigator? navigator, IFileSystem? fileSystem, IShare? share)
    {
        _moedService = moedService;
        _perekDataService = perekDataService;
        _preferencesService = preferencesService;
        _catalogService = catalogService ?? PerushimCatalogService.Instance;
        _notesService = notesService ?? PerushimNotesService.Instance;
        _articlesProvider = articlesProvider;
        // Tests inject fakes — the lazy RecitationService singleton has no host
        // in a unit-test process (same convention as MasoraViewModel).
        _hasPerekAudio = hasPerekAudio ?? (static perekId => RecitationService.Instance.HasAudio(perekId));
        _getTrack = getTrack ?? (static perekId => RecitationService.Instance.GetTrack(perekId));
        _navigator = navigator ?? ShellAppNavigator.Instance;
        _fileSystem = fileSystem ?? FileSystem.Current;
        _share = share ?? Share.Default;

        _fontFactor = _preferencesService.PasukFontFactor;
        WeakPreferencesSubscription.Subscribe(this, _preferencesService, static model => model.RefreshPreferences());
    }

    #region Unit Properties

    /// <summary>The current moed's DB id (0 while none is loaded).</summary>
    public int UnitId => Unit?.Id ?? 0;

    /// <summary>The moed's Hebrew display name.</summary>
    public string Heading => Unit?.Name ?? string.Empty;

    /// <summary>Date/context line — the curated date label, else the month anchor.</summary>
    public string ContextText =>
        !string.IsNullOrWhiteSpace(Unit?.DateLabel) ? Unit.DateLabel : Unit?.HebrewMonth ?? string.Empty;

    /// <summary>Whether the moed carries any date/context label.</summary>
    public bool HasContext => !string.IsNullOrWhiteSpace(ContextText);

    /// <summary>The curated summary line, when present.</summary>
    public string SummaryText => Unit?.Summary ?? string.Empty;

    /// <summary>Whether the moed carries a summary.</summary>
    public bool HasSummary => !string.IsNullOrWhiteSpace(SummaryText);

    /// <summary>"מועד N מתוך M" — the moed's place inside the published catalogue.</summary>
    public string UnitPositionText
    {
        get
        {
            var index = _moedService.Moadim.FindIndex(m => m.Id == UnitId);
            return index < 0 ? string.Empty : $"מועד {index + 1} מתוך {_moedService.Moadim.Count}";
        }
    }

    /// <summary>Whether a moed is loaded — drives the reader surface's visibility.</summary>
    public bool HasUnit => Unit != null;

    /// <summary>
    /// Whether the requested moed could not be resolved (unpublished slug,
    /// an empty offline catalogue) — the page surfaces its unavailable state.
    /// </summary>
    public bool IsUnavailable => Unit == null && _loadAttempted;

    private bool _loadAttempted;

    public int NextUnitId => _moedService.GetAdjacentMoadim(UnitId).Next?.Id ?? 0;

    public int PreviousUnitId => _moedService.GetAdjacentMoadim(UnitId).Prev?.Id ?? 0;

    /// <summary>True when next-moed navigation should be enabled.</summary>
    public bool CanGoToNextUnit => NextUnitId > 0;

    /// <summary>True when previous-moed navigation should be enabled.</summary>
    public bool CanGoToPreviousUnit => PreviousUnitId > 0;

    /// <summary>The count of the moed's linked articles.</summary>
    public int ArticlesCount => Articles.Count;

    /// <summary>Whether the current moed has any linked articles.</summary>
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

    /// <summary>Whether the current moed has any perushim.</summary>
    public bool HasPerushim => PerushimCount > 0;

    /// <summary>
    /// קריינות — mirrors the global preference (העדפות → על הפרק, default on).
    /// Setting it writes through to <see cref="PreferencesService.QriynotEnabled"/>.
    /// </summary>
    public bool IsQriynotEnabled
    {
        get => _preferencesService.QriynotEnabled;
        set
        {
            if (_preferencesService.QriynotEnabled == value)
            {
                return;
            }

            _preferencesService.QriynotEnabled = value;
            OnPropertyChanged();
            OnPropertyChanged(nameof(ShowHeaderPlayButton));
            UpdateSectionPlayButtons();
        }
    }

    /// <summary>Whether a recitation is downloaded for at least one perek of the displayed moed.</summary>
    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(ShowHeaderPlayButton))]
    private bool _hasCurrentUnitRecitation;

    /// <summary>The header play button shows only while קריינות is checked and audio exists.</summary>
    public bool ShowHeaderPlayButton => IsQriynotEnabled && HasCurrentUnitRecitation;

#pragma warning disable S1172 // ObservableProperty generates this hook with both values.
    partial void OnUnitChanged(MoedUnit? oldValue, MoedUnit? newValue)
#pragma warning restore S1172
    {
        // Selection flags live on the rows' pasuk objects — clear them on
        // the moed being left, or its cached rows keep showing a phantom
        // selection after ClearSelected() only reaches the new moed's rows.
        if (oldValue is not null && !ReferenceEquals(oldValue, newValue))
        {
            foreach (var pasuk in oldValue.Rows.Select(row => row.Pasuk).Where(pasuk => pasuk?.IsSelected == true))
            {
                pasuk!.IsSelected = false;
            }
        }

        RefreshRecitationAvailability();
    }

    /// <summary>
    /// Re-evaluates whether the displayed moed has any playable recitation —
    /// controls the קריינות affordances. The shared planner is the source of
    /// truth for what playback would produce (a moed whose only audio is an
    /// unaligned track behind partial slices gets no clip), and each section
    /// header mirrors the same per-section verdict for its own play button.
    /// </summary>
    public void RefreshRecitationAvailability()
    {
        HasCurrentUnitRecitation = Unit is { } current &&
            PlanSegmentsForUnit(current).Count > 0;
        UpdateSectionPlayButtons();
    }

    /// <summary>
    /// The shared range planner applied to one section's ordered slices —
    /// the exact clips <c>moed:{id}:s{sectionId}</c> playback would chain.
    /// Each clip carries its section so a repeated reading's highlight maps
    /// to the playing occurrence, not the first canonical match (#3261).
    /// </summary>
    public List<RecitationSegment> PlanSegmentsForSection(MoedSection section) =>
        RecitationRangePlanner.SegmentsForSlices(
            MoedUnitText.PerekSlicesForSection(section),
            GetLoadedPasukim,
            _getTrack,
            _hasPerekAudio,
            _preferencesService.RecitationVersePauseMs >= 0)
            .Select(s => s with { SectionId = section.Id }).ToList();

    /// <summary>
    /// The whole-moed playback plan — every section's tagged clips in order
    /// (the planner emits one clip per slice and never merges, so planning
    /// per section yields exactly the flattened <see cref="MoedUnitText.PerekSlicesForUnit"/>
    /// sequence, each clip keeping its own section).
    /// </summary>
    public List<RecitationSegment> PlanSegmentsForUnit(MoedUnit moed) =>
        moed.Sections.SelectMany(PlanSegmentsForSection).ToList();

    /// <summary>Mirrors each section's playable verdict onto its header row's play button.</summary>
    private void UpdateSectionPlayButtons()
    {
        var playable = new HashSet<int>();
        if (Unit is { } unit && IsQriynotEnabled)
        {
            foreach (var section in unit.Sections)
            {
                if (PlanSegmentsForSection(section).Count > 0)
                {
                    playable.Add(section.Id);
                }
            }
        }
        foreach (var row in Rows)
        {
            if (row.IsSectionHeader)
            {
                row.ShowPlayButton = playable.Contains(row.SectionId);
            }
        }
    }

    #endregion

    #region Selection

    /// <summary>Canonical positions of the selected pesukim — (perekId, pasukNum).</summary>
#pragma warning disable MVVMTK0045 // Same accepted warning as the fields above.
    [ObservableProperty]
    private List<(int PerekId, int PasukNum)> _selectedPasukim = new();
#pragma warning restore MVVMTK0045

    /// <summary>Selected-pasuk count — drives the reader's selection bar.</summary>
    public int SelectedPasukCount => SelectedPasukim.Count;

    /// <summary>Toggles selection of a rendered pasuk (keyed canonically so a
    /// pasuk repeated across sections toggles once).</summary>
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

        foreach (var row in Rows)
        {
            if (row.PerekId == perekId && row.PasukNum == pasukNum && row.Pasuk is { } pasuk)
            {
                pasuk.IsSelected = list.Contains(key);
            }
        }
        OnPropertyChanged(nameof(SelectedPasukCount));
    }

    /// <summary>Clears the whole selection.</summary>
    public void ClearSelected()
    {
        foreach (var pasuk in Rows.Select(row => row.Pasuk).Where(pasuk => pasuk?.IsSelected == true))
        {
            pasuk!.IsSelected = false;
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
        foreach (var row in Rows)
        {
            if (row.Pasuk is not { } pasuk)
            {
                continue;
            }
            var key = (row.PerekId, row.PasukNum);
            if (selected.Contains(key) && seen.Add(key))
            {
                result.Add((row.PerekId, pasuk));
            }
        }
        return result;
    }

    #endregion

    #region Load Methods

    /// <summary>
    /// Loads a moed by its canonical slug (deep links, list taps): resolves
    /// the catalogue, builds the section-clipped rows, then loads perushim
    /// and articles. A slug the public API does not publish leaves the unit
    /// null so the page surfaces its unavailable state.
    /// </summary>
    public async Task LoadBySlugAsync(string? slug)
    {
        await EnsureDataLoadedAsync();
        var moed = !string.IsNullOrEmpty(slug)
            ? await _moedService.GetMoedBySlugAsync(slug)
            : _moedService.Moadim.FirstOrDefault();
        _loadAttempted = true;
        OnPropertyChanged(nameof(IsUnavailable));
        if (moed == null)
        {
            return;
        }

        await SetMoedAsync(moed);
    }

    /// <summary>Loads a moed by its DB id.</summary>
    public async Task LoadByIdAsync(int id)
    {
        await EnsureDataLoadedAsync();
        var moed = _moedService.GetMoed(id);
        _loadAttempted = true;
        OnPropertyChanged(nameof(IsUnavailable));
        if (moed == null)
        {
            return;
        }

        await SetMoedAsync(moed);
    }

    /// <summary>The catalogue's first moed — the fallback for a bare reader open.</summary>
    public async Task LoadInitialAsync() => await LoadBySlugAsync(null);

    /// <summary>
    /// Raised when the ViewModel completed a moed swap — the code-behind
    /// resets the recitation session and scrolls the reader to the top.
    /// </summary>
    // Codacy: S3264 false positive — invoked via ?.Invoke at
    // NavigateToUnitAsync below; the XAML-less analysis misses the page's
    // subscription too.
#pragma warning disable S3264
    public event EventHandler<int>? NavigationRequested;
#pragma warning restore S3264

    /// <summary>
    /// Navigates to a moed by id (prev/next satellites, picker). Rebuilds the
    /// section-clipped rows, then asks the code-behind to reset its session.
    /// </summary>
    public async Task NavigateToUnitAsync(int id)
    {
        var moed = _moedService.GetMoed(id);
        if (moed == null || moed == Unit)
        {
            return;
        }

        await SetMoedAsync(moed);
        NavigationRequested?.Invoke(this, id);
    }

    /// <summary>Loads the next moed in annual order.</summary>
    [RelayCommand(CanExecute = nameof(CanGoToNextUnit))]
    public async Task LoadNextAsync()
    {
        if (NextUnitId > 0 && NextUnitId != UnitId)
        {
            await NavigateToUnitAsync(NextUnitId);
        }
    }

    /// <summary>Loads the previous moed in annual order.</summary>
    [RelayCommand(CanExecute = nameof(CanGoToPreviousUnit))]
    public async Task LoadPreviousAsync()
    {
        if (PreviousUnitId > 0 && PreviousUnitId != UnitId)
        {
            await NavigateToUnitAsync(PreviousUnitId);
        }
    }

    /// <summary>Shared startup: the local Tanah corpus plus the catalogue load.</summary>
    private async Task EnsureDataLoadedAsync()
    {
        if (!_perekDataService.IsLoaded)
        {
            await _perekDataService.LoadAsync();
        }
        if (!_moedService.IsLoaded)
        {
            await _moedService.LoadWithRetryAsync();
        }
    }

    /// <summary>Builds the moed's rows, then fills perushim and articles.</summary>
    private async Task SetMoedAsync(MoedUnit moed)
    {
        await EnsureRowsLoadedAsync(moed);
        Unit = moed;
        await LoadPerushimAsync(moed);
        await LoadArticlesAsync(moed);
    }

    /// <summary>
    /// Ensures the moed's section-clipped display rows are built (idempotent —
    /// cached on the unit object).
    /// </summary>
    public async Task EnsureRowsLoadedAsync(MoedUnit moed)
    {
        if (moed.Rows.Count > 0)
        {
            return;
        }

        moed.Rows = await MoedUnitText.BuildRowsAsync(
            moed,
            LoadAndCachePasukimAsync,
            _perekDataService.GetPerekSource,
            PerekInfo,
            FontFactor);
    }

    /// <summary>Sefer identity for canonical refs (sefer name, perek number, additional).</summary>
    private (string SeferName, int PerekNumber, int? Additional)? PerekInfo(int perekId) =>
        _perekDataService.GetPerek(perekId) is { } perek
            ? (perek.SeferName, perek.PerekNumber, perek.Additional)
            : null;

    /// <summary>
    /// Full canonical pasukim of a perek the loaded moed covers, or null until
    /// its rows load — recitation bounds checks hash the whole perek (same
    /// contract as <see cref="MasoraViewModel.GetLoadedPasukim"/>).
    /// </summary>
    public IReadOnlyList<Pasuk>? GetLoadedPasukim(int perekId) =>
        _loadedPerekPasukim.GetValueOrDefault(perekId);

    private readonly Dictionary<int, List<Pasuk>> _loadedPerekPasukim = new();

    private async Task<List<Pasuk>> LoadAndCachePasukimAsync(int perekId)
    {
        var pasukim = await _perekDataService.LoadPasukimAsync(perekId);
        _loadedPerekPasukim[perekId] = pasukim;
        return pasukim;
    }

    #endregion

    #region Articles

    /// <summary>
    /// Loads the moed's linked articles: the server-resolved id union
    /// (range-linked first, explicit-only afterward) joined to the starter
    /// article cache, preserving the API order — offline-rendering the exact
    /// list the website shows.
    /// </summary>
    public async Task LoadArticlesAsync(MoedUnit moed)
    {
        if (_articlesProvider == null)
        {
            Articles = new List<Article>();
            moed.ArticlesCount = 0;
            return;
        }

        var byId = await Task.Run(() => _articlesProvider().ToDictionary(a => a.Id));
        if (Unit?.Id != moed.Id)
        {
            return; // Stale load — a newer moed is already on screen.
        }

        Articles = moed.ArticleIds
            .Select(id => byId.GetValueOrDefault(id))
            .OfType<Article>()
            .ToList();
        moed.ArticlesCount = Articles.Count;
    }

    #endregion

    private void RefreshPreferences()
    {
        if (Math.Abs(_fontFactor - _preferencesService.PasukFontFactor) > 0.001)
        {
            FontFactor = _preferencesService.PasukFontFactor;
        }
        OnPropertyChanged(nameof(InlineCommentaryLimitMessage));
        OnPropertyChanged(nameof(InlineCommentaryLimit));
        OnPropertyChanged(nameof(PerushimSelectionStatus));
        OnPropertyChanged(nameof(PerushimLimitReached));
        OnPropertyChanged(nameof(IsQriynotEnabled));
        OnPropertyChanged(nameof(ShowHeaderPlayButton));
        if (CheckedPerushim.Count > _preferencesService.InlineCommentaryLimit)
        {
            CheckedPerushim = CheckedPerushim.Take(_preferencesService.InlineCommentaryLimit).ToList();
            if (Unit != null) { FillFilteredPerushContents(Unit); }
        }
    }
}
