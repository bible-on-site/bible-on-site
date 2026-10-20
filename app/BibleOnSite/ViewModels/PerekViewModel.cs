using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using BibleOnSite.Data;
using BibleOnSite.Helpers;
using BibleOnSite.Models;
using BibleOnSite.Services;

namespace BibleOnSite.ViewModels;

/// <summary>
/// ViewModel for perek display and navigation.
/// Uses CommunityToolkit.Mvvm for observable properties and commands.
/// </summary>
public partial class PerekViewModel : ObservableObject
{
    private readonly PreferencesService _preferencesService;
    private readonly Func<int, Perek?> _perekLoader;
    private readonly PerekDataService _perekDataService;
    private readonly PerushimCatalogService _catalogService;
    private readonly PerushimNotesService _notesService;
    private readonly IAppNavigator _navigator;
    private readonly IFileSystem _fileSystem;
    private readonly IShare _share;
    private readonly System.Collections.Concurrent.ConcurrentDictionary<int, Perek> _readerPerakim = new();

    /// <summary>Reports whether a perek has downloaded recitation audio (production: RecitationService).</summary>
    private readonly Func<int, bool>? _hasPerekAudio;

    // Using fields with [ObservableProperty] - the MVVMTK0045 warnings are acceptable
    // as we're not targeting AOT scenarios for WinRT marshalling.
#pragma warning disable MVVMTK0045
    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(PerekId))]
    [NotifyPropertyChangedFor(nameof(Additional))]
    [NotifyPropertyChangedFor(nameof(AdditionalHeb))]
    [NotifyPropertyChangedFor(nameof(Header))]
    [NotifyPropertyChangedFor(nameof(HebDate))]
    [NotifyPropertyChangedFor(nameof(PerekNumber))]
    [NotifyPropertyChangedFor(nameof(PerekHeb))]
    [NotifyPropertyChangedFor(nameof(SeferId))]
    [NotifyPropertyChangedFor(nameof(SeferName))]
    [NotifyPropertyChangedFor(nameof(SeferGroup))]
    [NotifyPropertyChangedFor(nameof(SeferTanahUsName))]
    [NotifyPropertyChangedFor(nameof(Source))]
    [NotifyPropertyChangedFor(nameof(IsBookmarked))]
    [NotifyPropertyChangedFor(nameof(NextPerekId))]
    [NotifyPropertyChangedFor(nameof(PreviousPerekId))]
    [NotifyPropertyChangedFor(nameof(CanGoToNextPerek))]
    [NotifyPropertyChangedFor(nameof(CanGoToPreviousPerek))]
    [NotifyPropertyChangedFor(nameof(DayOfWeek))]
    [NotifyPropertyChangedFor(nameof(ArticlesCount))]
    [NotifyPropertyChangedFor(nameof(HasArticles))]
    [NotifyPropertyChangedFor(nameof(PerushimCount))]
    [NotifyPropertyChangedFor(nameof(HasPerushim))]
#if MAUI
    [NotifyCanExecuteChangedFor(nameof(LoadNextCommand))]
    [NotifyCanExecuteChangedFor(nameof(LoadPreviousCommand))]
#endif
    private Perek? _perek;

    [ObservableProperty]
    private List<int> _selectedPasukNums = new();

    /// <summary>Used for article list selection highlight (rounded, theme-aware).</summary>
    [ObservableProperty]
    private int? _selectedArticleId;

    /// <summary>Available perushim for the current perek (ordered by priority).</summary>
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

    /// <summary>Message shown when no perushim (empty list or not available).</summary>
    public string PerushimEmptyMessage =>
        Perushim.Count > 0 && !string.IsNullOrWhiteSpace(PerushNameFilter) ? "לא נמצאו פירושים תואמים" :
        !PerushimCatalogAvailable ? "אין קטלוג פירושים" :
        !PerushimNotesAvailable ? "להוריד פירושים" :
        "אין פרשנות לפרק זה";

    /// <summary>Whether to show the download perushim button (notes not yet available).</summary>
    public bool ShowDownloadPerushimButton => PerushimCatalogAvailable && !PerushimNotesAvailable;

    private List<PerekPerushNote> _perushNotesCache = new();
    private PerushNoteChapter? _perushChapter;

    /// <summary>
    /// Pre-loaded perushim data keyed by perekId.
    /// Populated by PreloadAdjacentPerushimAsync so swipe navigation is instant.
    /// </summary>
    private readonly Dictionary<int, PreloadedPerushimData> _perushimPreloadCache = new();

    /// <summary>Carousel collection holding prev/current/next perek for swipe navigation.</summary>
    [ObservableProperty]
    private System.Collections.ObjectModel.ObservableCollection<Perek> _carouselPerakim = new();

    /// <summary>Current carousel position (0=prev, 1=current, 2=next).</summary>
    [ObservableProperty]
    private int _carouselPosition = 1;

    /// <summary>Currently displayed carousel perek.</summary>
    [ObservableProperty]
    private Perek? _currentCarouselPerek;

    /// <summary>שניים מקרא reading mode — renders every pasuk twice consecutively.</summary>
    [ObservableProperty]
    private bool _isShnayimMikraEnabled;

    /// <summary>תיקון קוראים reading mode — continuous chapter flow with a tap-to-toggle marks.</summary>
    [ObservableProperty]
    private bool _isTikkunKorimEnabled;

    /// <summary>Whether niqqud and taamim are currently hidden in תיקון קוראים mode.</summary>
    [ObservableProperty]
    private bool _tikkunMarksHidden;

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
            // The PreferencesChanged subscriber raises the property-changed
            // notifications; raise them here too for the unsaved toggle path.
            OnPropertyChanged();
            OnPropertyChanged(nameof(ShowHeaderPlayButton));
        }
    }

    /// <summary>Whether a recitation is downloaded for the currently displayed perek.</summary>
    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(ShowHeaderPlayButton))]
    private bool _hasCurrentPerekRecitation;

    /// <summary>The header play button shows only while קריינות is checked and audio exists.</summary>
    public bool ShowHeaderPlayButton => IsQriynotEnabled && HasCurrentPerekRecitation;
