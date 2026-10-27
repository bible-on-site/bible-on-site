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
    private readonly ArticleService? _articleService;
    private readonly ITanahpediaService? _tanahpediaService;
    private readonly bool _useDefaultIndex;
    private readonly bool _useDefaultArticleService;
    private readonly bool _useDefaultTanahpediaService;
    private CancellationTokenSource? _searchCancellation;
    private int _searchVersion;
    private IReadOnlyDictionary<int, Perush> _perushim = new Dictionary<int, Perush>();
    private const string SearchPhraseAll = "*";

    private readonly HashSet<SearchFilter> _enabledFilters;
    private readonly HashSet<int> _enabledSefarim;
    // A scoped surface (e.g. the focused-pasuk reader) narrows "מה לחפש" to its
    // own kind list. The reader's selection is parked in _readerKinds while the
    // scope keeps its own selection in _scopedKinds across re-entries (#2466).
    private HashSet<SearchFilter>? _allowedKinds;
    private HashSet<SearchFilter>? _readerKinds;
    private readonly HashSet<SearchFilter> _scopedKinds = new();
    private readonly List<Author> _authors = new();
    public SearchSort Sorting { get; set; } = SearchSort.Relevance;

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

    /// <summary>Whether the perushim-download hint should render as a link row.</summary>
    [ObservableProperty]
    private bool _showPerushimDownloadLink;

    [ObservableProperty]
    private string _loadingMessage = "מחפש...";

    [ObservableProperty]
    private ObservableCollection<SearchResult> _searchResults = new();
