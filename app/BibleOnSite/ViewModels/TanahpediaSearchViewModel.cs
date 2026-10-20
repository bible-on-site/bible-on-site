using System.Collections.ObjectModel;
using BibleOnSite.Models;
using BibleOnSite.Services;
using CommunityToolkit.Mvvm.ComponentModel;

namespace BibleOnSite.ViewModels;

/// <summary>
/// Search state for the Tanahpedia context — the Tanahpedia provider only,
/// with <c>מה לחפש</c> filtering over the encyclopedia taxonomy instead of the
/// general reader's provider choices. Category narrowing is applied by the
/// API before the result limit, so a narrowed search never sheds valid hits.
/// Selection is a deliberate choice: the category preset is applied once on
/// fresh navigation and never reapplied over the user's own changes.
/// </summary>
#pragma warning disable S2333 // CommunityToolkit.Mvvm source generators supply the other partial declaration.
public partial class TanahpediaSearchViewModel : ObservableObject
#pragma warning restore S2333
{
    private readonly ITanahpediaService _service;
    private readonly HashSet<string> _selectedCategories;
    private CancellationTokenSource? _searchCancellation;
    private int _searchVersion;
    private bool _presetApplied;

    public TanahpediaSearchViewModel() : this(TanahpediaService.Instance)
    {
    }

    public TanahpediaSearchViewModel(ITanahpediaService service)
    {
        _service = service;
        _selectedCategories = AllCategoryKeys().ToHashSet();
    }

#pragma warning disable MVVMTK0045
#pragma warning disable S2333 // ObservableProperty-generated setters assign these fields.
    [ObservableProperty]
    private string _searchPhrase = string.Empty;

    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(HasResults))]
    private ObservableCollection<TanahpediaSearchHit> _results = new();

    [ObservableProperty]
    private bool _isLoading;

    /// <summary>Availability/error note — offline, timeout or API failure.</summary>
    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(HasError))]
    private string _errorMessage = string.Empty;

    /// <summary>Summary text for the מה לחפש chip.</summary>
    [ObservableProperty]
    private string _categorySummary = "הכל";
#pragma warning restore S2333
#pragma warning restore MVVMTK0045

    public bool HasResults => Results.Count > 0;
    public bool HasError => !string.IsNullOrEmpty(ErrorMessage);

    /// <summary>Every selectable category key, parents and children.</summary>
    public static IReadOnlyList<string> AllCategoryKeys() =>
        TanahpediaTaxonomy.All.Select(category => category.Key).ToArray();

    /// <summary>True when the selection covers the whole taxonomy — the
    /// landing default and the בחר הכל state, sent to the API unscoped.</summary>
    public bool AllSelected => _selectedCategories.Count == AllCategoryKeys().Count;

    /// <summary>True when the user deliberately removed every category —
    /// the search then matches nothing rather than silently widening.</summary>
    public bool NoneSelected => _selectedCategories.Count == 0;

    public bool IsCategoryEnabled(string key) => _selectedCategories.Contains(key);

    /// <summary>
    /// Toggles a category. A parent toggles its subcategories with it, like
    /// the sefer-group checkboxes in the general search; unchecking a child
    /// unchecks the parent (union semantics cannot exclude a subcategory of
    /// a selected parent).
    /// </summary>
    public void SetCategoryEnabled(string key, bool enabled)
    {
        var category = TanahpediaTaxonomy.Find(key);
        if (category is null)
        {
            return;
        }
        if (enabled)
        {
            _selectedCategories.Add(key);
            foreach (var child in category.Children)
            {
                _selectedCategories.Add(child.Key);
            }
        }
        else
        {
            _selectedCategories.Remove(key);
            foreach (var child in category.Children)
            {
                _selectedCategories.Remove(child.Key);
            }
            // A child being removed also unchecks its parent.
            foreach (var parent in TanahpediaTaxonomy.Hierarchy.Where(
                parent => parent.Children.Any(child => child.Key == key)))
            {
                _selectedCategories.Remove(parent.Key);
            }
        }
        RefreshCategorySummary();
    }

    /// <summary>בחר הכל — back to the full taxonomy.</summary>
    public void SelectAllCategories()
    {
        _selectedCategories.UnionWith(AllCategoryKeys());
        RefreshCategorySummary();
    }

    /// <summary>
    /// Applies the context preset once: no key keeps the landing default (all
    /// categories); a category key narrows to exactly that category or
    /// subcategory. Later calls and re-appearances are no-ops — deliberate
    /// user choices are never overwritten.
    /// </summary>
    public void ApplyCategoryPreset(string? categoryKey)
    {
        if (_presetApplied)
        {
            return;
        }
        _presetApplied = true;
        if (string.IsNullOrEmpty(categoryKey))
        {
            return;
        }
        var category = TanahpediaTaxonomy.Find(categoryKey);
        if (category is null)
        {
            return;
        }
        _selectedCategories.Clear();
        _selectedCategories.Add(category.Key);
        // A preset on a parent includes its subcategories — the category
        // predicate already covers them server-side.
        foreach (var child in category.Children)
        {
            _selectedCategories.Add(child.Key);
        }
        RefreshCategorySummary();
    }

    private void RefreshCategorySummary()
    {
        CategorySummary = AllSelected
            ? "הכל"
            : _selectedCategories.Count == 1
                ? TanahpediaTaxonomy.LabelFor(_selectedCategories.Single())
                : $"{_selectedCategories.Count} קטגוריות";
    }

    /// <summary>The category keys to send — null when the selection covers
    /// the whole taxonomy (the unscoped query is cheaper and identical).</summary>
    public IReadOnlyCollection<string>? EffectiveCategories() =>
        AllSelected ? null : _selectedCategories.ToArray();

    /// <summary>
    /// Runs the scoped search. Cancellation and the version guard discard
    /// obsolete responses, so rapid query/filter changes never race.
    /// </summary>
    public async Task SearchAsync(CancellationToken cancellationToken)
    {
        var version = ++_searchVersion;
        var phrase = SearchPhrase.Trim();
        if (string.IsNullOrEmpty(phrase))
        {
            Results = [];
            ErrorMessage = string.Empty;
            IsLoading = false;
            return;
        }
        if (NoneSelected)
        {
            Results = [];
            ErrorMessage = string.Empty;
            IsLoading = false;
            return;
        }

        IsLoading = true;
        ErrorMessage = string.Empty;
        try
        {
            var hits = await _service.SearchEntriesAsync(phrase, 50, EffectiveCategories(), cancellationToken);
            if (version != _searchVersion || cancellationToken.IsCancellationRequested)
            {
                return;
            }
            Results = new ObservableCollection<TanahpediaSearchHit>(hits);
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            // A newer search or a closed panel cancelled this one.
        }
        catch (Exception ex) //NOSONAR — failure boundary: a failed search must land on the availability note, not crash the panel.
        {
            Console.Error.WriteLine($"Tanahpedia scoped search failed: {ex}");
            if (version == _searchVersion)
            {
                Results = [];
                ErrorMessage = "חיפוש התנכפדיה אינו זמין כרגע";
            }
        }
        finally
        {
            if (version == _searchVersion)
            {
                IsLoading = false;
            }
        }
    }

    /// <summary>Cancels the in-flight request, keeping the typed phrase.</summary>
    public void CancelSearch()
    {
        _searchVersion++;
        _searchCancellation?.Cancel();
        _searchCancellation?.Dispose();
        _searchCancellation = null;
        IsLoading = false;
    }
}