#pragma warning restore MVVMTK0045

    partial void OnIsTikkunKorimEnabledChanged(bool value)
    {
        // Leaving the mode restores the original marked display settings.
        if (!value)
        {
            TikkunMarksHidden = false;
        }
    }

    partial void OnPerekChanged(Perek? value) => RefreshRecitationAvailability(value);

    partial void OnCurrentCarouselPerekChanged(Perek? oldValue, Perek? newValue)
    {
        if (oldValue is not null) { oldValue.IsOffscreenCarouselPage = true; }
        if (newValue is not null) { newValue.IsOffscreenCarouselPage = false; }
    }

    /// <summary>
    /// Re-evaluates whether the currently displayed perek has a downloaded
    /// recitation — controls the קריינות menu item and header play button.
    /// Called when the perek changes and after the recitation package updates.
    /// </summary>
    public void RefreshRecitationAvailability() => RefreshRecitationAvailability(Perek);

    private void RefreshRecitationAvailability(Perek? perek)
    {
        HasCurrentPerekRecitation = _hasPerekAudio != null && perek is { } current &&
            _hasPerekAudio(current.PerekId);
    }

    public PerekViewModel() : this(PreferencesService.Instance, null,
        hasPerekAudio: perekId => RecitationService.Instance.HasAudio(perekId))
    {
    }

    public PerekViewModel(PreferencesService preferencesService, Func<int, Perek?>? perekLoader)
        : this(preferencesService, perekLoader, null)
    {
    }

    public PerekViewModel(PreferencesService preferencesService, Func<int, Perek?>? perekLoader,
        Func<int, bool>? hasPerekAudio)
        : this(preferencesService, perekLoader, null, null, null, null, null, null, hasPerekAudio)
    {
    }

    public PerekViewModel(PreferencesService preferencesService, Func<int, Perek?>? perekLoader,
        PerekDataService? perekDataService, PerushimCatalogService? catalogService,
        PerushimNotesService? notesService, IAppNavigator? navigator,
        IFileSystem? fileSystem, IShare? share)
        : this(preferencesService, perekLoader, perekDataService, catalogService, notesService,
            navigator, fileSystem, share, null)
    {
    }

    public PerekViewModel(PreferencesService preferencesService, Func<int, Perek?>? perekLoader,
        PerekDataService? perekDataService, PerushimCatalogService? catalogService,
        PerushimNotesService? notesService, IAppNavigator? navigator,
        IFileSystem? fileSystem, IShare? share, Func<int, bool>? hasPerekAudio)
    {
        _preferencesService = preferencesService;
        _perekLoader = perekLoader ?? (_ => null);
        _perekDataService = perekDataService ?? PerekDataService.Instance;
        _catalogService = catalogService ?? PerushimCatalogService.Instance;
        _notesService = notesService ?? PerushimNotesService.Instance;
        _navigator = navigator ?? ShellAppNavigator.Instance;
        _fileSystem = fileSystem ?? FileSystem.Current;
        _share = share ?? Share.Default;
        _hasPerekAudio = hasPerekAudio;
        _perushChapter = null;

        // Sync FontFactor from preferences and listen for changes
        _fontFactor = _preferencesService.FontFactor;
        _divineNameMaskingRevision = DivineNameMasking.Revision;
        WeakPreferencesSubscription.Subscribe(this, _preferencesService, static model => model.RefreshPreferences());
    }

    /// <summary>Font scaling factor from user preferences (0.5–2.0).</summary>
    [ObservableProperty]
    private double _fontFactor = 1.0;

    /// <summary>
    /// Bumped whenever הסתר שם השם settings change. Bound into the pasukim
    /// ItemsSource MultiBinding and TikkunFlowView.MaskingRevision so every
    /// realized or recycled text row re-renders with the new masking.
    /// </summary>
    [ObservableProperty]
    private int _divineNameMaskingRevision;

    /// <summary>הסתר שם השם toggle — persisted through PreferencesService.</summary>
    public bool DivineNameMaskingEnabled
    {
        get => _preferencesService.DivineNameMaskingEnabled;
        set => _preferencesService.DivineNameMaskingEnabled = value;
    }

    // The default loader returns null — perek content is loaded asynchronously
    // through PerekDataService.LoadByPerekIdAsync() instead.
    #region Perek Properties

    public int PerekId => Perek?.PerekId ?? 0;

    public int? Additional => Perek?.Additional;

    public string AdditionalHeb => Additional?.ToHebrewLetters() ?? string.Empty;

    public int DayOfWeek => PerekId % 5;

    public string Header => Perek?.Header ?? string.Empty;

    public string HebDate => Perek?.HebDate ?? string.Empty;

    public bool IsBookmarked => Perek != null && _preferencesService.IsBookmarked(PerekId);

    public int NextPerekId => Perek == null ? 0 : Math.Min(929, PerekId + 1);

    public int PerekNumber => Perek?.PerekNumber ?? 0;

    public string PerekHeb => PerekNumber > 0 ? PerekNumber.ToHebrewLetters() : string.Empty;

    public int PreviousPerekId => Perek == null ? 0 : Math.Max(1, PerekId - 1);

    /// <summary>True when next perek button should be enabled (not at 929).</summary>
    public bool CanGoToNextPerek => PerekId > 0 && PerekId < 929;

    /// <summary>True when previous perek button should be enabled (not at 1).</summary>
    public bool CanGoToPreviousPerek => PerekId > 1;

    public int SeferId => Perek?.SeferId ?? 0;

    public string SeferName => Perek?.SeferName ?? string.Empty;

    public Data.SeferGroup SeferGroup => SefarimData.GetSeferGroup(SeferId);

    public string SeferTanahUsName => Perek?.SeferTanahUsName ?? string.Empty;

    /// <summary>
    /// The count of articles for the current perek.
    /// </summary>
    public int ArticlesCount => Perek?.ArticlesCount ?? 0;

    /// <summary>
    /// Whether the current perek has any articles.
    /// </summary>
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

    /// <summary>Whether the current perek has any perushim.</summary>
    public bool HasPerushim => PerushimCount > 0;

    public string Source
    {
        get
        {
            if (Perek == null)
            {
                return string.Empty;
            }

            var additionalPart = Additional.HasValue ? $"{Additional.Value.ToHebrewLetters()} " : string.Empty;
            return $"{SeferName} {additionalPart}{PerekHeb}";
        }
    }

    #endregion

    #region Load Methods

    /// <summary>
    /// Loads a perek by its ID (1-929).
    /// </summary>
    [RelayCommand]
    public void LoadByPerekId(int perekId)
    {
        var perek = _perekLoader(perekId);
        if (perek != null)
        {
            SetPerek(perek);
        }
    }

