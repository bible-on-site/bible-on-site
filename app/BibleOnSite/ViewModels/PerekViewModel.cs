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
    }

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
            // Initialize carousel AFTER SetPerek so Perek/PerekId are up to date
            await InitializeCarouselAsync();
        }
    }

    /// <summary>
    /// Loads the next perek in sequence.
    /// </summary>
    [RelayCommand(CanExecute = nameof(CanGoToNextPerek))]
    public async Task LoadNextAsync()
    {
        if (NextPerekId > 0 && NextPerekId != PerekId)
        {
            await LoadByPerekIdAsync(NextPerekId);
        }
    }

    /// <summary>
    /// Loads the previous perek in sequence.
    /// </summary>
    [RelayCommand(CanExecute = nameof(CanGoToPreviousPerek))]
    public async Task LoadPreviousAsync()
    {
        if (PreviousPerekId > 0 && PreviousPerekId != PerekId)
        {
            await LoadByPerekIdAsync(PreviousPerekId);
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
            await LoadByPerekIdAsync(todayPerekId);
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
        Perek = perek;
        ClearSelected();

        // Update last learnt perek in preferences
        _preferencesService.LastLearntPerek = perek.PerekId;
    }

#if MAUI
    /// <summary>
    /// Half-window size for carousel pre-loading.
    /// The carousel will have up to (2 * HalfWindow + 1) items centered on the current perek.
    /// </summary>
    private const int CarouselHalfWindow = 10;

    /// <summary>
    /// Initializes the carousel with a wide window of perakim centered on the current perek.
    /// All pasukim are pre-loaded so the collection is never modified during swipes.
    /// Called on first load and when button/picker navigation moves outside the current window.
    /// </summary>
    public async Task InitializeCarouselAsync()
    {
        if (Perek == null) return;

        Console.WriteLine($"[Carousel] InitializeCarouselAsync START perekId={PerekId}");

        var windowStart = Math.Max(1, PerekId - CarouselHalfWindow);
        var windowEnd = Math.Min(929, PerekId + CarouselHalfWindow);

        var list = new List<Perek>(windowEnd - windowStart + 1);
        var loaded = 0;
        var cached = 0;

        for (var id = windowStart; id <= windowEnd; id++)
        {
            var p = id == PerekId ? Perek : PerekDataService.Instance.GetPerek(id);
            if (p != null)
            {
                // Load pasukim if not already cached on this instance
                if (p.Pasukim == null || p.Pasukim.Count == 0)
                {
                    p.Pasukim = await PerekDataService.Instance.LoadPasukimAsync(id);
                    loaded++;
                }
                else
                {
                    cached++;
                }
                list.Add(p);
            }
        }

        Console.WriteLine($"[Carousel] InitializeCarouselAsync built list: {list.Count} items [{windowStart}..{windowEnd}], loaded={loaded} cached={cached}");

        // Create the collection in one shot (no per-item CollectionChanged events)
        CarouselPerakim = new System.Collections.ObjectModel.ObservableCollection<Perek>(list);
        CarouselPosition = PerekId - windowStart;
        CurrentCarouselPerek = Perek;

        Console.WriteLine($"[Carousel] InitializeCarouselAsync DONE position={CarouselPosition} currentPerek={PerekId}");
    }

    /// <summary>
    /// Checks whether the given perekId is inside the current carousel window.
    /// If not, the carousel should be re-initialized.
    /// </summary>
    public bool IsInsideCarouselWindow(int perekId)
    {
        return CarouselPerakim.Any(p => p.PerekId == perekId);
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
