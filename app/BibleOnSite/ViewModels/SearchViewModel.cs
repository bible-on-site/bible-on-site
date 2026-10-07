using System.Collections.ObjectModel;
using CommunityToolkit.Mvvm.ComponentModel;
using BibleOnSite.Models;
using BibleOnSite.Data;
using BibleOnSite.Helpers;
using BibleOnSite.Services;

namespace BibleOnSite.ViewModels;

/// <summary>
/// ViewModel for full-text search across authors, perakim, pesukim, and perushim.
/// Modeled after the legacy Flutter app's search functionality.
/// </summary>
public partial class SearchViewModel : ObservableObject
{
    private readonly Services.PerekDataService _perekDataService;
    private readonly SearchIndexService? _searchIndex;
    private readonly bool _useDefaultIndex;
    private CancellationTokenSource? _searchCancellation;
    private int _searchVersion;
    private IReadOnlyDictionary<int, Perush> _perushim = new Dictionary<int, Perush>();
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
    private string _errorMessage = string.Empty;

    [ObservableProperty]
    private string _availabilityMessage = string.Empty;

    [ObservableProperty]
    private string _loadingMessage = "מחפש...";

    [ObservableProperty]
    private ObservableCollection<SearchResult> _searchResults = new();
#pragma warning restore MVVMTK0045

    public SearchViewModel() : this(PerekDataService.Instance, null) { _useDefaultIndex = true; }

    public SearchViewModel(PerekDataService perekDataService) : this(perekDataService, null) { }

    public SearchViewModel(PerekDataService perekDataService, SearchIndexService? searchIndex)
    {
        _perekDataService = perekDataService;
        _searchIndex = searchIndex;
        // Initialize all filters as enabled
        _enabledFilters = new HashSet<SearchFilter>(Enum.GetValues<SearchFilter>());

        // Initialize all sefarim (1-35) as enabled
        _enabledSefarim = new HashSet<int>(Enumerable.Range(1, 35));
    }

#pragma warning disable S1172 // ObservableProperty generates this hook with a value parameter.
    partial void OnSearchPhraseChanged(string value) => CancelSearch();
#pragma warning restore S1172

    public void CancelSearch()
    {
        _searchVersion++;
        _searchCancellation?.Cancel();
        _searchCancellation?.Dispose();
        _searchCancellation = null;
        IsLoading = false;
    }

    public void SetPerushim(IEnumerable<Perush> perushim) => _perushim = perushim.ToDictionary(perush => perush.Id);