#if MAUI
    /// <summary>
    /// Bound for a single perek-load attempt. Several stages await facilities
    /// that can stall without completing — a queued SQLite call on a starved
    /// pool, an on-demand resource probe whose daemon never answers — and an
    /// unbounded await leaves the reader on its loading overlay forever
    /// (issue #2084). Every attempt is abandoned after this budget instead.
    /// </summary>
    internal TimeSpan LoadAttemptTimeout { get; set; } = TimeSpan.FromSeconds(30);

    /// <summary>Attempts before a stubbornly-stalling load surfaces as an error.</summary>
    internal int LoadMaxAttempts { get; set; } = 2;

    /// <summary>
    /// Stage reached by the in-flight (or last) load attempt — written into the
    /// timeout log and exception so a stall reports where it froze.
    /// </summary>
    internal string LoadStage { get; private set; } = "not-started";

    /// <summary>
    /// Currency of the freshest load call or direct navigation. A timed-out
    /// attempt keeps running detached next to its own retry — and beside newer
    /// navigations — so before writing observable state (Perek, LoadStage,
    /// carousel) an attempt proves it is still current; a superseded attempt's
    /// late writes are dropped instead of replacing the perek now on screen
    /// (issue #2084).
    /// </summary>
    private long _loadGeneration;

    /// <summary>
    /// Per-call attempt currency: the newest attempt of the newest load call
    /// owns observable state. Retries bump <see cref="LatestAttempt"/> so the
    /// attempt abandoned by a timeout loses to its own successor, while
    /// <see cref="Generation"/> keeps a call superseded by a newer load or
    /// navigation dead even when it retries.
    /// </summary>
    private sealed class LoadGate
    {
        public LoadGate(long generation) => Generation = generation;

        public readonly long Generation;
        public int LatestAttempt;
    }

    /// <summary>True while the attempt still owns the reader's observable state.</summary>
    private bool IsCurrentLoad(LoadGate gate, int attemptStamp) =>
        gate.Generation == Interlocked.Read(ref _loadGeneration) &&
        attemptStamp == Volatile.Read(ref gate.LatestAttempt);

    /// <summary>
    /// Orphans every in-flight load attempt. Navigation paths that set the
    /// perek directly (carousel swipe, prev/next, app link) call this so a
    /// detached attempt's late writes cannot replace the newer perek.
    /// </summary>
    public void InvalidatePendingLoads() => Interlocked.Increment(ref _loadGeneration);

    /// <summary>
    /// Stamp of the newest reader load/navigation. A caller holding the stamp a
    /// load returned can compare it after an <c>await</c> boundary — a mismatch
    /// means a newer navigation owns the reader and the caller's remaining
    /// continuation must not run.
    /// </summary>
    public long ReaderLoadStamp => Interlocked.Read(ref _loadGeneration);

    /// <summary>
    /// Asynchronously loads a perek by its ID, including pasukim from the database.
    /// Each attempt is time-boxed by <see cref="LoadAttemptTimeout"/>; when a
    /// stage stalls, the load retries up to <see cref="LoadMaxAttempts"/> times,
    /// then throws TimeoutException so the caller can surface a retryable error
    /// instead of an endless spinner. A call superseded by a newer load or
    /// navigation reports nothing — the newer owner decides what the UI shows.
    /// </summary>
    /// <returns>
    /// This load's stamp when it still owns the reader at completion, or
    /// <see langword="null"/> when a newer load/navigation superseded it
    /// mid-flight — callers must then skip every post-load action (scroll,
    /// search landing) that would touch the newer owner's reader.
    /// </returns>
    public async Task<long?> LoadByPerekIdAsync(int perekId)
    {
        var gate = new LoadGate(Interlocked.Increment(ref _loadGeneration));
        var attempt = 0;
        while (true)
        {
            attempt++;
            // Each attempt claims the call's currency. The attempt orphaned by
            // this timeout keeps running detached; every observable write
            // downstream checks the stamp so it cannot overwrite the retry —
            // or a newer navigation — once it finally unblocks.
            var attemptStamp = Interlocked.Increment(ref gate.LatestAttempt);
            var load = LoadByPerekIdCoreAsync(perekId, gate, attemptStamp);
            try
            {
                await load.WaitAsync(LoadAttemptTimeout);
                // The core may have returned early on a mid-flight supersede —
                // surface that instead of reporting a successful load.
                return IsCurrentLoad(gate, attemptStamp) ? gate.Generation : null;
            }
            catch (TimeoutException)
            {
                // A stalled attempt keeps running detached — observing its
                // completion logs the late outcome and avoids unobserved exceptions.
                _ = ObserveStaleLoadAsync(load, attempt, perekId);
                Console.Error.WriteLine($"[PerekLoad] attempt {attempt} timed out after " +
                    $"{LoadAttemptTimeout.TotalSeconds:0.##}s at stage '{LoadStage}' (perekId={perekId})");
                if (attempt >= LoadMaxAttempts)
                {
                    // A newer load or navigation already owns the reader —
                    // this abandoned call must not resurface an error over it.
                    if (!IsCurrentLoad(gate, attemptStamp))
                    {
                        return null;
                    }
                    throw new TimeoutException(
                        $"Perek {perekId} load timed out after {attempt} attempt(s); last stage: {LoadStage}");
                }
            }
        }
    }

    /// <summary>
    /// Follows a detached, timed-out attempt to its eventual end so its late
    /// completion (or failure) is logged rather than silently dropped.
    /// </summary>
    private async Task ObserveStaleLoadAsync(Task stale, int attempt, int perekId)
    {
        try
        {
            await stale;
            DebugLog.Write($"[PerekLoad] stale attempt {attempt} eventually completed (perekId={perekId})");
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine($"[PerekLoad] stale attempt {attempt} failed late (perekId={perekId}): {ex.Message}");
        }
    }

    private void MarkLoadStage(string stage, int perekId, LoadGate gate, int attemptStamp)
    {
        // A superseded attempt still reports progress to the log, but only a
        // current attempt may move the LoadStage marker that timeouts cite.
        if (IsCurrentLoad(gate, attemptStamp))
        {
            LoadStage = stage;
        }
        DebugLog.Write($"[PerekLoad] stage={stage} perekId={perekId}");
    }

    private async Task LoadByPerekIdCoreAsync(int perekId, LoadGate gate, int attemptStamp)
    {
        // Ensure data service is loaded
        MarkLoadStage("data-service", perekId, gate, attemptStamp);
        if (!_perekDataService.IsLoaded)
        {
            await _perekDataService.LoadAsync();
        }

        var perek = GetReaderPerek(perekId);
        if (perek == null)
        {
            MarkLoadStage("missing-perek", perekId, gate, attemptStamp);
            return;
        }

        MarkLoadStage("pasukim", perekId, gate, attemptStamp);
        var pasukim = await _perekDataService.LoadPasukimAsync(perekId);
        // Everything below writes observable state (the perek's Pasukim are
        // bound once the carousel holds it, then Perek, perushim, carousel),
        // so it is gated on still being the current attempt — a timed-out
        // attempt must not resurrect over its own retry or a newer navigation.
        if (!IsCurrentLoad(gate, attemptStamp))
        {
            return;
        }
        perek.Pasukim = pasukim;
        MarkLoadStage("set-perek", perekId, gate, attemptStamp);
        SetPerek(perek);
        MarkLoadStage("perushim", perekId, gate, attemptStamp);
        await LoadPerushimAsync(perekId);
        if (!IsCurrentLoad(gate, attemptStamp))
        {
            return;
        }
        MarkLoadStage("carousel", perekId, gate, attemptStamp);
        await InitializeCarouselCoreAsync(gate, attemptStamp);
        MarkLoadStage("loaded", perekId, gate, attemptStamp);
    }

    /// <summary>
    /// Loads perushim (commentaries) for the current perek.
    /// Uses preload cache if available (adjacent perakim), otherwise hits SQLite.
    /// Previously checked perushim that are also available in the new perek stay checked.
    /// </summary>
    public async Task LoadPerushimAsync(int perekId)
    {
        if (TryApplySyntheticPerushimForE2e(perekId)) { return; }

        await _catalogService.InitializeAsync();
        await _notesService.InitializeAsync();

        PerushimCatalogAvailable = _catalogService.IsAvailable;
        PerushimNotesAvailable = _notesService.IsAvailable;
        OnPropertyChanged(nameof(PerushimEmptyMessage));
        OnPropertyChanged(nameof(ShowDownloadPerushimButton));

        if (!PerushimNotesAvailable || !PerushimCatalogAvailable)
        {
            // A stale load must not wipe the perushim of the perek now on screen.
            if (IsStalePerushimLoad(perekId))
            {
                return;
            }
            _perushChapter = null;
            _perushNotesCache = new List<PerekPerushNote>();
            // Set CheckedPerushim BEFORE Perushim so the CollectionView sees correct state
            CheckedPerushim = new List<int>();
            Perushim = new List<Perush>();
            FillFilteredPerushContents();
            return;
        }

        // Try the preload cache first (populated by PreloadAdjacentPerushimAsync)
        PreloadedPerushimData? cached = null;
        lock (_perushimPreloadCache)
        {
            _perushimPreloadCache.TryGetValue(perekId, out cached);
        }

        IReadOnlyList<int> perushIds;
        Dictionary<int, Perush> perushById;
        PerushNoteChapter? chapter;

        if (cached != null)
        {
            perushIds = cached.PerushIds;
            perushById = cached.PerushById;
            chapter = cached.Chapter;
        }
        else
        {
            chapter = await _notesService.LoadChapterAsync(perekId);
            perushIds = chapter?.PerushIds ?? [];
            perushById = perushIds.Count == 0 ? new() : await _catalogService.GetPerushimByIdsAsync(perushIds);
        }

        if (IsStalePerushimLoad(perekId))
        {
            return;
        }

        if (perushIds.Count == 0)
        {
            _perushChapter = null;
            _perushNotesCache = new List<PerekPerushNote>();
            CheckedPerushim = new List<int>();
            Perushim = new List<Perush>();
            FillFilteredPerushContents();
            return;
        }

        _perushNotesCache = new();
        _perushChapter = chapter;

        // Order perushim by priority (Targum first, Rashi second, etc.)
        var orderedPerushim = perushIds
            .Select(id => perushById.GetValueOrDefault(id))
            .Where(p => p != null)
            .OrderBy(p => p!.Priority)
            .Cast<Perush>()
            .ToList();

        // Preserve checked perushim that are also available in the new perek.
        // Set CheckedPerushim BEFORE Perushim so the CollectionView binding
        // sees the correct checked state when it re-renders items.
        var availableIds = new HashSet<int>(perushIds);
        CheckedPerushim = CheckedPerushim.Where(id => availableIds.Contains(id)).Take(_preferencesService.InlineCommentaryLimit).ToList();
        Perushim = orderedPerushim;

        FillFilteredPerushContents();
        OnPropertyChanged(nameof(PerushimEmptyMessage));
        OnPropertyChanged(nameof(ShowDownloadPerushimButton));
    }

    /// <summary>
    /// Swiping fires a LoadPerushimAsync per perek without awaiting it; a slower, older load
    /// must not overwrite the perushim and inline notes of the perek now on screen.
    /// </summary>
    private bool IsStalePerushimLoad(int perekId) => Perek != null && Perek.PerekId != perekId;

    // E2E hook (BIBLE_E2E_PERUSHIM=1): fabricate notes so the HtmlView
    // commentary path is exercised in CI, where no asset pack exists. Excluded
    // from unit coverage — it only activates under the e2e env var, which unit
    // tests must not mutate (process-global, races parallel fixtures); the
    // mobile e2e suite covers it.
    [System.Diagnostics.CodeAnalysis.ExcludeFromCodeCoverage(Justification = "E2E-only synthetic path; covered by the iOS mobile e2e suite.")]
    private bool TryApplySyntheticPerushimForE2e(int perekId)
    {
        if (!SyntheticPerushimProvider.Enabled)
        {
            return false;
        }

        var synthetic = SyntheticPerushimProvider.NotesFor(
            perekId, Perek?.Pasukim?.Select(p => p.PasukNum) ?? []);
        _perushChapter = new PerushNoteChapter(PerushNoteBlob.Encode(synthetic.Select(n =>
            new PerushNoteBlob.Note(n.PerushId, n.Pasuk, n.NoteIdx, n.NoteContent)).ToList()));
        _perushNotesCache = new();
        CheckedPerushim = new List<int>();
        Perushim = SyntheticPerushimProvider.Perushim;
        PerushimCatalogAvailable = true;
        PerushimNotesAvailable = true;
        OnPropertyChanged(nameof(PerushimEmptyMessage));
        OnPropertyChanged(nameof(ShowDownloadPerushimButton));
        FillFilteredPerushContents();
        return true;
    }

    /// <summary>
    /// Loads the next perek in sequence.
    /// When the carousel is already initialized, just moves position (OnCarouselItemChanged handles the rest).
    /// </summary>
    [RelayCommand(CanExecute = nameof(CanGoToNextPerek))]
    public async Task LoadNextAsync()
    {
        if (NextPerekId > 0 && NextPerekId != PerekId)
        {
            await NavigateToPerekAsync(NextPerekId);
        }
    }

    /// <summary>
    /// Loads the previous perek in sequence.
    /// When the carousel is already initialized, just moves position (OnCarouselItemChanged handles the rest).
    /// </summary>
    [RelayCommand(CanExecute = nameof(CanGoToPreviousPerek))]
    public async Task LoadPreviousAsync()
    {
        if (PreviousPerekId > 0 && PreviousPerekId != PerekId)
        {
            await NavigateToPerekAsync(PreviousPerekId);
        }
    }

    /// <summary>
    /// Loads today's perek based on the current date.
    /// </summary>
    [RelayCommand]
    public async Task LoadTodayAsync()
    {
        // Ensure data is loaded before getting today's perek
        if (!_perekDataService.IsLoaded)
        {
            await _perekDataService.LoadAsync();
        }

        var todayPerekId = _perekDataService.GetTodaysPerekId();
        if (todayPerekId != PerekId)
        {
            await NavigateToPerekAsync(todayPerekId);
        }
    }

    /// <summary>
    /// Raised when the ViewModel needs the CarouselView to jump to a new position.
    /// The code-behind subscribes and calls <c>ScrollTo(index, animate: false)</c>
    /// so the CarouselView jumps instantly instead of animating through every
    /// intermediate item (which would fire OnCarouselItemChanged hundreds of times).
    /// </summary>
    public event EventHandler<int>? NavigationRequested;

    /// <summary>
    /// Navigates to a perek by ID.  Prepares all ViewModel state first, then
    /// asks the code-behind to scroll the CarouselView without animation.
    /// </summary>
    public async Task NavigateToPerekAsync(int perekId)
    {
        // A newer navigation supersedes every in-flight load attempt: a
        // detached timed-out attempt must not overwrite this perek late.
        InvalidatePendingLoads();
        if (CarouselPerakim != null && CarouselPerakim.Count == 929)
        {
            var targetPerek = GetReaderPerek(perekId);
            if (targetPerek != null)
            {
                await EnsurePasukimLoadedAsync(targetPerek);
                // Update ViewModel state (Perek, PerekId, last-learnt, etc.)
                SetPerek(targetPerek);
                // Load perushim before scrolling so the UI doesn't flash
                await LoadPerushimAsync(perekId);
                // Ask code-behind to scroll without animation
                NavigationRequested?.Invoke(this, perekId);
            }
        }
        else
        {
            // Carousel not yet initialized — full load
            await LoadByPerekIdAsync(perekId);
        }
    }