#pragma warning restore MVVMTK0045

    public SearchViewModel() : this(PerekDataService.Instance, null)
    {
        _useDefaultIndex = true;
        _useDefaultArticleService = true;
        _useDefaultTanahpediaService = true;
    }

    public SearchViewModel(PerekDataService perekDataService) : this(perekDataService, null) { }

    public SearchViewModel(PerekDataService perekDataService, SearchIndexService? searchIndex)
        : this(perekDataService, searchIndex, null) { }

    public SearchViewModel(PerekDataService perekDataService, SearchIndexService? searchIndex, ArticleService? articleService)
        : this(perekDataService, searchIndex, articleService, null) { }

    public SearchViewModel(PerekDataService perekDataService, SearchIndexService? searchIndex, ArticleService? articleService, ITanahpediaService? tanahpediaService)
    {
        _perekDataService = perekDataService;
        _searchIndex = searchIndex;
        _articleService = articleService;
        _tanahpediaService = tanahpediaService;
        // Every kind starts selected (#2454). Kinds that cannot serve a search
        // right now (a remote kind while offline, or commentary without its
        // pack) stay selected in the sheet but are skipped by the
        // availability gate in SearchAsync, so intent survives while the
        // prerequisite is missing.
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
            {
                return SearchPhraseAll;
            }

            var normalized = SearchText.Normalize(SearchPhrase);
            return normalized.StartsWith("הרב ", StringComparison.Ordinal) ? normalized[4..] : normalized;
        }
    }

    #region Filter Management

    /// <summary>
    /// Connectivity probe shared by the filter sheet and the search. Testable:
    /// a host without MAUI Essentials cannot answer, so the probe assumes
    /// online and lets the bounded remote request surface real failures.
    /// </summary>
    internal Func<bool> NetworkProbe { get; set; } = () =>
    {
        try
        {
            return NetworkService.IsOnline;
        }
        #pragma warning disable S2221 // Deliberate failure boundary: availability probe: any failure counts as unavailable
        catch (Exception ex) when (ex is not OutOfMemoryException) //NOSONAR — availability probe: any failure counts as unavailable.
        {
            #pragma warning restore S2221
            return true;
        }
    };

    /// <summary>
    /// Installed commentary-pack probe; same test-host fallback as
    /// <see cref="NetworkProbe"/>. Only a determined-missing pack counts as
    /// unavailable: an unchecked pack is assumed present.
    /// </summary>
    internal Func<bool> CommentaryPackProbe { get; set; } = () =>
    {
        try
        {
            return !PerushimNotesService.Instance.IsDeterminedMissing;
        }
        #pragma warning disable S2221 // Deliberate failure boundary: availability probe: any failure counts as unavailable
        catch (Exception ex) when (ex is not OutOfMemoryException) //NOSONAR — availability probe: any failure counts as unavailable.
        {
            #pragma warning restore S2221
            return true;
        }
    };

    /// <summary>Whether the kind can currently serve a search.</summary>
    public bool IsKindAvailable(SearchFilter filter) =>
        filter.IsAvailable(NetworkProbe(), CommentaryPackProbe());

    /// <summary>Why the kind is unavailable for the filter sheet, or null when it can serve searches.</summary>
    public string? KindUnavailableReason(SearchFilter filter) =>
        filter.UnavailableReason(NetworkProbe(), CommentaryPackProbe());

    /// <summary>
    /// Selected kinds the latest search skipped because their prerequisite
    /// was missing. When one becomes available again the open search re-runs
    /// so its results stop missing the regained kind (#2454).
    /// </summary>
    private HashSet<SearchFilter> SkippedUnavailableKinds { get; set; } = new();

    /// <summary>True when a kind the last search skipped can serve a search now.</summary>
    public bool HasRegainedAvailableKind()
    {
        if (SkippedUnavailableKinds.Count == 0)
        {
            return false;
        }
        var online = NetworkProbe();
        var packAvailable = CommentaryPackProbe();
        return SkippedUnavailableKinds.Any(filter => filter.IsAvailable(online, packAvailable));
    }

    /// <summary>
    /// בחר הכל for the kinds sheet: toggles every currently-available kind and
    /// leaves unavailable ones with their stored intent (#2454).
    /// </summary>
    public void SetAvailableFiltersEnabled(bool enabled)
    {
        foreach (var filter in Enum.GetValues<SearchFilter>().Where(IsKindAvailable))
        {
            SetFilterEnabled(filter, enabled);
        }
    }

    /// <summary>בחר הכל for the books sheet: toggles every sefer across all groups.</summary>
    public void SetAllSefarimEnabled(bool enabled)
    {
        foreach (var group in SefarimData.SefarimGroups.Values)
        {
            for (var seferId = group.From; seferId <= group.To; seferId++)
            {
                if (enabled)
                {
                    _enabledSefarim.Add(seferId);
                }
                else
                {
                    _enabledSefarim.Remove(seferId);
                }
            }
        }

        OnPropertyChanged(nameof(IsSeferGroupFilterEnabled));
        OnPropertyChanged(nameof(IsSeferFilterEnabled));
    }

    /// <summary>
    /// Checks if a search filter is enabled.
    /// </summary>
    public bool IsFilterEnabled(SearchFilter filter)
    {
        return _enabledFilters.Contains(filter);
    }

    /// <summary>
    /// Enables or disables a search filter. A kind outside the active scope
    /// can only be turned off — scoped surfaces must never reach a provider
    /// they do not list.
    /// </summary>
    public void SetFilterEnabled(SearchFilter filter, bool enabled)
    {
        if (enabled)
        {
            if (!IsKindAllowed(filter))
            {
                return;
            }
            _enabledFilters.Add(filter);
        }
        else
        {
            _enabledFilters.Remove(filter);
        }

        OnPropertyChanged(nameof(IsFilterEnabled));
    }

    /// <summary>Whether a kinds scope is currently narrowing the search.</summary>
    public bool KindsScoped => _allowedKinds != null;

    /// <summary>Whether this kind may appear and be selected right now.</summary>
    public bool IsKindAllowed(SearchFilter filter) => _allowedKinds?.Contains(filter) ?? true;

    /// <summary>The kinds the kinds sheet lists — the scope's list while scoped.</summary>
    public IReadOnlyCollection<SearchFilter> KindOptions =>
        _allowedKinds ?? (IReadOnlyCollection<SearchFilter>)Enum.GetValues<SearchFilter>();

    /// <summary>
    /// Narrows the search to a surface's own kind list, parking the caller's
    /// selection. First entry defaults to every allowed kind on; later entries
    /// restore the selection the surface had when it was left.
    /// </summary>
    public void EnterKindsScope(IReadOnlyCollection<SearchFilter> allowedKinds)
    {
        if (_allowedKinds != null)
        {
            return;
        }
        _allowedKinds = allowedKinds.ToHashSet();
        _readerKinds = _enabledFilters.ToHashSet();
        if (_scopedKinds.Count == 0)
        {
            _scopedKinds.UnionWith(allowedKinds.Where(filter => !filter.RequiresNetwork()));
        }
        _enabledFilters.Clear();
        _enabledFilters.UnionWith(_scopedKinds);
        OnPropertyChanged(nameof(IsFilterEnabled));
    }

    /// <summary>Leaves the kinds scope and restores the parked selection.</summary>
    public void ExitKindsScope()
    {
        if (_allowedKinds == null)
        {
            return;
        }
        _scopedKinds.Clear();
        _scopedKinds.UnionWith(_enabledFilters);
        _enabledFilters.Clear();
        _enabledFilters.UnionWith(_readerKinds!);
        _readerKinds = null;
        _allowedKinds = null;
        OnPropertyChanged(nameof(IsFilterEnabled));
    }

    /// <summary>
    /// Restores the default enabled kinds: every local kind, or every allowed
    /// local kind while scoped. Remote kinds always stay opt-in.
    /// </summary>
    public void ResetFiltersToDefaults()
    {
        _enabledFilters.Clear();
        _enabledFilters.UnionWith(KindOptions.Where(filter => !filter.RequiresNetwork()));
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
        {
            _enabledSefarim.Add(seferId);
        }
        else
        {
            _enabledSefarim.Remove(seferId);
        }

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
            {
                return false;
            }
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
            {
                _enabledSefarim.Add(seferId);
            }
            else
            {
                _enabledSefarim.Remove(seferId);
            }
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
        {
            return new List<AuthorSearchResult>();
        }

        if (OptimizedSearchPhrase == SearchPhraseAll)
        {
            return _authors.Select(a => new AuthorSearchResult(a, OptimizedSearchPhrase)).ToList();
        }

        var searchTerm = OptimizedSearchPhrase;
        var normalizedTerm = SearchText.Normalize(searchTerm);

        // Score on the short name first: building the subtitle runs an HTML
        // parse plus normalization over the bio — only matching authors pay it.
        return _authors
            .Select(author => (author, Score: SearchText.ScoreNormalized(author.Name, normalizedTerm)))
            .Where(row => row.Score > 0)
            .Select(row => new AuthorSearchResult(row.author, searchTerm)
            {
                Title = row.author.Name,
                SubtitleHtml = SearchText.Snippet(row.author.Details, searchTerm),
                Score = row.Score
            })
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
    public async Task SearchAsync(CancellationToken cancellationToken)
    {
        // A debounce delay may finish before its UI continuation runs. If a
        // newer query canceled it meanwhile, it must not cancel that query
        // or clear its results when the old continuation is finally resumed.
        if (cancellationToken.IsCancellationRequested)
        {
            return;
        }
        CancelSearch();
        var version = _searchVersion;
        _searchCancellation = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        var token = _searchCancellation.Token;
        SearchResults.Clear();
        ErrorMessage = string.Empty;
        AvailabilityMessage = string.Empty;
        ShowPerushimDownloadLink = false;
        if (OptimizedSearchPhrase == SearchPhraseAll)
        {
            return;
        }
        // Author titles are optional for names, but every word matters in content.
        var phrase = SearchText.Normalize(SearchPhrase);
        // Effective kinds are the selected ones that can actually serve a
        // search right now (#2454): a remote kind while offline or commentary
        // without its pack is skipped without losing the user's selection.
        var online = NetworkProbe();
        var packAvailable = CommentaryPackProbe();
        var filters = _enabledFilters.Where(filter => filter.IsAvailable(online, packAvailable)).ToHashSet();
        // Remember which selected kinds this query skipped — when one becomes
        // available again the caller re-runs so results stop missing it (#2454).
        SkippedUnavailableKinds = _enabledFilters.Where(filter => !filter.IsAvailable(online, packAvailable)).ToHashSet();
        var books = _enabledSefarim.ToHashSet();
        var limit = Math.Clamp(ResultsLimit, 1, 50);
        var ordering = new SearchOrdering(Sorting, _perushim.ToDictionary(pair => pair.Key, pair => pair.Value.Priority));
        try
        {
            IsLoading = true;
            var results = new List<SearchResult>(GetAuthorResults());
            var availability = new List<string>();
            // Surface why a selected kind was skipped so the user knows its
            // prerequisite is missing rather than its results empty (#2454).
            foreach (var skipped in _enabledFilters.Where(filter => !filter.IsAvailable(online, packAvailable)))
            {
                if (skipped == SearchFilter.Perush)
                {
                    availability.Add("לחיפוש בפירושים, הורידו את הפירושים בהגדרות");
                    ShowPerushimDownloadLink = true;
                }
                else
                {
                    availability.Add($"חיפוש {skipped.GetHebrewName()} זמין רק עם חיבור רשת");
                }
            }
            if (availability.Count > 0)
            {
                AvailabilityMessage = string.Join('\n', availability);
            }
            // Remote hits run beside the local pipeline: each request is
            // already in flight while the local indexes load, and a slow or
            // unreachable API can never hold back local results. The tasks
            // only carry the outcome back so the result list stays
            // single-writer.
            var articleMerge = filters.Contains(SearchFilter.Articles)
                ? MergeArticleResultsAsync(phrase, limit, version, token)
                : null;
            var tanahpediaMerge = filters.Contains(SearchFilter.Tanahpedia)
                ? MergeTanahpediaResultsAsync(phrase, limit, version, token)
                : null;
            // Remote kinds are remote — they must not force the local perek DB load.
            if (filters.Any(filter => filter != SearchFilter.Author && !filter.RequiresNetwork()))
            {
                await _perekDataService.LoadAsync().WaitAsync(token);
            }

            if (filters.Contains(SearchFilter.Perek))
            {
                results.AddRange(await Task.Run(() => GetPerekResults(phrase, books).ToList(), token));
            }

            token.ThrowIfCancellationRequested();
            if (version == _searchVersion)
            {
                PublishResults(results, limit);
            }

            var searchIndex = _searchIndex;
            if (_useDefaultIndex && (filters.Contains(SearchFilter.Pasuk) || filters.Contains(SearchFilter.Perush)))
            {
                searchIndex = SearchIndexService.Instance;
            }

            if (searchIndex != null && (filters.Contains(SearchFilter.Pasuk) || filters.Contains(SearchFilter.Perush)))
            {
                var progress = new Progress<string>(message => { if (version == _searchVersion) { LoadingMessage = message; } });
                foreach (var type in new[] { SearchFilter.Pasuk, SearchFilter.Perush }.Where(filters.Contains))
                {
                    var hits = await searchIndex.SearchAsync(phrase, new HashSet<SearchFilter> { type }, books, limit, token, progress, ordering);
                    foreach (var hit in hits)
                    {
                        SearchResult result = hit.Type == SearchFilter.Pasuk
                            ? new PasukSearchResult(new Pasuk { Text = hit.Text, PasukNum = hit.PasukNum }, hit.PerekId, phrase)
                            : new PerushSearchResult(hit.PerushId.ToString(System.Globalization.CultureInfo.InvariantCulture), hit.Text, hit.PerekId, hit.PasukNum, phrase);
                        var name = hit.Type == SearchFilter.Perush ? (_perushim.GetValueOrDefault(hit.PerushId)?.Name ?? "פירוש") + " - " : string.Empty;
                        result.Title = name + _perekDataService.GetPerekSource(hit.PerekId) + " " + hit.PasukNum.ToHebrewLetters();
                        result.SubtitleHtml = SearchText.Snippet(hit.Text, phrase);
                        result.Score = hit.Score;
                        result.GenerationOrder = ordering.YearFor(hit.PerushId);
                        results.Add(result);
                    }
                    token.ThrowIfCancellationRequested();
                    if (version == _searchVersion)
                    {
                        PublishResults(results, limit);
                    }
                }
                if (version == _searchVersion && filters.Contains(SearchFilter.Perush) && !searchIndex.CommentaryAvailable)
                {
                    availability.Add("לחיפוש בפירושים, הורידו את הפירושים בהגדרות");
                    AvailabilityMessage = string.Join('\n', availability);
                    ShowPerushimDownloadLink = true;
                }
            }
            // Consume each remote merge as it completes — a stalled request
            // (e.g. article timeout) must not hold back an already-finished
            // Tanahpedia response.
            var merges = new List<Task<RemoteSearchOutcome?>>();
            if (articleMerge != null)
            {
                merges.Add(articleMerge);
            }
            if (tanahpediaMerge != null)
            {
                merges.Add(tanahpediaMerge);
            }
            while (merges.Count > 0)
            {
                var done = await Task.WhenAny(merges);
                merges.Remove(done);
                var outcome = await done;
                if (version != _searchVersion || outcome == null)
                {
                    continue;
                }
                if (outcome.UnavailableMessage != null)
                {
                    availability.Add(outcome.UnavailableMessage);
                    AvailabilityMessage = string.Join('\n', availability);
                }
                else if (outcome.Hits != null)
                {
                    results.AddRange(outcome.Hits);
                }
            }
            token.ThrowIfCancellationRequested();
            if (version == _searchVersion)
            {
                PublishResults(results, limit);
            }
        }
        catch (OperationCanceledException) when (token.IsCancellationRequested) { }
        catch //NOSONAR — surfaces the search error message, then rethrows with the stack preserved.
        {
            if (version == _searchVersion)
            {
                ErrorMessage = "שגיאה בחיפוש. נסו שוב";
            }

            throw;
        }
        finally
        {
            if (version == _searchVersion)
            {
                IsLoading = false;
            }
        }
    }

    /// <summary>Result of a remote search request: either merged hits or an availability note.</summary>
    private sealed class RemoteSearchOutcome
    {
        public List<SearchResult>? Hits { get; init; }
        public string? UnavailableMessage { get; init; }
    }

    /// <summary>
    /// Fetches remote article-content hits for an in-flight search. Remote
    /// kinds cannot be served locally, so failures degrade to an availability
    /// note instead of an error — and never throw. Hits are returned rather
    /// than published so the result list stays single-writer.
    /// </summary>
    private async Task<RemoteSearchOutcome?> MergeArticleResultsAsync(string phrase, int limit, int version, CancellationToken token)
    {
        try
        {
            var articleService = _useDefaultArticleService ? ArticleService.Instance : _articleService;
            if (articleService == null)
            {
                return null;
            }
            var page = await articleService.SearchArticlesAsync(phrase, limit, cancellationToken: token);
            if (version != _searchVersion)
            {
                return null;
            }
            if (page == null)
            {
                return new RemoteSearchOutcome { UnavailableMessage = "חיפוש תוכן מאמרים זמין רק עם חיבור רשת" };
            }
            var hits = new List<SearchResult>(page.Hits.Count);
            foreach (var hit in page.Hits)
            {
                hits.Add(new ArticleSearchResult(hit.ArticleId, hit.PerekId, hit.AuthorName, hit.Source, hit.Excerpt, phrase)
                {
                    Title = hit.Name,
                    SubtitleHtml = SearchText.Snippet(hit.Excerpt, phrase),
                    Score = (int)Math.Round(hit.Score * 100),
                });
            }
            return new RemoteSearchOutcome { Hits = hits };
        }
        catch (OperationCanceledException) when (token.IsCancellationRequested)
        {
            // A newer query or a closed panel cancelled this request; the latest
            // search version owns the result list now.
            return null;
        }
        #pragma warning disable S2221 // Deliberate failure boundary: remote article search degrades to an availability note
        catch (Exception ex) //NOSONAR — remote article search degrades to an availability note.
        {
            #pragma warning restore S2221
            Console.Error.WriteLine($"Article search failed: {ex.Message}");
            return new RemoteSearchOutcome { UnavailableMessage = "חיפוש תוכן מאמרים דורש חיבור רשת תקין" };
        }
    }

    /// <summary>
    /// Fetches remote Tanahpedia entry hits for an in-flight search — entry
    /// titles, canonical/alias names and body text, ranked by the API exactly
    /// like the website's /search provider. The service resolves aliases and
    /// disambiguation targets to canonical entries (one hit per entry), so
    /// navigation always uses <see cref="TanahpediaSearchResult.UniqueName"/>.
    /// Failures degrade to an availability note — and never throw.
    /// </summary>
    private async Task<RemoteSearchOutcome?> MergeTanahpediaResultsAsync(string phrase, int limit, int version, CancellationToken token)
    {
        try
        {
            var service = _useDefaultTanahpediaService ? (ITanahpediaService?)TanahpediaService.Instance : _tanahpediaService;
            if (service == null)
            {
                return null;
            }
            var hits = await service.SearchEntriesAsync(phrase, limit, token);
            if (version != _searchVersion)
            {
                return null;
            }
            var results = new List<SearchResult>(hits.Count);
            foreach (var hit in hits)
            {
                results.Add(new TanahpediaSearchResult(hit.Id, hit.UniqueName, hit.Excerpt, hit.Score, phrase)
                {
                    Title = hit.Title,
                    // The excerpt is plain text; Snippet re-highlights the
                    // phrase and HTML-escapes it for the subtitle label.
                    SubtitleHtml = string.IsNullOrWhiteSpace(hit.Excerpt)
                        ? string.Empty
                        : SearchText.Snippet(hit.Excerpt, phrase),
                });
            }
            return new RemoteSearchOutcome { Hits = results };
        }
        catch (OperationCanceledException) when (token.IsCancellationRequested)
        {
            // A newer query or a closed panel cancelled this request; the latest
            // search version owns the result list now.
            return null;
        }
        #pragma warning disable S2221 // Deliberate failure boundary: remote pedia search degrades to an availability note
        catch (Exception ex) //NOSONAR — remote pedia search degrades to an availability note.
        {
            #pragma warning restore S2221
            Console.Error.WriteLine($"Tanahpedia search failed: {ex.Message}");
            return new RemoteSearchOutcome { UnavailableMessage = "חיפוש התנכפדיה אינו זמין כרגע" };
        }
    }

    private void PublishResults(List<SearchResult> results, int limit)
    {
        var visible = (Sorting == SearchSort.Generation
            ? results.OrderBy(result => result.GenerationOrder).ThenBy(result => result.SourceOrder).ThenByDescending(result => result.Score)
            : results.OrderByDescending(result => result.Score)).Take(limit).ToArray();
        ReconcileVisibleResults(SearchResults, visible);
        // Preserve native result rows while slower commentary matches are added.
        OnPropertyChanged(nameof(SearchResults));
    }

    /// <summary>
    /// Reconciles the bound results collection with the latest visible slice:
    /// inserts newcomers at their position, moves reordered items, and trims
    /// leftovers beyond the limit — without replacing the collection instance.
    /// </summary>
    internal static void ReconcileVisibleResults(ObservableCollection<SearchResult> target, IReadOnlyList<SearchResult> visible)
    {
        for (var position = 0; position < visible.Count; position++)
        {
            var existing = target.IndexOf(visible[position]);
            if (existing < 0)
            {
                target.Insert(position, visible[position]);
            }
            else if (existing != position)
            {
                target.Move(existing, position);
            }
        }
        while (target.Count > visible.Count)
        {
            target.RemoveAt(target.Count - 1);
        }
    }

    private IEnumerable<PerekSearchResult> GetPerekResults(string phrase, IReadOnlySet<int> books)
    {
        var referenceQuery = string.Join(" ", phrase.Split(' ').Select(word => int.TryParse(word, out var number) && number is > 0 and <= 929
            ? number.ToHebrewLetters() : word));
        var normalizedReference = SearchText.Normalize(referenceQuery);
        var normalizedPhrase = SearchText.Normalize(phrase);
        return _perekDataService.Perakim!.Values
            .Where(perek => books.Contains(perek.SeferId))
            .Select(perek => (Perek: perek, Source: _perekDataService.GetPerekSource(perek.PerekId) ?? string.Empty))
            .Select(row => (row.Perek, row.Source,
                Score: Math.Max(SearchText.ScoreNormalized(row.Source, normalizedReference),
                    SearchText.ScoreNormalized(row.Perek.Header, normalizedPhrase))))
            .Where(row => row.Score > 0)
            .OrderByDescending(row => row.Score).ThenBy(row => row.Perek.PerekId)
            .Select(row => new PerekSearchResult(row.Perek, phrase)
            {
                Title = row.Source,
                SubtitleHtml = SearchText.Snippet(row.Perek.Header, phrase),
                GenerationOrder = int.MinValue,
                Score = row.Score
            });
    }
#endif

    #endregion
}
