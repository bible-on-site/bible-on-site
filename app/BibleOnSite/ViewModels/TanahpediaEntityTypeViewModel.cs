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
#pragma warning disable S2333 // CommunityToolkit.Mvvm source generators supply the other partial declaration.
public partial class TanahpediaEntityTypeViewModel : ObservableObject
#pragma warning restore S2333
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
    [NotifyPropertyChangedFor(nameof(Title))]
    private string _categoryKey = string.Empty;

    /// <summary>Base entity type the listing query runs against.</summary>
    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(Title))]
    private string _entityType = string.Empty;

    /// <summary>Optional subcategory filter (PROPHET/KING, animal kind/purity).</summary>
    [ObservableProperty]
    private string? _sub;

    [ObservableProperty]
    private bool _isLoading;

    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(IsEmpty))]
    private bool _isLoaded;

    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(HasError))]
    private string? _errorMessage;

    /// <summary>Admin-authored HTML intro from the category homepage config.</summary>
    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(HasIntro))]
    private string? _introContent;

    /// <summary>Configured homepage layout — LIST/MAP/GALLERY/TIMELINE.</summary>
    [ObservableProperty]
    private string _layoutType = "LIST";

    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(IsEmpty))]
    [NotifyPropertyChangedFor(nameof(HasEntities))]
    private ObservableCollection<TanahpediaEntityItem> _entities = new();
#pragma warning restore MVVMTK0045

    /// <summary>Page title — the subcategory label when set, else the entity type's.</summary>
    public string Title => TanahpediaTaxonomy.LabelFor(
        string.IsNullOrEmpty(CategoryKey) ? EntityType : CategoryKey);

    public bool HasError => !string.IsNullOrEmpty(ErrorMessage);
    public bool HasIntro => !string.IsNullOrEmpty(IntroContent);
    public bool HasEntities => Entities.Count > 0;
    public bool IsEmpty => IsLoaded && Entities.Count == 0;

    /// <summary>Loads the category homepage config and the entity listing.</summary>
    [RelayCommand]
    public async Task LoadAsync()
    {
        if (IsLoading || EntityType.Length == 0)
        {
            return;
        }

        IsLoading = true;
        ErrorMessage = null;

        try
        {
            var homepageTask = _service.GetCategoryHomepageAsync(EntityType, CancellationToken.None);
            var entitiesTask = _service.GetEntitiesWithEntriesAsync(EntityType, Sub, CancellationToken.None);

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
        {
            return;
        }

        await _navigator.GoToAsync($"tanahpediaEntry?uniqueName={Uri.EscapeDataString(uniqueName)}");
    }
}