#endif

    /// <summary>
    /// All available commentary for focused verse reading, independent of inline filters.
    /// </summary>
    public List<PerushNoteDisplay> GetPerushimForPasuk(int pasukNum) =>
        _perushChapter?.GetDisplays(pasukNum, Perushim) ?? _perushNotesCache
        .Where(n => n.Pasuk == pasukNum)
        .GroupBy(n => (n.PerushId, n.PerushName))
        .OrderBy(g => Perushim.FindIndex(p => p.Id == g.Key.PerushId))
        .Select(g => new PerushNoteDisplay
        {
            PerushName = g.Key.PerushName,
            PerushId = g.Key.PerushId,
            NoteContents = g.OrderBy(n => n.NoteIdx).Select(n => n.NoteContent).ToList()
        }).ToList();

    public string InlineCommentaryLimitMessage => $"ניתן להציג עד {_preferencesService.InlineCommentaryLimit} פירושים על הפרק. ניתן לשנות בהעדפות.";

    /// <summary>Max perushim shown inline — unchecked rows render disabled at the cap.</summary>
    public int InlineCommentaryLimit => _preferencesService.InlineCommentaryLimit;

    /// <summary>A search result must remain visible even when all inline slots are occupied.</summary>
    public void ShowPerushForSearch(int perushId)
    {
        if (IsPerushChecked(perushId)) { return; }
        CheckedPerushim = CheckedPerushim.Take(_preferencesService.InlineCommentaryLimit - 1).ToList();
        ToggleCheckedPerush(perushId);
    }

    /// <summary>Toggles commentary in the inline reader.</summary>
    [RelayCommand]
    public void ToggleCheckedPerush(int perushId)
    {
        var list = new List<int>(CheckedPerushim);
        if (list.Contains(perushId))
        {
            list.Remove(perushId);
        }
        else
        {
            if (list.Count >= _preferencesService.InlineCommentaryLimit) { return; }
            list.Add(perushId);
        }

        CheckedPerushim = list;
        FillFilteredPerushContents();
    }

    /// <summary>
    /// Returns whether a perush is currently checked.
    /// </summary>
    public bool IsPerushChecked(int perushId) => CheckedPerushim.Contains(perushId);

    /// <summary>
    /// Fills each pasuk's PerushNotes based on checked perushim.
    /// </summary>
    private void FillFilteredPerushContents()
    {
        if (Perek?.Pasukim is not { } pasukim)
        {
            return;
        }

        var checkedSet = new HashSet<int>(CheckedPerushim);
        if (checkedSet.Count == 0)
        {
            foreach (var pasuk in pasukim)
            {
                if (pasuk.PerushNotes.Count > 0)
                {
                    pasuk.PerushNotes = new List<PerushNoteDisplay>();
                }
            }
            return;
        }

        if (_perushChapter != null)
        {
            foreach (var pasuk in Perek.Pasukim)
            {
                var displays = _perushChapter.GetDisplays(pasuk.PasukNum, Perushim, checkedSet, pasuk.PerushNotes);
                if (!displays.SequenceEqual(pasuk.PerushNotes)) { pasuk.PerushNotes = displays; }
            }
            return;
        }

        var byPasuk = _perushNotesCache
            .Where(n => checkedSet.Contains(n.PerushId))
            .GroupBy(n => n.Pasuk)
            .ToDictionary(g => g.Key, g => g.ToList());

        var priorityOrder = Perushim.Select((p, i) => (p.Id, i)).ToDictionary(x => x.Id, x => x.i);

        foreach (var pasuk in pasukim)
        {
            var notesForPasuk = byPasuk.GetValueOrDefault(pasuk.PasukNum) ?? new List<PerekPerushNote>();
            var groups = notesForPasuk
                .GroupBy(n => (n.PerushId, n.PerushName))
                .OrderBy(g => priorityOrder.GetValueOrDefault(g.Key.PerushId, 999))
                .Select(g => new PerushNoteDisplay
                {
                    PerushName = g.Key.PerushName,
                    PerushId = g.Key.PerushId,
                    NoteContents = g.OrderBy(n => n.NoteIdx).Select(n => n.NoteContent).ToList()
                })
                .ToList();
            if (groups.Count > 0 || pasuk.PerushNotes.Count > 0)
            {
                pasuk.PerushNotes = groups;
            }
        }
    }

    /// <summary>
    /// Sets the current perek and clears selection.
    /// Also updates the carousel for swipe navigation.
    /// </summary>
    private void SetPerek(Perek perek)
    {
        DebugLog.Write($"[Carousel] SetPerek perekId={perek.PerekId}");
        // Clear selection BEFORE switching — so the old perek's pasuk IsSelected flags are reset
        ClearSelected();
        Perek = perek;

        // Update last learnt perek in preferences
        SaveLastLearntPerek();
    }

    /// <summary>
    /// Persists the current perek ID as "last learnt" so the app can resume here on next launch.
    /// Called from SetPerek (programmatic navigation) and from the code-behind on carousel swipe.
    /// </summary>
    public void SaveLastLearntPerek()
    {
        if (Perek != null && Perek.PerekId > 0)
        {
            _preferencesService.LastLearntPerek = Perek.PerekId;
        }
    }

