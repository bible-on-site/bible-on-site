using System.Collections.ObjectModel;
using BibleOnSite.Models;
using BibleOnSite.Services;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;

namespace BibleOnSite.ViewModels;

/// <summary>
/// ViewModel for a Tanahpedia category listing — all entities of an entity
/// type (or a subcategory filter) with the entries that describe them. Zero,
/// one or several linked entries render as plain name, single link or a row of
/// links — the same contract as the website category pages.
/// </summary>
public partial class TanahpediaEntityTypeViewModel : ObservableObject
{
    private readonly ITanahpediaService _service;
    private readonly IAppNavigator _navigator;

    public TanahpediaEntityTypeViewModel() : this(TanahpediaService.Instance, ShellAppNavigator.Instance)
    {
    }

    public TanahpediaEntityTypeViewModel(ITanahpediaService service, IAppNavigator navigator)
    {
        _service = service;
        _navigator = navigator;
    }

#pragma warning disable MVVMTK0045
    /// <summary>Category key (e.g. PERSON, PROPHET, WAR) — drives the title.</summary>
    [ObservableProperty]
    private string _categoryKey = string.Empty;

    /// <summary>Base entity type the listing query runs against.</summary>
    [ObservableProperty]
    private string _entityType = string.Empty;

    /// <summary>Optional subcategory filter (PROPHET/KING, animal kind/purity).</summary>
    [ObservableProperty]
    private string? _sub;

    [ObservableProperty]
    private bool _isLoading;

    [ObservableProperty]
    private bool _isLoaded;

    [ObservableProperty]
    private string? _errorMessage;

    /// <summary>Admin-authored HTML intro from the category homepage config.</summary>
    [ObservableProperty]
    private string? _introContent;

    /// <summary>Configured homepage layout — LIST/MAP/GALLERY/TIMELINE.</summary>
    [ObservableProperty]
    private string _layoutType = "LIST";

    [ObservableProperty]
    private ObservableCollection<TanahpediaEntityItem> _entities = new();
#pragma warning restore MVVMTK0045

    /// <summary>Page title — the subcategory label when set, else the entity type's.</summary>
    public string Title => TanahpediaTaxonomy.LabelFor(
        string.IsNullOrEmpty(CategoryKey) ? EntityType : CategoryKey);

    public bool HasError => !string.IsNullOrEmpty(ErrorMessage);
    public bool HasIntro => !string.IsNullOrEmpty(IntroContent);
    public bool HasEntities => Entities.Count > 0;
    public bool IsEmpty => IsLoaded && Entities.Count == 0;

    partial void OnCategoryKeyChanged(string value) => OnPropertyChanged(nameof(Title));
    partial void OnEntityTypeChanged(string value) => OnPropertyChanged(nameof(Title));
    partial void OnErrorMessageChanged(string? value) => OnPropertyChanged(nameof(HasError));
    partial void OnIntroContentChanged(string? value) => OnPropertyChanged(nameof(HasIntro));
    partial void OnIsLoadedChanged(bool value) => OnPropertyChanged(nameof(IsEmpty));
    partial void OnEntitiesChanged(ObservableCollection<TanahpediaEntityItem> value)
    {
        OnPropertyChanged(nameof(IsEmpty));
        OnPropertyChanged(nameof(HasEntities));
    }

    /// <summary>Loads the category homepage config and the entity listing.</summary>
    [RelayCommand]
    public async Task LoadAsync()
    {
        if (IsLoading || EntityType.Length == 0)
            return;

        IsLoading = true;
        ErrorMessage = null;

        try
        {
            var homepageTask = _service.GetCategoryHomepageAsync(EntityType);
            var entitiesTask = _service.GetEntitiesWithEntriesAsync(EntityType, Sub);

            // The listing must load; a homepage failure only drops the intro.
            TanahpediaCategoryHomepage? homepage = null;
            try
            {
                homepage = await homepageTask;
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine($"Tanahpedia homepage load failed for {EntityType}: {ex}");
            }

            var entities = await entitiesTask;

            IntroContent = homepage?.Content;
            LayoutType = homepage?.LayoutType ?? "LIST";
            Entities = new ObservableCollection<TanahpediaEntityItem>(
                entities.Select(TanahpediaEntityItem.ForListing));
            IsLoaded = true;
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine($"Tanahpedia category load failed for {EntityType}/{Sub}: {ex}");
            ErrorMessage = "התוכן אינו זמין כרגע";
        }
        finally
        {
            IsLoading = false;
        }
    }

    /// <summary>Opens an entry by its canonical unique name.</summary>
    [RelayCommand]
    public async Task OpenEntryAsync(string? uniqueName)
    {
        if (string.IsNullOrEmpty(uniqueName))
            return;

        await _navigator.GoToAsync($"tanahpediaEntry?uniqueName={Uri.EscapeDataString(uniqueName)}");
    }
}
