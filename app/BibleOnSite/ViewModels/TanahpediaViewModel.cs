using System.Collections.ObjectModel;
using BibleOnSite.Helpers;
using BibleOnSite.Models;
using BibleOnSite.Services;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;

namespace BibleOnSite.ViewModels;

/// <summary>
/// ViewModel for the Tanahpedia landing page — today's anniversaries, the
/// category hierarchy with entry counts, and recently updated entries,
/// mirroring the website's <c>/pedia</c> landing.
/// </summary>
#pragma warning disable S2333 // CommunityToolkit.Mvvm source generators supply the other partial declaration.
public partial class TanahpediaViewModel : ObservableObject
#pragma warning restore S2333
{
    private readonly ITanahpediaService _service;
    private readonly IAppNavigator _navigator;

    public TanahpediaViewModel() : this(TanahpediaService.Instance, ShellAppNavigator.Instance)
    {
    }

    public TanahpediaViewModel(ITanahpediaService service, IAppNavigator navigator)
    {
        _service = service;
        _navigator = navigator;
    }

#pragma warning disable MVVMTK0045
    [ObservableProperty]
    private bool _isLoading;

    [ObservableProperty]
    private bool _isLoaded;

    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(HasError))]
    private string? _errorMessage;

    [ObservableProperty]
    private string _hebrewDateText = string.Empty;

    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(HasToday))]
    private ObservableCollection<TanahpediaEntityItem> _todayEntities = new();

    [ObservableProperty]
    private ObservableCollection<TanahpediaCategoryGroup> _categoryGroups = new();

    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(HasRecent))]
    private ObservableCollection<TanahpediaEntry> _recentEntries = new();
#pragma warning restore MVVMTK0045

    public bool HasError => !string.IsNullOrEmpty(ErrorMessage);
    public bool HasToday => TodayEntities.Count > 0;
    public bool HasRecent => RecentEntries.Count > 0;

    /// <summary>
    /// Loads counts, recent entries and today's anniversaries in parallel.
    /// A failure in any section surfaces as the unavailable state with retry —
    /// the website shows the same "התוכן אינו זמין כרגע" warning.
    /// </summary>
    [RelayCommand]
    public async Task LoadAsync()
    {
        if (IsLoading)
        {
            return;
        }

        IsLoading = true;
        ErrorMessage = null;

        try
        {
            var (month, day) = HebrewDateHelper.GetTodayHebrewMonthDay();
            var countsTask = _service.GetCategoryCountsAsync(CancellationToken.None);
            var recentTask = _service.GetRecentEntriesAsync(8, CancellationToken.None);
            var todayTask = _service.GetTodayEntitiesAsync(month, day, CancellationToken.None);

            await Task.WhenAll(countsTask, recentTask, todayTask);

            var counts = countsTask.Result.ToDictionary(row => row.Category, row => row.Count);
            HebrewDateText = HebrewDateHelper.FormatTodayHebrewDate();

            TodayEntities = new ObservableCollection<TanahpediaEntityItem>(
                todayTask.Result.Select(TanahpediaEntityItem.ForToday));
            RecentEntries = new ObservableCollection<TanahpediaEntry>(recentTask.Result);
            CategoryGroups = new ObservableCollection<TanahpediaCategoryGroup>(
                TanahpediaTaxonomy.Hierarchy.Select(cat => TanahpediaCategoryGroup.Create(cat, counts)));
            IsLoaded = true;
        }
        #pragma warning disable S2221 // Deliberate failure boundary: landing load failure surfaces as ErrorMessage
        catch (Exception ex) //NOSONAR — landing load failure surfaces as ErrorMessage.
        {
            #pragma warning restore S2221
            Console.Error.WriteLine($"Tanahpedia landing load failed: {ex}");
            ErrorMessage = "התוכן אינו זמין כרגע";
        }
        finally
        {
            IsLoading = false;
        }
    }

    /// <summary>Opens a category listing page.</summary>
    [RelayCommand]
    public async Task OpenCategoryAsync(TanahpediaCategoryItem item)
    {
        if (item?.Category is not { } category)
        {
            return;
        }

        var route = $"tanahpediaCategory?key={Uri.EscapeDataString(category.Key)}" +
            $"&entityType={Uri.EscapeDataString(category.EntityType)}";
        if (category.Sub is { } sub)
        {
            route += $"&sub={Uri.EscapeDataString(sub)}";
        }
        await _navigator.GoToAsync(route);
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

/// <summary>
/// A category row in the landing grid (top-level or subcategory) with its
/// published-entry count.
/// </summary>
public class TanahpediaCategoryItem
{
    public required TanahpediaCategory Category { get; init; }
    public int Count { get; init; }

    /// <summary>"בקרוב" badge state — real zero counts, not load failures.</summary>
    public bool IsComingSoon => Count == 0;

    public string CountText => $"{Count} ערכים";
    public string Label => Category.Label;
}

/// <summary>A top-level category plus its subcategory rows.</summary>
public class TanahpediaCategoryGroup
{
    public required TanahpediaCategoryItem Parent { get; init; }
    public List<TanahpediaCategoryItem> Children { get; init; } = [];
    public bool HasChildren => Children.Count > 0;

    public static TanahpediaCategoryGroup Create(TanahpediaCategory category, IReadOnlyDictionary<string, int> counts)
    {
        int CountFor(string key) => counts.TryGetValue(key, out var count) ? count : 0;
        return new TanahpediaCategoryGroup
        {
            Parent = new TanahpediaCategoryItem { Category = category, Count = CountFor(category.Key) },
            Children = category.Children
                .Select(sub => new TanahpediaCategoryItem { Category = sub, Count = CountFor(sub.Key) })
                .ToList(),
        };
    }
}
