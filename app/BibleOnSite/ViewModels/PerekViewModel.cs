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
    [NotifyPropertyChangedFor(nameof(DayOfWeek))]
    private Perek? _perek;

    [ObservableProperty]
    private List<int> _selectedPasukNums = new();
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

    public int SeferId => Perek?.SeferId ?? 0;

    public string SeferName => Perek?.SeferName ?? string.Empty;

    public Data.SeferGroup SeferGroup => SefarimData.GetSeferGroup(SeferId);

    public string SeferTanahUsName => Perek?.SeferTanahUsName ?? string.Empty;

    public string Source
    {
        get
        {
            if (Perek == null) return string.Empty;

            var additionalPart = Additional.HasValue ? $"{Additional.Value.ToHebrewLetters()} " : string.Empty;
            return $"{SeferName} {additionalPart}{PerekHeb} - {PerekId}";
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
        }
    }

    /// <summary>
    /// Loads the next perek in sequence.
    /// </summary>
    [RelayCommand]
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
    [RelayCommand]
    public async Task LoadPreviousAsync()
    {
        if (PreviousPerekId > 0 && PreviousPerekId != PerekId)
        {
            await LoadByPerekIdAsync(PreviousPerekId);
        }
    }
#endif

    /// <summary>
    /// Sets the current perek and clears selection.
    /// </summary>
    private void SetPerek(Perek perek)
    {
        Perek = perek;
        ClearSelected();

        // Update last learnt perek in preferences
        _preferencesService.LastLearntPerek = perek.PerekId;
    }

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
        SelectedPasukNums = new List<int>();
    }

    /// <summary>
    /// Toggles selection state of a pasuk.
    /// </summary>
    [RelayCommand]
    public void ToggleSelectedPasuk(int pasukNum)
    {
        var newList = new List<int>(SelectedPasukNums);

        if (newList.Contains(pasukNum))
        {
            newList.Remove(pasukNum);
        }
        else
        {
            newList.Add(pasukNum);
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