#if MAUI
    /// <summary>
    /// Half-window size for pasukim pre-loading around the current perek.
    /// The carousel always contains all 929 perakim, but only a buffer of pasukim is pre-loaded.
    /// </summary>
    private const int PasukimBufferHalf = 1;

    /// <summary>
    /// Initializes the carousel with ALL 929 perakim (lightweight metadata).
    /// Building the metadata list runs on a
    /// background thread so the UI stays responsive.  The ObservableCollection
    /// and CarouselView updates happen back on the main thread.
    /// </summary>
    public Task InitializeCarouselAsync() => InitializeCarouselCoreAsync(null, 0);

    /// <summary>
    /// Carousel initialization for the perek-load pipeline: when called with a
    /// <paramref name="gate"/>, the bound-collection swap is dropped if the
    /// attempt was superseded while the list was building off-thread.
    /// </summary>
    private async Task InitializeCarouselCoreAsync(LoadGate? gate, int attemptStamp)
    {
        if (Perek == null)
        {
            return;
        }

        var perekId = PerekId;
        var perek = Perek;

        DebugLog.Write($"[Carousel] InitializeCarouselAsync START perekId={perekId}");

        // Publish the requested reader without waiting for speculative chapter data.
        var list = await Task.Run(() =>
        {
            var result = new List<Perek>(929);
            for (var id = 1; id <= 929; id++)
            {
                var p = id == perekId ? perek : GetReaderPerek(id);
                if (p != null)
                {
                    result.Add(p);
                }
            }

            return result;
        });

        // A superseded attempt must not swap the bound collection or steal
        // CurrentCarouselPerek — likewise bail if the perek changed under us
        // for any other reason (e.g. a swipe landed mid-build).
        if (!ReferenceEquals(Perek, perek) ||
            (gate != null && !IsCurrentLoad(gate, attemptStamp)))
        {
            return;
        }

        DebugLog.Write($"[Carousel] InitializeCarouselAsync built list: {list.Count} items");

        // Assign collection on the main thread.
        // NOTE: CarouselView resets Position to 0 when ItemsSource changes — the
        // code-behind ScrollTo(targetPos, animate:false) corrects this immediately.
        CarouselPerakim = new System.Collections.ObjectModel.ObservableCollection<Perek>(list);
        CurrentCarouselPerek = perek;

        DebugLog.Write($"[Carousel] InitializeCarouselAsync DONE perekId={perekId}");
    }

    /// <summary>
    /// Ensures pasukim are loaded for the given perek.
    /// Called from OnCarouselItemChanged to lazy-load pasukim on demand (~5ms).
    /// </summary>
    public async Task EnsurePasukimLoadedAsync(Perek perek)
    {
        if (perek.Pasukim != null && perek.Pasukim.Count > 0)
        {
            return;
        }

        DebugLog.Write($"[Carousel] EnsurePasukimLoaded perekId={perek.PerekId}");
        try
        {
            // Bounded like the fresh-load path — a stalled query must not hold
            // the awaiting navigation forever (issue #2084). The cell keeps its
            // loading view and the next swipe retries the fetch.
            perek.Pasukim = await _perekDataService.LoadPasukimAsync(perek.PerekId)
                .WaitAsync(LoadAttemptTimeout);
        }
        catch (TimeoutException)
        {
            Console.Error.WriteLine($"[PerekLoad] EnsurePasukimLoaded timed out after " +
                $"{LoadAttemptTimeout.TotalSeconds:0.##}s (perekId={perek.PerekId})");
        }
    }

    /// <summary>
    /// Pre-loads pasukim AND perushim notes for perakim adjacent to the given center,
    /// so the next swipe is instant (no two-step flash).
    /// Runs in the background — never blocks the UI.
    /// </summary>
    public async Task PreloadAdjacentPasukimAsync(int centerPerekId)
    {
        var start = Math.Max(1, centerPerekId - PasukimBufferHalf);
        var end = Math.Min(929, centerPerekId + PasukimBufferHalf);

        // Hit SQLite on a background thread so the main thread stays responsive.
        var loaded = await Task.Run(() => LoadMissingPasukimAsync(start, end));
        AssignLoadedPasukim(loaded);

        DebugLog.Write($"[Carousel] PreloadAdjacent [{start}..{end}] center={centerPerekId}");
    }

    /// <summary>
    /// Loads pasukim for perakim in [start..end] that have none yet, plus their perushim notes
    /// into the preload cache. Does not touch the bound <see cref="Perek.Pasukim"/>.
    /// </summary>
    private async Task<List<(Perek Perek, List<Pasuk> Pasukim)>> LoadMissingPasukimAsync(int start, int end)
    {
        var loaded = new List<(Perek, List<Pasuk>)>();
        for (var id = start; id <= end; id++)
        {
            var p = GetReaderPerek(id);
            if (p != null && p.Pasukim.Count == 0)
            {
                loaded.Add((p, await _perekDataService.LoadPasukimAsync(id)));
            }
        }

        await PreloadAdjacentPerushimAsync(start, end);
        return loaded;
    }

    /// <summary>
    /// Perek.Pasukim is bound to realized carousel cells; setting it from a background
    /// thread updates native list views off the UI thread (a UIKit crash on iOS).
    /// Call from the UI context, i.e. after awaiting the background load.
    /// </summary>
    private static void AssignLoadedPasukim(List<(Perek Perek, List<Pasuk> Pasukim)> loaded)
    {
        foreach (var (perek, pasukim) in loaded)
        {
            if (perek.Pasukim.Count == 0)
            {
                perek.Pasukim = pasukim;
            }
        }
    }

    private Perek? GetReaderPerek(int perekId)
    {
        if (_readerPerakim.TryGetValue(perekId, out var existing))
        {
            return existing;
        }
        var metadata = _perekDataService.GetPerek(perekId);
        return metadata == null ? null : _readerPerakim.GetOrAdd(perekId, _ => metadata.CreateReaderCopy());
    }

    /// <summary>
    /// Preloads perushim data (IDs, catalog metadata, notes) for a range of perakim
    /// into <see cref="_perushimPreloadCache"/> so <see cref="LoadPerushimAsync"/>
    /// can use it instantly on swipe.
    /// </summary>
    private async Task PreloadAdjacentPerushimAsync(int start, int end)
    {
        if (!_notesService.IsAvailable || !_catalogService.IsAvailable)
        {
            return;
        }

        for (var id = start; id <= end; id++)
        {
            bool alreadyCached;
            lock (_perushimPreloadCache)
            {
                alreadyCached = _perushimPreloadCache.ContainsKey(id);
            }
            if (alreadyCached)
            {
                continue;
            }

            try
            {
                var chapter = await _notesService.LoadChapterAsync(id);
                var perushIds = chapter?.PerushIds ?? [];
                if (perushIds.Count == 0)
                {
                    lock (_perushimPreloadCache)
                    {
                        _perushimPreloadCache[id] = new PreloadedPerushimData(
                            [], new Dictionary<int, Perush>(), null);
                    }
                    continue;
                }

                var perushById = await _catalogService.GetPerushimByIdsAsync(perushIds);

                lock (_perushimPreloadCache)
                {
                    _perushimPreloadCache[id] = new PreloadedPerushimData(perushIds, perushById, chapter);
                }
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine($"[Carousel] PreloadPerushim perekId={id} failed: {ex.Message}");
            }
        }
    }

