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
        !PerushimCatalogAvailable ? "אין קטלוג פירושים" :
        !PerushimNotesAvailable ? "להוריד פירושים" :
        "אין פרשנות לפרק זה";

    /// <summary>Whether to show the download perushim button (notes not yet available).</summary>
    public bool ShowDownloadPerushimButton => PerushimCatalogAvailable && !PerushimNotesAvailable;

    private List<PerekPerushNote> _perushNotesCache = new();

    /// <summary>Carousel collection holding prev/current/next perek for swipe navigation.</summary>
    [ObservableProperty]
    private System.Collections.ObjectModel.ObservableCollection<Perek> _carouselPerakim = new();

    /// <summary>Current carousel position (0=prev, 1=current, 2=next).</summary>
    [ObservableProperty]
    private int _carouselPosition = 1;

    /// <summary>Currently displayed carousel perek.</summary>
    [ObservableProperty]
    private Perek? _currentCarouselPerek;
#pragma warning restore MVVMTK0045

    public PerekViewModel() : this(PreferencesService.Instance, null)
    {
    }

    public PerekViewModel(PreferencesService preferencesService, Func<int, Perek?>? perekLoader)
    {
        _preferencesService = preferencesService;
        _perekLoader = perekLoader ?? DefaultPerekLoader;

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

    /// <summary>Font scaling factor from user preferences (0.5–2.0).</summary>
    [ObservableProperty]
    private double _fontFactor = 1.0;

    private static Perek? DefaultPerekLoader(int perekId)
    {
        // Default loader returns null - async loading is expected
        // PerekDataService is used via LoadByPerekIdAsync() directly
        return null;
    }

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

    /// <summary>Count of available perushim for the current perek.</summary>
    public int PerushimCount => Perushim.Count;

    /// <summary>Whether the current perek has any perushim.</summary>
    public bool HasPerushim => PerushimCount > 0;

    public string Source
    {
        get
        {
            if (Perek == null) return string.Empty;

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

    /// <summary>
    /// Asynchronously loads a perek by its ID, including pasukim from the database.
    /// This method is only available in MAUI builds.
    /// </summary>
#if MAUI
    public async Task LoadByPerekIdAsync(int perekId)
    {
        // Ensure data service is loaded
        if (!PerekDataService.Instance.IsLoaded)
        {
            await PerekDataService.Instance.LoadAsync();
        }

        var perek = PerekDataService.Instance.GetPerek(perekId);
        if (perek != null)
        {
            // Load pasukim
            perek.Pasukim = await PerekDataService.Instance.LoadPasukimAsync(perekId);
            SetPerek(perek);
            await LoadPerushimAsync(perekId);
            await InitializeCarouselAsync();
        }
    }

    /// <summary>
    /// Loads perushim (commentaries) for the current perek.
    /// Catalog is bundled; notes come from PAD or HTTP on-demand.
    /// Previously checked perushim that are also available in the new perek stay checked.
    /// </summary>
    public async Task LoadPerushimAsync(int perekId)
    {
        await PerushimCatalogService.Instance.InitializeAsync();
        await PerushimNotesService.Instance.InitializeAsync();

        PerushimCatalogAvailable = PerushimCatalogService.Instance.IsAvailable;
        PerushimNotesAvailable = PerushimNotesService.Instance.IsAvailable;
        OnPropertyChanged(nameof(PerushimEmptyMessage));
        OnPropertyChanged(nameof(ShowDownloadPerushimButton));

        // Remember which perushim the user had checked so we can preserve them
        var previouslyChecked = new HashSet<int>(CheckedPerushim);

        Perushim = new List<Perush>();
        _perushNotesCache = new List<PerekPerushNote>();

        if (!PerushimNotesAvailable || !PerushimCatalogAvailable)
        {
            CheckedPerushim = new List<int>();
            FillFilteredPerushContents();
            return;
        }

        var perushIds = await PerushimNotesService.Instance.GetPerushIdsForPerekAsync(perekId);
        if (perushIds.Count == 0)
        {
            CheckedPerushim = new List<int>();
            FillFilteredPerushContents();
            return;
        }

        var perushById = await PerushimCatalogService.Instance.GetPerushimByIdsAsync(perushIds);
        var notes = await PerushimNotesService.Instance.LoadNotesForPerekAsync(perekId, perushById);

        _perushNotesCache = notes;

        // Order perushim by priority (Targum first, Rashi second, etc.)
        Perushim = perushIds
            .Select(id => perushById.GetValueOrDefault(id))
            .Where(p => p != null)
            .OrderBy(p => p!.Priority)
            .Cast<Perush>()
            .ToList();

        // Preserve checked perushim that are also available in the new perek
        var availableIds = new HashSet<int>(perushIds);
        CheckedPerushim = previouslyChecked.Where(id => availableIds.Contains(id)).ToList();

        FillFilteredPerushContents();
        OnPropertyChanged(nameof(PerushimEmptyMessage));
        OnPropertyChanged(nameof(ShowDownloadPerushimButton));
    }

    /// <summary>
    /// Toggles a perush in the checked list. When checked, its notes appear inline with the text.
    /// </summary>
    [RelayCommand]
    public void ToggleCheckedPerush(int perushId)
    {
        var list = new List<int>(CheckedPerushim);
        if (list.Contains(perushId))
            list.Remove(perushId);
        else
            list.Add(perushId);
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
        if (Perek?.Pasukim == null)
            return;

        var checkedSet = new HashSet<int>(CheckedPerushim);
        var byPasuk = _perushNotesCache
            .Where(n => checkedSet.Contains(n.PerushId))
            .GroupBy(n => n.Pasuk)
            .ToDictionary(g => g.Key, g => g.ToList());

        var priorityOrder = Perushim.Select((p, i) => (p.Id, i)).ToDictionary(x => x.Id, x => x.i);

        foreach (var pasuk in Perek.Pasukim)
        {
            var notesForPasuk = byPasuk.GetValueOrDefault(pasuk.PasukNum) ?? new List<PerekPerushNote>();
            var groups = notesForPasuk
                .GroupBy(n => (n.PerushId, n.PerushName))
                .OrderBy(g => priorityOrder.GetValueOrDefault(g.Key.PerushId, 999))
                .Select(g => new PerushNoteDisplay
                {
                    PerushName = g.Key.PerushName,
                    NoteContents = g.OrderBy(n => n.NoteIdx).Select(n => n.NoteContent).ToList()
                })
                .ToList();
            pasuk.PerushNotes = groups;
        }
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
        if (!PerekDataService.Instance.IsLoaded)
        {
            await PerekDataService.Instance.LoadAsync();
        }

        var todayPerekId = PerekDataService.Instance.GetTodaysPerekId();
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
        if (CarouselPerakim != null && CarouselPerakim.Count == 929)
        {
            var targetPerek = PerekDataService.Instance.GetPerek(perekId);
            if (targetPerek != null)
            {
                await EnsurePasukimLoadedAsync(targetPerek);
                // Update ViewModel state (Perek, PerekId, last-learnt, etc.)
                SetPerek(targetPerek);
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
    /// Sets the current perek and clears selection.
    /// Also updates the carousel for swipe navigation.
    /// </summary>
    private void SetPerek(Perek perek)
    {
        Console.WriteLine($"[Carousel] SetPerek perekId={perek.PerekId}");
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
    private const int PasukimBufferHalf = 10;

    /// <summary>
    /// Initializes the carousel with ALL 929 perakim (lightweight metadata).
    /// Heavy work (building the list + preloading adjacent pasukim) runs on a
    /// background thread so the UI stays responsive.  The ObservableCollection
    /// and CarouselView updates happen back on the main thread.
    /// </summary>
    public async Task InitializeCarouselAsync()
    {
        if (Perek == null) return;

        var perekId = PerekId;
        var perek = Perek;

        Console.WriteLine($"[Carousel] InitializeCarouselAsync START perekId={perekId}");

        // Build list + preload buffer on a background thread to avoid blocking UI.
        var list = await Task.Run(async () =>
        {
            var result = new List<Perek>(929);
            for (var id = 1; id <= 929; id++)
            {
                var p = id == perekId ? perek : PerekDataService.Instance.GetPerek(id);
                if (p != null) result.Add(p);
            }

            // Pre-load pasukim for a small buffer around the current perek
            var bufferStart = Math.Max(1, perekId - PasukimBufferHalf);
            var bufferEnd = Math.Min(929, perekId + PasukimBufferHalf);
            for (var id = bufferStart; id <= bufferEnd; id++)
            {
                var p = PerekDataService.Instance.GetPerek(id);
                if (p != null && (p.Pasukim == null || p.Pasukim.Count == 0))
                {
                    p.Pasukim = await PerekDataService.Instance.LoadPasukimAsync(id);
                }
            }

            return result;
        });

        Console.WriteLine($"[Carousel] InitializeCarouselAsync built list: {list.Count} items");

        // Assign collection on the main thread.
        // NOTE: CarouselView resets Position to 0 when ItemsSource changes — the
        // code-behind ScrollTo(targetPos, animate:false) corrects this immediately.
        CarouselPerakim = new System.Collections.ObjectModel.ObservableCollection<Perek>(list);
        CurrentCarouselPerek = perek;

        Console.WriteLine($"[Carousel] InitializeCarouselAsync DONE perekId={perekId}");
    }

    /// <summary>
    /// Ensures pasukim are loaded for the given perek.
    /// Called from OnCarouselItemChanged to lazy-load pasukim on demand (~5ms).
    /// </summary>
    public async Task EnsurePasukimLoadedAsync(Perek perek)
    {
        if (perek.Pasukim != null && perek.Pasukim.Count > 0) return;

        Console.WriteLine($"[Carousel] EnsurePasukimLoaded perekId={perek.PerekId}");
        perek.Pasukim = await PerekDataService.Instance.LoadPasukimAsync(perek.PerekId);
    }

    /// <summary>
    /// Pre-loads pasukim for perakim adjacent to the given center, so the next swipe is instant.
    /// Runs in the background — never blocks the UI.
    /// </summary>
    public Task PreloadAdjacentPasukimAsync(int centerPerekId)
    {
        var start = Math.Max(1, centerPerekId - PasukimBufferHalf);
        var end = Math.Min(929, centerPerekId + PasukimBufferHalf);

        // Run entirely on a background thread so the main thread stays
        // responsive while we hit SQLite for each adjacent perek.
        return Task.Run(async () =>
        {
            for (var id = start; id <= end; id++)
            {
                var p = PerekDataService.Instance.GetPerek(id);
                if (p != null && (p.Pasukim == null || p.Pasukim.Count == 0))
                {
                    p.Pasukim = await PerekDataService.Instance.LoadPasukimAsync(id);
                }
            }

            Console.WriteLine($"[Carousel] PreloadAdjacent [{start}..{end}] center={centerPerekId}");
        });
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
        if (Perek == null) return;

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
        if (Perek == null) return;

        try
        {
            var encodedTitle = Uri.EscapeDataString(Source);
            await Shell.Current.GoToAsync($"ArticlesPage?perekId={PerekId}&perekTitle={encodedTitle}");
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine($"Navigation to ArticlesPage failed: {ex}");
            await Shell.Current.DisplayAlert("שגיאה", $"לא ניתן לטעון מאמרים: {ex.Message}", "אישור");
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
            await Shell.Current.GoToAsync("AuthorsPage");
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine($"Navigation to AuthorsPage failed: {ex}");
            await Shell.Current.DisplayAlert("שגיאה", $"לא ניתן לטעון רבנים: {ex.Message}", "אישור");
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
            if (pasuk != null) pasuk.IsSelected = false;
        }
        else
        {
            newList.Add(pasukNum);
            if (pasuk != null) pasuk.IsSelected = true;
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
}