    /// <summary>
    /// Gets the optimized search phrase with whitespace trimmed and "הרב" prefix removed.
    /// </summary>
    public string OptimizedSearchPhrase
    {
        get
        {
            if (string.IsNullOrWhiteSpace(SearchPhrase))
                return SearchPhraseAll;

            var normalized = SearchText.Normalize(SearchPhrase);
            return normalized.StartsWith("הרב ", StringComparison.Ordinal) ? normalized[4..] : normalized;
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
            .Select(author => new AuthorSearchResult(author, searchTerm)
            {
                Title = author.Name,
                SubtitleHtml = SearchText.Snippet(author.Details, searchTerm),
                Score = SearchText.Score(author.Name, searchTerm)
            })
            .Where(result => result.Score > 0)
            .OrderByDescending(result => result.Score)
            .Take(Math.Clamp(ResultsLimit, 1, 50))
            .ToList();
    }

    #endregion

    #region Search Execution

#if MAUI
    /// <summary>
    /// Executes the search and populates SearchResults.
    /// </summary>
    public async Task SearchAsync(CancellationToken cancellationToken = default)
    {
        CancelSearch();
        var version = _searchVersion;
        _searchCancellation = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        var token = _searchCancellation.Token;
        SearchResults.Clear();
        ErrorMessage = string.Empty;
        AvailabilityMessage = string.Empty;
        if (OptimizedSearchPhrase == SearchPhraseAll)
        {
            return;
        }
        // Author titles are optional for names, but every word matters in content.
        var phrase = SearchText.Normalize(SearchPhrase);
        var filters = _enabledFilters.ToHashSet();
        var books = _enabledSefarim.ToHashSet();
        var limit = Math.Clamp(ResultsLimit, 1, 50);
        try
        {
            IsLoading = true;
            var results = new List<SearchResult>(GetAuthorResults());
            if (filters.Any(filter => filter != SearchFilter.Author))
                await _perekDataService.LoadAsync().WaitAsync(token);
            if (filters.Contains(SearchFilter.Perek))
                results.AddRange(GetPerekResults(phrase, books));
            token.ThrowIfCancellationRequested();
            if (version == _searchVersion)
                PublishResults(results, limit);
            var searchIndex = _searchIndex;
            if (_useDefaultIndex && (filters.Contains(SearchFilter.Pasuk) || filters.Contains(SearchFilter.Perush)))
                searchIndex = SearchIndexService.Instance;
            if (searchIndex != null && (filters.Contains(SearchFilter.Pasuk) || filters.Contains(SearchFilter.Perush)))
            {
                var progress = new Progress<string>(message => { if (version == _searchVersion) LoadingMessage = message; });
                foreach (var type in new[] { SearchFilter.Pasuk, SearchFilter.Perush }.Where(filters.Contains))
                {
                    var hits = await searchIndex.SearchAsync(phrase, new HashSet<SearchFilter> { type }, books, limit, token, progress);
                    foreach (var hit in hits)
                    {
                        SearchResult result = hit.Type == SearchFilter.Pasuk
                            ? new PasukSearchResult(new Pasuk { Text = hit.Text, PasukNum = hit.PasukNum }, hit.PerekId, phrase)
                            : new PerushSearchResult(hit.PerushId.ToString(System.Globalization.CultureInfo.InvariantCulture), hit.Text, hit.PerekId, hit.PasukNum, phrase);
                        var name = hit.Type == SearchFilter.Perush ? (_perushim.GetValueOrDefault(hit.PerushId)?.Name ?? "פירוש") + " - " : string.Empty;
                        result.Title = name + _perekDataService.GetPerekSource(hit.PerekId) + " " + hit.PasukNum.ToHebrewLetters();
                        result.SubtitleHtml = SearchText.Snippet(hit.Text, phrase);
                        result.Score = hit.Score;
                        results.Add(result);
                    }
                    token.ThrowIfCancellationRequested();
                    if (version == _searchVersion)
                        PublishResults(results, limit);
                }
                if (version == _searchVersion && filters.Contains(SearchFilter.Perush) && !searchIndex.CommentaryAvailable)
                    AvailabilityMessage = "לחיפוש בפירושים, הורידו את הפירושים בהגדרות";
            }
            token.ThrowIfCancellationRequested();
            if (version == _searchVersion)
                PublishResults(results, limit);
        }
        catch (OperationCanceledException) when (token.IsCancellationRequested) { }
        catch
        {
            if (version == _searchVersion) ErrorMessage = "שגיאה בחיפוש. נסו שוב";
            throw;
        }
        finally
        {
            if (version == _searchVersion) IsLoading = false;
        }
    }

    private void PublishResults(List<SearchResult> results, int limit)
    {
        var visible = results.OrderByDescending(result => result.Score).Take(limit).ToArray();
        for (var position = 0; position < visible.Length; position++)
        {
            var existing = SearchResults.IndexOf(visible[position]);
            if (existing < 0) SearchResults.Insert(position, visible[position]);
            else if (existing != position) SearchResults.Move(existing, position);
        }
        while (SearchResults.Count > visible.Length) SearchResults.RemoveAt(SearchResults.Count - 1);
        // Preserve native result rows while slower commentary matches are added.
        OnPropertyChanged(nameof(SearchResults));
    }

    private IEnumerable<PerekSearchResult> GetPerekResults(string phrase, IReadOnlySet<int> books)
    {
        var referenceQuery = string.Join(" ", phrase.Split(' ').Select(word => int.TryParse(word, out var number) && number is > 0 and <= 929
            ? number.ToHebrewLetters() : word));
        return _perekDataService.Perakim!.Values
            .Where(perek => books.Contains(perek.SeferId))
            .Select(perek => new PerekSearchResult(perek, phrase)
            {
                Title = _perekDataService.GetPerekSource(perek.PerekId) ?? string.Empty,
                SubtitleHtml = SearchText.Snippet(perek.Header, phrase),
                Score = Math.Max(SearchText.Score(_perekDataService.GetPerekSource(perek.PerekId) ?? "", referenceQuery), SearchText.Score(perek.Header, phrase))
            })
            .Where(result => result.Score > 0).OrderByDescending(result => result.Score).ThenBy(result => result.Perek.PerekId);
    }
#endif

    #endregion
}