#endif

    #endregion

    #region Bookmark Methods

    /// <summary>
    /// Toggles the bookmark status of the current perek.
    /// </summary>
    [RelayCommand]
    public void ToggleBookmark()
    {
        if (Perek == null)
        {
            return;
        }

        _preferencesService.ToggleBookmark(PerekId);
        OnPropertyChanged(nameof(IsBookmarked));
    }

    #endregion

#if MAUI
    #region Navigation Methods

    /// <summary>
    /// Navigates to the articles page for the current perek.
    /// </summary>
    [RelayCommand]
    public async Task GoToArticlesAsync()
    {
        if (Perek == null)
        {
            return;
        }

        try
        {
            var encodedTitle = Uri.EscapeDataString(Source);
            await _navigator.GoToAsync($"ArticlesPage?perekId={PerekId}&perekTitle={encodedTitle}");
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine($"Navigation to ArticlesPage failed: {ex}");
            await _navigator.DisplayAlertAsync("שגיאה", $"לא ניתן לטעון מאמרים: {ex.Message}", "אישור");
        }
    }

    /// <summary>
    /// Navigates to the authors page.
    /// </summary>
    [RelayCommand]
    public async Task GoToAuthorsAsync()
    {
        try
        {
            await _navigator.GoToAsync("AuthorsPage");
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine($"Navigation to AuthorsPage failed: {ex}");
            await _navigator.DisplayAlertAsync("שגיאה", $"לא ניתן לטעון רבנים: {ex.Message}", "אישור");
        }
    }

    /// <summary>
    /// Exports perushim diagnostics to a file and opens the share sheet for support.
    /// </summary>
    [RelayCommand]
    public async Task ExportPerushimLogsAsync()
    {
        try
        {
            var report = await _notesService.GetDiagnosticsAsync();
            var fileName = $"perushim_diagnostics_{DateTime.UtcNow:yyyyMMdd_HHmmss}.txt";
            var path = Path.Combine(_fileSystem.CacheDirectory, fileName);
            await File.WriteAllTextAsync(path, report);
            await _share.RequestAsync(new ShareFileRequest
            {
                Title = "ייצוא לוגים - פירושים",
                File = new ShareFile(path),
            });
        }
        catch (Exception ex)
        {
            System.Diagnostics.Debug.WriteLine($"Export perushim logs failed: {ex.Message}");
            await _navigator.DisplayAlertAsync("שגיאה", $"לא ניתן לייצא לוגים: {ex.Message}", "אישור");
        }
    }

    #endregion
