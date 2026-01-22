using System.Collections.ObjectModel;
using CommunityToolkit.Mvvm.ComponentModel;
using BibleOnSite.Models;
using BibleOnSite.Data;

namespace BibleOnSite.ViewModels;

/// <summary>
/// ViewModel for full-text search across authors, perakim, pesukim, and perushim.
/// Modeled after the legacy Flutter app's search functionality.
/// </summary>
public partial class SearchViewModel : ObservableObject
{
    private const string SearchPhraseAll = "*";

    private readonly HashSet<SearchFilter> _enabledFilters;
    private readonly HashSet<int> _enabledSefarim;
    private readonly List<Author> _authors = new();

#pragma warning disable MVVMTK0045
    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(OptimizedSearchPhrase))]
    private string _searchPhrase = string.Empty;

    [ObservableProperty]
    private int _resultsLimit = 10;

    [ObservableProperty]
    private bool _isLoading;

    [ObservableProperty]
    private ObservableCollection<SearchResult> _searchResults = new();
#pragma warning restore MVVMTK0045

    public SearchViewModel()
    {
        // Initialize all filters as enabled
        _enabledFilters = new HashSet<SearchFilter>(Enum.GetValues<SearchFilter>());

        // Initialize all sefarim (1-35) as enabled
        _enabledSefarim = new HashSet<int>(Enumerable.Range(1, 35));
    }

    /// <summary>
    /// Gets the optimized search phrase with whitespace trimmed and "הרב" prefix removed.
    /// </summary>
    public string OptimizedSearchPhrase
    {
        get
        {
            if (string.IsNullOrWhiteSpace(SearchPhrase))
                return SearchPhraseAll;

            return SearchPhrase.Trim().Replace("הרב ", string.Empty);
        }
    }

    #region Filter Management

    /// <summary>
    /// Checks if a search filter is enabled.
    /// </summary>
    public bool IsFilterEnabled(SearchFilter filter)
    {
        return _enabledFilters.Contains(filter);
    }

    /// <summary>
    /// Enables or disables a search filter.
    /// </summary>
    public void SetFilterEnabled(SearchFilter filter, bool enabled)
    {
        if (enabled)
            _enabledFilters.Add(filter);
        else
            _enabledFilters.Remove(filter);

        OnPropertyChanged(nameof(IsFilterEnabled));
    }

    /// <summary>
    /// Checks if a sefer filter is enabled.
    /// </summary>
    public bool IsSeferFilterEnabled(int seferId)
    {
        return _enabledSefarim.Contains(seferId);
    }

    /// <summary>
    /// Enables or disables a sefer filter.
    /// </summary>
    public void SetSeferFilterEnabled(int seferId, bool enabled)
    {
        if (enabled)
            _enabledSefarim.Add(seferId);
        else
            _enabledSefarim.Remove(seferId);

        OnPropertyChanged(nameof(IsSeferFilterEnabled));
    }

    /// <summary>
    /// Checks if all sefarim in a group are enabled.
    /// </summary>
    public bool IsSeferGroupFilterEnabled(int groupIndex)
    {
        var (from, to) = SefarimData.GetSeferGroupRange(groupIndex);
        for (int seferId = from; seferId <= to; seferId++)
        {
            if (!_enabledSefarim.Contains(seferId))
                return false;
        }
        return true;
    }

    /// <summary>
    /// Enables or disables all sefarim in a group.
    /// </summary>
    public void SetSeferGroupFilterEnabled(int groupIndex, bool enabled)
    {
        var (from, to) = SefarimData.GetSeferGroupRange(groupIndex);

        for (int seferId = from; seferId <= to; seferId++)
        {
            if (enabled)
                _enabledSefarim.Add(seferId);
            else
                _enabledSefarim.Remove(seferId);
        }

        OnPropertyChanged(nameof(IsSeferGroupFilterEnabled));
        OnPropertyChanged(nameof(IsSeferFilterEnabled));
    }

    #endregion

    #region Authors

    /// <summary>
    /// Sets the authors list for searching.
    /// </summary>
    public void SetAuthors(IEnumerable<Author> authors)
    {
        _authors.Clear();
        _authors.AddRange(authors);
    }

    /// <summary>
    /// Gets author search results matching the current search phrase.
    /// </summary>
    public List<AuthorSearchResult> GetAuthorResults()
    {
        if (!IsFilterEnabled(SearchFilter.Author))
            return new List<AuthorSearchResult>();

        if (OptimizedSearchPhrase == SearchPhraseAll)
            return _authors.Select(a => new AuthorSearchResult(a, OptimizedSearchPhrase)).ToList();

        var searchTerm = OptimizedSearchPhrase;

        return _authors
            .Where(author =>
            {
                var nameWithoutPrefix = author.Name.Replace("הרב ", string.Empty);
                return nameWithoutPrefix.Contains(searchTerm, StringComparison.OrdinalIgnoreCase) ||
                       author.Name.Contains(searchTerm, StringComparison.OrdinalIgnoreCase);
            })
            .Take(ResultsLimit)
            .Select(a => new AuthorSearchResult(a, OptimizedSearchPhrase))
            .ToList();
    }

    #endregion

    #region Search Execution

#if MAUI
    /// <summary>
    /// Executes the search and populates SearchResults.
    /// </summary>
    public async Task SearchAsync()
    {
        if (OptimizedSearchPhrase == SearchPhraseAll)
        {
            SearchResults.Clear();
            return;
        }

        try
        {
            IsLoading = true;
            SearchResults.Clear();

            // Add author results
            if (IsFilterEnabled(SearchFilter.Author))
            {
                foreach (var result in GetAuthorResults())
                {
                    SearchResults.Add(result);
                }
            }

            // Add perek results (search by sefer name + perek)
            if (IsFilterEnabled(SearchFilter.Perek))
            {
                var perekResults = await GetPerekResultsAsync();
                foreach (var result in perekResults)
                {
                    SearchResults.Add(result);
                }
            }

            // Note: Pasuk and Perush search would require API calls
            // These are placeholders for the full implementation
        }
        finally
        {
            IsLoading = false;
        }
    }

    private async Task<List<PerekSearchResult>> GetPerekResultsAsync()
    {
        // This would search perakim by source name
        // For now, return empty - full implementation would use PerekDataService
        await Task.CompletedTask;
        return new List<PerekSearchResult>();
    }
#endif

    #endregion
}