#endif

    #region Pasuk Selection Methods

    /// <summary>
    /// Clears all selected pasukim.
    /// </summary>
    [RelayCommand]
    public void ClearSelected()
    {
        // Clear IsSelected on all pasukim
        if (Perek?.Pasukim != null)
        {
            foreach (var pasuk in Perek.Pasukim)
            {
                pasuk.IsSelected = false;
            }
        }
        SelectedPasukNums = new List<int>();
    }

    /// <summary>
    /// Toggles selection state of a pasuk.
    /// </summary>
    [RelayCommand]
    public void ToggleSelectedPasuk(int pasukNum)
    {
        var newList = new List<int>(SelectedPasukNums);
        var pasuk = Perek?.Pasukim?.FirstOrDefault(p => p.PasukNum == pasukNum);

        if (newList.Contains(pasukNum))
        {
            newList.Remove(pasukNum);
            if (pasuk != null)
            {
                pasuk.IsSelected = false;
            }
        }
        else
        {
            newList.Add(pasukNum);
            if (pasuk != null)
            {
                pasuk.IsSelected = true;
            }
        }

        SelectedPasukNums = newList;
    }

    /// <summary>
    /// Checks if a pasuk is currently selected.
    /// </summary>
    public bool IsPasukSelected(int pasukNum)
    {
        return SelectedPasukNums.Contains(pasukNum);
    }

    #endregion

    private void RefreshPreferences()
    {
        if (Math.Abs(_fontFactor - _preferencesService.FontFactor) > 0.001)
        {
            FontFactor = _preferencesService.FontFactor;
        }
        if (_divineNameMaskingRevision != DivineNameMasking.Revision)
        {
            DivineNameMaskingRevision = DivineNameMasking.Revision;
        }
        OnPropertyChanged(nameof(DivineNameMaskingEnabled));
        OnPropertyChanged(nameof(IsQriynotEnabled));
        OnPropertyChanged(nameof(ShowHeaderPlayButton));
        OnPropertyChanged(nameof(InlineCommentaryLimitMessage));
        OnPropertyChanged(nameof(InlineCommentaryLimit));
        if (CheckedPerushim.Count > _preferencesService.InlineCommentaryLimit)
        {
            CheckedPerushim = CheckedPerushim.Take(_preferencesService.InlineCommentaryLimit).ToList();
            FillFilteredPerushContents();
        }
    }
}

/// <summary>
/// Cached perushim data for a single perek, used by the preload buffer.
/// </summary>
internal record PreloadedPerushimData(
    IReadOnlyList<int> PerushIds,
    Dictionary<int, Perush> PerushById,
    PerushNoteChapter? Chapter);
