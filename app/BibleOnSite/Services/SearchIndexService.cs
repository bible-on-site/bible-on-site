using BibleOnSite.Helpers;
using BibleOnSite.Models;
using SQLite;
using System.Collections.Concurrent;
using System.Diagnostics;

namespace BibleOnSite.Services;

/// <summary>Disposable derived FTS5 indexes; the installed content databases remain read-only.</summary>
public sealed class SearchIndexService : IAsyncDisposable
{
    private readonly PerekDataService _perakim;
    private readonly PerushimNotesService? _notes;
    private readonly string _indexPath;
    private SQLiteAsyncConnection _index;
    private readonly Dictionary<string, SemaphoreSlim> _gates = new()
    {
        ["verses"] = new(1, 1),
        ["notes"] = new(1, 1)
    };
    private readonly ConcurrentDictionary<string, string> _ready = new();
    private readonly Dictionary<string, Task> _buildTasks = new();
    private readonly Task _initialization;
    private bool _disposed;
    private readonly object _buildSync = new();
    private string? _stagedAwaitingNotes;
    // Current-generation delivered indexes store note identity (NoteIdx) in
    // notes_documents instead of a second copy of the text (#3309). Indexes
    // delivered before that change still carry the text — read whichever layout
    // the adopted file has. null = the notes table is not ready or unsniffed.
    private bool? _notesDocumentsCarryText;

    // The e2e warmup gate: stays closed until the reader's first load settles.
    private static int _startupSettleSignaled;
    private static bool IsStartupSettleSignaled => Volatile.Read(ref _startupSettleSignaled) == 1;
    private readonly TaskCompletionSource _startupSettled = new(TaskCreationOptions.RunContinuationsAsynchronously);

    private static readonly Lazy<SearchIndexService> _instance = new(() => new(PerekDataService.Instance,
        PerushimNotesService.Instance, Path.Join(FileSystem.Current.CacheDirectory, "hebrew-search.sqlite")));
    public static SearchIndexService Instance => _instance.Value;

    public SearchIndexService(PerekDataService perakim, PerushimNotesService? notes, string indexPath)
    {
        _perakim = perakim;
        _notes = notes;
        _indexPath = indexPath;
        _index = new SQLiteAsyncConnection(indexPath);
        if (IsStartupSettleSignaled)
        {
            _startupSettled.TrySetResult();
        }
        _initialization = Task.Run(InitializeIndexAsync);
        if (notes != null)
        {
            notes.OperationCompleted += OnNotesOperationCompleted;
        }
    }

    public bool CommentaryAvailable { get; private set; }

    // The mobile-e2e harness launches the app with this marker so the index
    // builds while earlier scenarios still run, instead of the first perush
    // search paying the multi-minute commentary import inside its own window.
    // Production launches never set it and keep the lazy path.
    internal const string E2eEnvironmentVariable = "BIBLE_E2E";

    // Android app launches cannot carry process environment, so the suite
    // delivers the marker as an intent extra on the session's launch intent.
    // adb activateApp relaunches drop extras, so the first marked launch
    // persists a marker file for every later process in the same install —
    // the file dies with the install, which is the suite's lifetime anyway.
    private static string E2eMarkerPath => Path.Join(FileSystem.AppDataDirectory, "e2e.launch");

    [System.Diagnostics.CodeAnalysis.ExcludeFromCodeCoverage(
        Justification = "E2E-only startup hook; the mobile suite launches with BIBLE_E2E.")]
    public static void WarmupForE2e()
    {
        if (!IsE2eMarkedProcess())
        {
            return;
        }
        // Fire-and-forget: a faulted build logs here instead of throwing into
        // startup; a concurrent search still awaits the shared build task.
        // Task.Run keeps the file probes, pack opens and import continuations
        // off the startup UI thread — the same reason SearchAsync hops.
        _ = Task.Run(Instance.WarmupAfterStartupSettlesAsync).ContinueWith(
            task => Console.WriteLine($"E2E search-index warmup failed: {task.Exception}"),
            TaskContinuationOptions.OnlyOnFaulted);
    }

    /// <summary>
    /// Releases the deferred e2e warmup. Called once the reader's first load
    /// settled — the point where cold-start main-thread work is done.
    /// </summary>
    [System.Diagnostics.CodeAnalysis.ExcludeFromCodeCoverage(
        Justification = "App-lifecycle hook; the PerekPage signal only fires on a device.")]
    internal static void NotifyStartupSettled()
    {
        Volatile.Write(ref _startupSettleSignaled, 1);
        if (_instance.IsValueCreated)
        {
            _instance.Value.MarkStartupSettled();
        }
    }

    internal void MarkStartupSettled() => _startupSettled.TrySetResult();

    // MainActivity calls this when the launch intent carries the e2e extra.
    [System.Diagnostics.CodeAnalysis.ExcludeFromCodeCoverage(
        Justification = "E2E-only startup hook; the mobile suite launches with BIBLE_E2E.")]
    internal static void MarkE2eLaunchFromIntent()
    {
        Environment.SetEnvironmentVariable(E2eEnvironmentVariable, "1");
        try
        {
            File.WriteAllText(E2eMarkerPath, "1");
        }
        catch (IOException exception)
        {
            Console.WriteLine($"E2E launch marker persist failed: {exception.Message}");
        }
    }

    [System.Diagnostics.CodeAnalysis.ExcludeFromCodeCoverage(
        Justification = "E2E-only startup hook; the mobile suite launches with BIBLE_E2E.")]
    // The coverage endpoint's shared secret reaches Android the same way the
    // launch marker does: an intent extra on the suite's session launch. The
    // file survives the adb relaunches that drop extras; the endpoint resolves
    // env first, then this file.
    private static string E2eCoverageTokenPath => Path.Join(FileSystem.AppDataDirectory, "e2e-coverage-token");

    [System.Diagnostics.CodeAnalysis.ExcludeFromCodeCoverage(
        Justification = "E2E-only startup hook; the mobile suite launches with BIBLE_E2E_COVERAGE_TOKEN.")]
    internal static void MarkE2eCoverageToken(string token)
    {
        Environment.SetEnvironmentVariable("BIBLE_E2E_COVERAGE_TOKEN", token);
        try
        {
            File.WriteAllText(E2eCoverageTokenPath, token);
        }
        catch (IOException exception)
        {
            Console.WriteLine($"E2E coverage token persist failed: {exception.Message}");
        }
    }

    [System.Diagnostics.CodeAnalysis.ExcludeFromCodeCoverage(
        Justification = "E2E-only startup hook; the mobile suite launches with BIBLE_E2E.")]
    internal static bool IsE2eMarkedProcess()
    {
        if (Environment.GetEnvironmentVariable(E2eEnvironmentVariable) == "1")
        {
            return true;
        }
        return File.Exists(E2eMarkerPath);
    }

    [System.Diagnostics.CodeAnalysis.ExcludeFromCodeCoverage(
        Justification = "E2E-only startup hook; the mobile suite launches with BIBLE_E2E.")]
    // The e2e emulator shares ~2 vCPUs between the app, the OS and UiAutomator:
    // a warmup starting inside CreateWindow burned the whole cold-start window
    // on index builds and the accessibility manager could not snapshot the
    // tree for over 10s (#2430). Wait for the reader's first load to settle,
    // then build one table at a time so the main looper keeps a core.
    internal async Task WarmupAfterStartupSettlesAsync()
    {
        if (!IsStartupSettleSignaled)
        {
            await _startupSettled.Task;
        }
        // The notes import dwarfs every other warmup cost. On the iOS leg the
        // instrumented simulator build cannot absorb it inside suite budgets —
        // the full build is only needed by searches with real commentary, and
        // the iOS scenarios fabricate a tiny perushim pack instead. Let the
        // notes index stay lazy there; the shared build task still dedups a
        // mid-test build if one is ever requested.
#if IOS
        await WarmTableAsync("verses");
#else
        await WarmTableAsync("verses");
        await WarmTableAsync("notes");
#endif
    }

    // Shares the search path's dedup so a warmup build is also the build a
    // concurrent search awaits, and DisposeAsync can drain it.
    [System.Diagnostics.CodeAnalysis.ExcludeFromCodeCoverage(
        Justification = "E2E-only startup hook; the mobile suite launches with BIBLE_E2E.")]
    private Task WarmTableAsync(string table)
    {
        lock (_buildSync)
        {
            ObjectDisposedException.ThrowIf(_disposed, this);
            if (!_buildTasks.TryGetValue(table, out var build) || build.IsCompleted)
            {
                _buildTasks[table] = build = EnsureIndexAsync(table);
            }
            return build;
        }
    }

    public Task<List<SearchHit>> SearchAsync(string query, IReadOnlySet<SearchFilter> filters,
        IReadOnlySet<int> books, int limit, CancellationToken cancellationToken) =>
        SearchAsync(query, filters, books, limit, cancellationToken, null);

    public Task<List<SearchHit>> SearchAsync(string query, IReadOnlySet<SearchFilter> filters,
        IReadOnlySet<int> books, int limit, CancellationToken cancellationToken, IProgress<string>? progress) =>
        SearchAsync(query, filters, books, limit, cancellationToken, progress, SearchOrdering.Relevant);

    public Task<List<SearchHit>> SearchAsync(string query, IReadOnlySet<SearchFilter> filters,
        IReadOnlySet<int> books, int limit, CancellationToken cancellationToken, IProgress<string>? progress, SearchOrdering ordering) =>
        // SQLite awaits alone do not move blob decoding, vocabulary expansion or
        // text scoring off the caller's dispatcher. Keep the whole service on a worker.
        Task.Run(() => SearchCoreAsync(query, filters, books, limit, cancellationToken, progress, ordering), cancellationToken);

    private async Task<List<SearchHit>> SearchCoreAsync(string query, IReadOnlySet<SearchFilter> filters,
        IReadOnlySet<int> books, int limit, CancellationToken cancellationToken, IProgress<string>? progress, SearchOrdering ordering)
    {
        var terms = SearchText.Tokens(query);
        if (terms.Length is 0 or > 16 || terms.Any(term => term.Length > 64) || books.Count == 0)
        {
            return [];
        }
        limit = Math.Clamp(limit, 1, 50);
        var normalizedQuery = SearchText.Normalize(query);
        progress?.Report(filters.Contains(SearchFilter.Perush) && !_ready.ContainsKey("notes")
            ? "מכין את החיפוש בפסוקים ובפירושים..." : "מחפש...");
        var hits = new List<SearchHit>();
        foreach (var (table, type) in new[] { ("verses", SearchFilter.Pasuk), ("notes", SearchFilter.Perush) })
        {
            if (!filters.Contains(type))
            {
                continue;
            }
            // Changed queries can stop waiting while each independent import continues.
            Task build;
            lock (_buildSync)
            {
                ObjectDisposedException.ThrowIf(_disposed, this);
                if (!_buildTasks.TryGetValue(table, out build!) || build.IsCompleted)
                {
                    _buildTasks[table] = build = Task.Run(() => EnsureIndexAsync(table));
                }
            }
            await build.WaitAsync(cancellationToken);
            await _gates[table].WaitAsync(cancellationToken);
            try
            {
                if (!_ready.ContainsKey(table))
                {
                    continue;
                }
                cancellationToken.ThrowIfCancellationRequested();
                var phrase = "\"" + string.Join(" ", terms) + "\"";
                var rows = await QueryAsync(table, phrase, books, limit, ordering);
                if (rows.Count < limit)
                {
                    var exactWords = string.Join(" AND ", terms.Select(term => $"\"{term}\""));
                    rows = rows.Concat(await QueryAsync(table, exactWords, books, limit, ordering)).DistinctBy(row => row.RowId).ToList();
                }
                if (rows.Count < limit)
                {
                    var prefixes = string.Join(" AND ", terms.Select(term => $"\"{term}\"*"));
                    rows = rows.Concat(await QueryAsync(table, prefixes, books, limit, ordering)).DistinctBy(row => row.RowId).ToList();
                }
                // Spelling tolerance is a fallback. Do not hold direct matches
                // behind a full vocabulary scan to fill unused result slots.
                if (rows.Count == 0)
                {
                    var clauses = new List<string>();
                    foreach (var term in terms)
                    {
                        cancellationToken.ThrowIfCancellationRequested();
                        var edits = SearchText.MaxEdits(term);
                        var alternatives = edits == 0 ? [] : await _index.QueryAsync<VocabularyRow>(
                            $"SELECT term FROM {table}_vocab WHERE length(term) BETWEEN ? AND ?",
                            term.Length - edits, term.Length + edits);
                        var similar = ExpandTerm(alternatives.Select(row => row.Term), term, edits, cancellationToken);
                        clauses.Add("(" + string.Join(" OR ", similar.Prepend($"\"{term}\"*")) + ")");
                    }
                    var fuzzy = await QueryAsync(table, string.Join(" AND ", clauses), books, limit, ordering);
                    rows = rows.Concat(fuzzy).DistinctBy(row => row.RowId).ToList();
                }
                if (table == "notes" && _notesDocumentsCarryText == false)
                {
                    await ResolveNoteBodiesAsync(rows, cancellationToken);
                    // An indexed identity missing from the blob means a
                    // corrupt pack — never surface a blank hit.
                    rows.RemoveAll(row => row.Body.Length == 0);
                }
                hits.AddRange(rows.Select(row => new SearchHit(type, row.PerekId, row.PasukNum,
                    row.PerushId, row.Body, SearchText.ScoreNormalized(row.Body, normalizedQuery))));
            }
            finally { _gates[table].Release(); }
        }
        cancellationToken.ThrowIfCancellationRequested();
        return (ordering.Sort == SearchSort.Generation
            ? hits.OrderBy(hit => ordering.YearFor(hit.PerushId)).ThenBy(hit => hit.PerekId).ThenBy(hit => hit.PasukNum)
            : hits.OrderByDescending(hit => hit.Score)).Take(limit).ToList();
    }

    internal static string[] ExpandTerm(IEnumerable<string> vocabulary, string term, int edits, CancellationToken token)
    {
        const int kept = 24;
        var best = new List<(string Term, int Distance)>(kept);
        var matcher = new SearchSpellingMatcher(term, edits);
        foreach (var candidate in vocabulary)
        {
            // A changed query must release the table gate without finishing
            // a whole vocabulary scan first. This method already runs on the
            // search worker, so another Task.Run only adds scheduling work.
            token.ThrowIfCancellationRequested();
            // A term that cannot reach the worst kept rank on characters alone
            // (distance ≥ 0 ties lose on the ordinal term) skips the distance pass.
            if (best.Count == kept && best[^1].Distance == 0
                && string.CompareOrdinal(candidate, best[^1].Term) >= 0)
            {
                continue;
            }
            var distance = matcher.Distance(candidate);
            if (distance > edits) { continue; }
            // Bounded top-K: insert into the sorted list only when the candidate
            // ranks inside it — no materialized list of every match or full sort.
            var insertAt = best.BinarySearch((candidate, distance), RankComparer.Default);
            if (insertAt < 0) { insertAt = ~insertAt; }
            if (insertAt >= kept) { continue; }
            best.Insert(insertAt, (candidate, distance));
            if (best.Count > kept) { best.RemoveAt(kept); }
        }
        return best.Select(row => $"\"{row.Term}\"").ToArray();
    }

    private sealed class RankComparer : IComparer<(string Term, int Distance)>
    {
        public static readonly RankComparer Default = new();
        public int Compare((string Term, int Distance) x, (string Term, int Distance) y)
        {
            var byDistance = x.Distance.CompareTo(y.Distance);
            return byDistance != 0 ? byDistance : string.CompareOrdinal(x.Term, y.Term);
        }
    }

    private Task<List<IndexRow>> QueryAsync(string table, string match, IReadOnlySet<int> books, int limit, SearchOrdering ordering)
    {
        var bookIds = books.Order().ToArray();
        var placeholders = string.Join(",", bookIds.Select(_ => "?"));
        var arguments = new List<object> { match };
        arguments.AddRange(bookIds.Cast<object>());
        var orderSql = $"bm25({table}), {table}.rowid";
        if (ordering.Sort == SearchSort.Generation)
        {
            var years = ordering.CommentaryYears.OrderBy(pair => pair.Key).ToArray();
            var generationSql = "CASE WHEN c.PerushId = 0 THEN -2147483648 ELSE 2147483647 END";
            if (table == "notes" && years.Length > 0)
            {
                generationSql = "CASE c.PerushId " + string.Join(" ", years.Select(_ => "WHEN ? THEN ?")) + " ELSE 2147483647 END";
                foreach (var year in years)
                {
                    arguments.Add(year.Key);
                    arguments.Add(year.Value);
                }
            }
            orderSql = $"{generationSql}, c.PerekId, c.PasukNum, {table}.rowid";
        }
        arguments.Add(limit);
        // In the slim layout the documents row holds the note's identity and
        // the body is resolved from the notes blob below instead (#3309).
        var bodySql = table == "notes" && _notesDocumentsCarryText == false
            ? "c.NoteIdx"
            : "c.Text AS Body";
        return _index.QueryAsync<IndexRow>($"SELECT {table}.rowid AS RowId, c.PerekId, c.PasukNum, c.PerushId, {bodySql} FROM {table} " +
            $"JOIN {table}_documents c ON c.rowid = {table}.rowid WHERE {table} MATCH ? AND c.SeferId IN ({placeholders}) " +
            $"ORDER BY {orderSql} LIMIT ?", arguments.ToArray());
    }

    /// <summary>
    /// Fills `IndexRow.Body` for slim-layout notes hits: their documents rows
    /// carry the note's identity instead of the text, so the body comes back
    /// from the compressed perek blob — one blob per perek, shared by all hits
    /// landing in it. The text path is identical to the delivered index's own
    /// transform: `PlainText` over the decoded note content.
    /// </summary>
    private async Task ResolveNoteBodiesAsync(List<IndexRow> rows, CancellationToken cancellationToken)
    {
        if (_notes == null)
        {
            return;
        }
        // The perush names the reader path maps are irrelevant to hit bodies.
        var unused = new Dictionary<int, Perush>();
        foreach (var perek in rows.GroupBy(row => row.PerekId))
        {
            cancellationToken.ThrowIfCancellationRequested();
            var notes = await _notes.LoadNotesForPerekAsync(perek.Key, unused);
            var bodies = new Dictionary<(int Pasuk, int PerushId, int NoteIdx), string>();
            foreach (var note in notes)
            {
                bodies[(note.Pasuk, note.PerushId, note.NoteIdx)] = note.NoteContent;
            }
            foreach (var row in perek)
            {
                row.Body = SearchText.PlainText(
                    bodies.GetValueOrDefault((row.PasukNum, row.PerushId, row.NoteIdx), ""));
            }
        }
    }

    private async Task InitializeIndexAsync()
    {
        DeleteObsoleteCaches();
        var legacyTables = await _index.ExecuteScalarAsync<int>(
            "SELECT COUNT(*) FROM sqlite_schema WHERE name IN ('verses_content','notes_content')");
        if (legacyTables > 0)
        {
            // Defensive SQLite can also forbid dropping the old _content table.
            // Replace this derived cache before any import/query can use it.
            await _index.CloseAsync();
            File.Delete(_indexPath);
            _index = new SQLiteAsyncConnection(_indexPath);
        }
        await OpenIndexAsync();
    }

    private async Task OpenIndexAsync()
    {
        await _index.ExecuteScalarAsync<string>("PRAGMA journal_mode=WAL");
        await _index.ExecuteAsync("PRAGMA synchronous=NORMAL");
        await _index.ExecuteAsync("CREATE TABLE IF NOT EXISTS search_metadata (name TEXT PRIMARY KEY, fingerprint TEXT)");
    }

    /// <summary>
    /// Removes the superseded v1 cache file and any interrupted atomic-replace
    /// leftovers next to the working index.
    /// </summary>
    private void DeleteObsoleteCaches()
    {
        try
        {
            // _indexPath always carries a directory — Path.Join(CacheDirectory, ...)
            // in production, a full temp path in tests.
            var directory = Path.GetDirectoryName(_indexPath)!;
            // The superseded v1 cache lives next to the working index — the same
            // directory on device, and nothing to do in test directories.
            var legacy = Path.Join(directory, "hebrew-search-v1.sqlite");
            foreach (var path in new[] { legacy, legacy + "-wal", legacy + "-shm" }.Where(File.Exists))
            {
                File.Delete(path);
            }
            foreach (var file in Directory.GetFiles(directory, Path.GetFileName(_indexPath) + ".*.tmp"))
            {
                File.Delete(file);
            }
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            Console.Error.WriteLine($"Failed to sweep obsolete search-index files: {ex.Message}");
        }
    }

    private async Task EnsureIndexAsync(string table)
    {
        await _initialization;
        string? stagedIndex = null;
        var notesSettled = true;
        if (table == "verses" && _notes != null)
        {
            // The delivered DB includes both indexes. Adopt before building
            // verses, preserving the notes -> verses lock order used below.
            // A staged file whose notes fingerprint mismatches (or that is left
            // behind while notes are unavailable) can still supply the verses
            // table — the fingerprints are generated independently.
            if (_notes.IsAvailable)
            {
                await _gates["notes"].WaitAsync();
                try
                {
                    var source = await _notes.GetSearchConnectionAsync();
                    if (source != null)
                    {
                        stagedIndex = await TryAdoptDeliveredIndexAsync(source);
                    }
                    stagedIndex ??= _notes.PeekDeliveredIndexPath();
                }
                finally { _gates["notes"].Release(); }
            }
            else
            {
                // No notes gate: pack initialization can block on delivery, and
                // a plain file probe keeps verse search usable meanwhile.
                stagedIndex = _notes.PeekDeliveredIndexPath();
                notesSettled = false;
            }
        }
        await _gates[table].WaitAsync();
        try
        {
            await _perakim.LoadAsync();
            if (table == "verses")
            {
                var source = await _perakim.GetSearchConnectionAsync();
                if (stagedIndex != null)
                {
                    await TryAdoptDeliveredVersesAsync(stagedIndex, source);
                    // The staged file is spent once both halves are settled —
                    // never leave ~300 MB behind. While notes are still
                    // undetermined its notes half may yet be adopted, so the
                    // notes path removes it instead.
                    if (notesSettled)
                    {
                        DeleteStagedIndexFile(stagedIndex);
                    }
                    else
                    {
                        ParkStagedIndex(stagedIndex);
                    }
                }
                await BuildVerseIndexAsync(source);
            }
            else if (_notes != null)
            {
                var connection = await _notes.GetSearchConnectionAsync();
                CommentaryAvailable = false;
                string? leftover;
                if (connection != null)
                {
                    leftover = await TryAdoptDeliveredIndexAsync(connection);
                    var expected = await FingerprintAsync(connection, "build_timestamp");
                    CommentaryAvailable = await _index.ExecuteScalarAsync<string>(
                        "SELECT fingerprint FROM search_metadata WHERE name = 'notes'") == expected;
                    if (CommentaryAvailable)
                    {
                        _ready["notes"] = expected;
                        // TryAdoptDeliveredIndexAsync already sniffed the layout
                        // on its paths; a surviving fat working index without a
                        // staged file reaches this fallback.
                        _notesDocumentsCarryText ??= await NotesDocumentsCarryTextAsync(_index);
                    }
                    else { await ClearTableAsync("notes"); }
                }
                else
                {
                    // The notes pack was rejected or never arrived — drop the
                    // stale table so the obsolete index does not linger. The
                    // staged index file can outlive its pack (rejection races,
                    // partial cleanup) — its verses half may still adopt.
                    await ClearTableAsync("notes");
                    leftover = _notes.PeekDeliveredIndexPath();
                }
                if (leftover != null)
                {
                    // A staged file the notes generation cannot adopt can
                    // still carry the matching verses table — adopt it
                    // before the file is removed. The notes gate is already
                    // held; taking the verses gate keeps the documented
                    // notes -> verses order.
                    await _gates["verses"].WaitAsync();
                    try
                    {
                        await TryAdoptDeliveredVersesAsync(leftover,
                            await _perakim.GetSearchConnectionAsync());
                    }
                    finally { _gates["verses"].Release(); }
                    DeleteStagedIndexFile(leftover);
                }
            }
        }
        finally { _gates[table].Release(); }
    }

    /// <summary>
    /// Stable identity of the indexed content: the generation marker stored in
    /// the content DB's `_metadata` (build_timestamp for notes, generated_at
    /// for tanah_view) folded into `v4:{id}:n{norm}`. Falls back to file stats
    /// only for sources without metadata — file times are never a validity
    /// signal on their own.
    /// </summary>
    private static async Task<string> FingerprintAsync(SQLiteAsyncConnection source, string contentKey)
    {
        string? id = null;
        try
        {
            id = await source.ExecuteScalarAsync<string>("SELECT value FROM _metadata WHERE key = ?", contentKey);
        }
        catch (SQLiteException)
        {
            // The content DB may not carry _metadata.
        }
        if (string.IsNullOrEmpty(id))
        {
            var file = new FileInfo(source.DatabasePath);
            id = $"{file.Length}:{file.LastWriteTimeUtc.Ticks}";
        }
        return $"v4:{id}:n{SearchText.NormalizationVersion}";
    }

    /// <summary>
    /// Adopts the prebuilt index staged with the notes pack when its stored
    /// fingerprint matches the installed notes generation — replacing the
    /// working index by atomic rename instead of re-importing ~363K notes.
    /// Returns the staged path when the file was left behind (already-current
    /// or mismatched notes index) so the caller can still mine its verses
    /// table before removal; null when nothing is staged or the file moved.
    /// </summary>
    private async Task<string?> TryAdoptDeliveredIndexAsync(SQLiteAsyncConnection notesConnection)
    {
        var expected = await FingerprintAsync(notesConnection, "build_timestamp");
        var stored = await _index.ExecuteScalarAsync<string>(
            "SELECT fingerprint FROM search_metadata WHERE name = 'notes'");
        if (stored == expected && !(await NotesDocumentsCarryTextAsync(_index)))
        {
            _ready["notes"] = expected;
            _notesDocumentsCarryText = false;
            // Working index already matches — the staged copy can only still
            // serve the independently fingerprinted verses table.
            return _notes!.PeekDeliveredIndexPath();
        }
        // Peek before restoring: when the staged copy is gone and the pack
        // would deliver the exact payload already rejected as the same fat
        // layout, restoring it would re-copy ~300 MB on every index cycle
        // for no possible gain. The marker check needs the working index to
        // be current — a cleared one must still adopt the delivery.
        var deliveredPath = _notes!.PeekDeliveredIndexPath();
        if (deliveredPath == null)
        {
            if (stored == expected && await IsRejectedDeliveryAsync(expected))
            {
                _ready["notes"] = expected;
                _notesDocumentsCarryText = true;
                return null;
            }
            deliveredPath = await _notes.RestoreDeliveredIndexPathAsync();
        }
        if (deliveredPath == null || string.Equals(deliveredPath, _indexPath, StringComparison.Ordinal))
        {
            return null;
        }
        // Read the staged file's fingerprint and layout without disturbing _index.
        string? deliveredFp = null;
        var deliveredCarriesText = false;
        SQLiteAsyncConnection? delivered = null;
        try
        {
            delivered = new SQLiteAsyncConnection(deliveredPath, SQLiteOpenFlags.ReadOnly);
            deliveredFp = await delivered.ExecuteScalarAsync<string>(
                "SELECT fingerprint FROM search_metadata WHERE name = 'notes'");
            deliveredCarriesText = await NotesDocumentsCarryTextAsync(delivered);
        }
        catch (SQLiteException)
        {
            // Unusable delivery cannot trigger a full-corpus import on the device.
        }
        finally
        {
            if (delivered != null)
            {
                await delivered.CloseAsync();
            }
        }
        if (deliveredFp != expected)
        {
            // Index generated for another notes generation — never adoptable
            // as a whole, but its verses table can still match this device.
            return deliveredPath;
        }
        if (stored == expected && deliveredCarriesText)
        {
            // The working index is already current and the staged file is the
            // same fat layout — a swap would not free the duplicated text.
            // Record the rejection so this exact payload is never copied
            // again once the caller deletes the staged copy.
            RememberRejectedDelivery(expected, new FileInfo(deliveredPath).Length);
            _ready["notes"] = expected;
            _notesDocumentsCarryText = true;
            return deliveredPath;
        }

        // Swap under both gates: a concurrent verses build/query may hold _index.
        await _gates["verses"].WaitAsync();
        try
        {
            await _index.CloseAsync();
            // Move through a cache-local temporary destination. This is an
            // atomic rename on the same filesystem, with no full-index copy.
            AtomicFile.Move(deliveredPath, _indexPath);
            _index = new SQLiteAsyncConnection(_indexPath);
            _ready.Clear();
            _notesDocumentsCarryText = deliveredCarriesText;
            if (deliveredCarriesText)
            {
                // The pack still holds this exact fat payload — never stage it again.
                RememberRejectedDelivery(expected, new FileInfo(_indexPath).Length);
            }
            else
            {
                ForgetRejectedDelivery();
            }
            await OpenIndexAsync();
        }
        finally
        {
            _gates["verses"].Release();
        }
        return null;
    }

    /// <summary>
    /// Whether `notes_documents` still stores the note text — the pre-#3309
    /// layout. A working index that does gets replaced by a matching slim
    /// staged file even when the generation fingerprint already agrees.
    /// </summary>
    private static async Task<bool> NotesDocumentsCarryTextAsync(SQLiteAsyncConnection db)
    {
        var columns = await db.QueryAsync<PragmaColumn>(
            "SELECT name FROM pragma_table_info('notes_documents')");
        return columns.Any(column => column.Name == "Text");
    }

    /// <summary>
    /// Marker for a delivered index already evaluated as the same fat layout
    /// as the working index. Fingerprint plus byte size identify the payload,
    /// so an identical redelivery is never restored again while a changed one
    /// — e.g. the slim index for the same notes generation — still is.
    /// shortcut: a different payload with the same byte size is not
    /// re-evaluated — practically impossible for the ~4x fat-vs-slim delta;
    /// widen the marker if payloads can ever change at equal size.
    /// </summary>
    private string RejectedDeliveryMarkerPath => _indexPath + ".delivered-fat";

    private async Task<bool> IsRejectedDeliveryAsync(string expectedFingerprint)
    {
        string? marker = null;
        try
        {
            marker = await File.ReadAllTextAsync(RejectedDeliveryMarkerPath);
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            return false;
        }
        var parts = marker.Trim().Split('|');
        if (parts.Length != 2 || parts[0] != expectedFingerprint || !long.TryParse(parts[1], out var size))
        {
            return false;
        }
        return await _notes!.PeekDeliveredIndexSizeAsync() == size;
    }

    private void RememberRejectedDelivery(string fingerprint, long size)
    {
        try
        {
            File.WriteAllText(RejectedDeliveryMarkerPath, $"{fingerprint}|{size}");
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            Console.Error.WriteLine($"Failed to record the rejected delivered search index: {ex.Message}");
        }
    }

    private void ForgetRejectedDelivery()
    {
        try
        {
            File.Delete(RejectedDeliveryMarkerPath);
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
        }
    }

    /// <summary>
    /// Adopts only the verses tables out of the staged delivered index when its
    /// 'verses' fingerprint matches the installed tanah generation — the
    /// fallback when the notes fingerprint mismatched or no notes pack is
    /// usable. All writes land in one transaction under the verses gate; any
    /// absence, mismatch or unreadable file falls back to the regular build.
    /// </summary>
    private async Task TryAdoptDeliveredVersesAsync(string stagedPath, SQLiteAsyncConnection source)
    {
        const string table = "verses";
        try
        {
            var fingerprint = await FingerprintAsync(source, "generated_at");
            if (_ready.GetValueOrDefault(table) == fingerprint)
            {
                return;
            }
            var stored = await _index.ExecuteScalarAsync<string>(
                "SELECT fingerprint FROM search_metadata WHERE name = ?", table);
            if (stored == fingerprint)
            {
                _ready[table] = fingerprint;
                return;
            }
            if (string.Equals(stagedPath, _indexPath, StringComparison.Ordinal))
            {
                return;
            }
            var timer = Stopwatch.StartNew();
            await _index.ExecuteAsync("ATTACH DATABASE ? AS staged", stagedPath);
            try
            {
                var stagedFingerprint = await _index.ExecuteScalarAsync<string>(
                    $"SELECT fingerprint FROM staged.search_metadata WHERE name = '{table}'");
                if (stagedFingerprint != fingerprint)
                {
                    return;
                }
                // Documents hold the plain text; the FTS rows index its
                // normalized form, so adopted rows are indistinguishable from a
                // fresh build. A 'rebuild' would wrongly index the voweled text.
                var docs = await _index.QueryAsync<DocumentRow>(
                    $"SELECT rowid AS RowId, Text FROM staged.{table}_documents ORDER BY rowid");
                var tokens = await Task.Run(() => NormalizeTokens(docs));
                await RunImportTransactionAsync(connection =>
                {
                    ResetIndexTable(connection, table);
                    connection.Execute(
                        $"INSERT INTO main.{table}_documents (rowid, Text, PerekId, PasukNum, PerushId, SeferId) " +
                        $"SELECT rowid, Text, PerekId, PasukNum, PerushId, SeferId FROM staged.{table}_documents");
                    for (var i = 0; i < docs.Count; i++)
                    {
                        connection.Insert(new VerseTokenEntry { RowId = docs[i].RowId, Text = tokens[i] });
                    }
                    PublishIndexTable(connection, table, fingerprint);
                });
                _ready[table] = fingerprint;
                Console.WriteLine($"Search index '{table}' adopted in {timer.Elapsed.TotalSeconds:F1}s.");
            }
            finally
            {
                await _index.ExecuteAsync("DETACH DATABASE staged");
            }
        }
        catch (Exception ex) when (ex is SQLiteException or IOException or UnauthorizedAccessException)
        {
            // A missing, unreadable or corrupt staged file simply means the
            // regular build path runs instead.
            Console.Error.WriteLine($"Staged verses index not adoptable: {ex.Message}");
        }
    }

    /// <summary>
    /// Settles a staged index parked while notes were undetermined each time a
    /// notes operation ends, so it never waits for a later search. Never starts
    /// notes delivery itself; DisposeAsync drains it with the builds.
    /// </summary>
    private void OnNotesOperationCompleted()
    {
        lock (_buildSync)
        {
            var stagedPath = Interlocked.Exchange(ref _stagedAwaitingNotes, null);
            if (stagedPath != null && !_disposed)
            {
                _buildTasks["staged"] = Task.Run(() => SettleStagedIndexAsync(stagedPath));
            }
        }
    }

    /// <summary>
    /// Deletes the staged file if notes are settled unavailable, else parks it
    /// for the next notes operation end — even while notes are available, so a
    /// later removal still settles it. Parked before the probe so an operation
    /// ending in between still settles it.
    /// </summary>
    private void ParkStagedIndex(string stagedPath)
    {
        Interlocked.Exchange(ref _stagedAwaitingNotes, stagedPath);
        if (_notes!.RunIfSettledUnavailable(() => DeleteStagedIndexFile(stagedPath)))
        {
            Interlocked.CompareExchange(ref _stagedAwaitingNotes, null, stagedPath);
        }
    }

    private async Task SettleStagedIndexAsync(string stagedPath)
    {
        // notes -> verses order: neither path may be reading the file meanwhile.
        await _gates["notes"].WaitAsync();
        try
        {
            await _gates["verses"].WaitAsync();
            // Another operation may hold the pack again; its end retries.
            try { ParkStagedIndex(stagedPath); }
            finally { _gates["verses"].Release(); }
        }
        finally { _gates["notes"].Release(); }
    }

    /// <summary>
    /// Removes the staged delivered index once it can serve no purpose: either
    /// its usable tables were adopted, or it was built for a different content
    /// generation and would sit unadopted forever (~300 MB of dead data).
    /// </summary>
    private void DeleteStagedIndexFile(string stagedPath)
    {
        try
        {
            if (!string.Equals(stagedPath, _indexPath, StringComparison.Ordinal))
            {
                // A staged copy can be a WAL-mode file: ATTACHing it for reads
                // leaves -wal/-shm sidecars that would otherwise linger.
                File.Delete(stagedPath);
                File.Delete(stagedPath + "-wal");
                File.Delete(stagedPath + "-shm");
            }
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            Console.Error.WriteLine($"Failed to delete unadoptable staged search index: {ex.Message}");
        }
    }

    /// <summary>Drops an index table whose content source is gone.</summary>
    private async Task ClearTableAsync(string table)
    {
        _ready.TryRemove(table, out _);
        if (table == "notes")
        {
            _notesDocumentsCarryText = null;
        }
        var stored = await _index.ExecuteScalarAsync<string>(
            "SELECT fingerprint FROM search_metadata WHERE name = ?", table);
        if (stored == null)
        {
            return;
        }
        await _index.ExecuteAsync("DELETE FROM main.search_metadata WHERE name = ?", table);
        await _index.ExecuteAsync($"DROP TABLE IF EXISTS main.{table}_vocab");
        await _index.ExecuteAsync($"DROP TABLE IF EXISTS main.{table}");
        await _index.ExecuteAsync($"DROP TABLE IF EXISTS main.{table}_content");
        await _index.ExecuteAsync($"DROP TABLE IF EXISTS main.{table}_documents");
    }

    private async Task BuildVerseIndexAsync(SQLiteAsyncConnection source)
    {
        const string table = "verses";
        var fingerprint = await FingerprintAsync(source, "generated_at");
        if (_ready.GetValueOrDefault(table) == fingerprint)
        {
            return;
        }
        var stored = await _index.ExecuteScalarAsync<string>("SELECT fingerprint FROM search_metadata WHERE name = ?", table);
        if (stored != fingerprint)
        {
            var timer = Stopwatch.StartNew();
            var verses = await source.QueryAsync<IndexRow>("SELECT perek_id AS PerekId, pasuk_id AS PasukNum, " +
                "group_concat(value, ' ') AS Body FROM (SELECT s.perek_id, s.pasuk_id, v.value " +
                "FROM tanah_pasuk_segment s JOIN tanah_pasuk_segment_value v ON v.id = s.id " +
                "WHERE s.segment_type IN ('qri','ktiv') ORDER BY s.perek_id, s.pasuk_id, s.id) GROUP BY perek_id, pasuk_id");
            // PlainText + Normalize are pure per-row transforms — spread them
            // over every core while the INSERTs stay serialized on the single
            // sqlite-net write connection. Row order is preserved, so the
            // parallelized index is identical to a serial build.
            var prepared = await Task.Run(() => PrepareVersesForImport(verses,
                perekId => _perakim.GetPerek(perekId)?.SeferId));
            await RunImportTransactionAsync(connection =>
            {
                ResetIndexTable(connection, table);
                foreach (var verse in prepared)
                {
                    if (verse is not { } row)
                    {
                        continue;
                    }
                    var entry = new VerseIndexEntry
                    {
                        Text = row.Text,
                        PerekId = row.PerekId,
                        PasukNum = row.PasukNum,
                        PerushId = row.PerushId,
                        SeferId = row.SeferId,
                    };
                    // Insert caches a prepared statement for each mapped table.
                    // Execute would prepare the same SQL again for every verse.
                    connection.Insert(entry);
                    connection.Insert(new VerseTokenEntry { RowId = entry.RowId, Text = row.Tokens });
                }
                PublishIndexTable(connection, table, fingerprint);
            });
            Console.WriteLine($"Search index '{table}' complete in {timer.Elapsed.TotalSeconds:F1}s.");
        }
        _ready[table] = fingerprint;
    }

    /// <summary>
    /// Runs a whole table import in one transaction. The delivered-index
    /// pipeline builds this same file with synchronous=OFF and
    /// temp_store=MEMORY; mirror those for the import window only — the
    /// journal stays WAL and NORMAL durability is restored afterwards. The
    /// interrupted-build contract (fingerprint publishes last) already covers
    /// a lost commit. locking_mode=EXCLUSIVE is deliberately not mirrored:
    /// searches share this database through the connection pool, and the
    /// pipeline's 1M-page cache_size is a batch-build setting a device does
    /// not need for ~23K rows.
    /// </summary>
    private async Task RunImportTransactionAsync(Action<SQLiteConnection> import)
    {
        await _index.ExecuteAsync("PRAGMA synchronous=OFF");
        await _index.ExecuteAsync("PRAGMA temp_store=MEMORY");
        try
        {
            await _index.RunInTransactionAsync(import);
        }
        finally
        {
            await _index.ExecuteAsync("PRAGMA temp_store=DEFAULT");
            await _index.ExecuteAsync("PRAGMA synchronous=NORMAL");
        }
    }

    /// <summary>
    /// Precomputes each verse's plain text, normalized tokens and sefer in
    /// parallel — the transforms are pure and the pre-sized array keeps row
    /// order identical to a serial pass for the single-connection inserts.
    /// </summary>
    internal static PreparedVerse?[] PrepareVersesForImport(IReadOnlyList<IndexRow> rows, Func<int, int?> seferOf)
    {
        var prepared = new PreparedVerse?[rows.Count];
        Parallel.For(0, rows.Count, i =>
        {
            var row = rows[i];
            if (seferOf(row.PerekId) is not { } seferId)
            {
                return;
            }
            var text = SearchText.PlainText(row.Body);
            prepared[i] = new PreparedVerse(text, SearchText.Normalize(text),
                row.PerekId, row.PasukNum, row.PerushId, seferId);
        });
        return prepared;
    }

    /// <summary>Normalizes copied document text across cores, preserving row order.</summary>
    private static string[] NormalizeTokens(IReadOnlyList<DocumentRow> docs)
    {
        var tokens = new string[docs.Count];
        Parallel.For(0, docs.Count, i => tokens[i] = SearchText.Normalize(docs[i].Text));
        return tokens;
    }

    /// <summary>
    /// Drops and recreates the FTS + document pair for a table inside the
    /// import transaction. Keep one original text copy: an external-content
    /// FTS table stores only tokens and positions instead of duplicating every
    /// note. _content is a reserved FTS shadow-table name — Apple's defensive
    /// SQLite mode rejects writes to it even with external content.
    /// Every statement is qualified with `main.`: while a delivered index is
    /// ATTACHed, SQLite resolves an unqualified name across all schemas and
    /// would drop the staged table when main has none.
    /// </summary>
    private static void ResetIndexTable(SQLiteConnection connection, string table)
    {
        connection.Execute("DELETE FROM main.search_metadata WHERE name = ?", table);
        connection.Execute($"DROP TABLE IF EXISTS main.{table}_vocab");
        connection.Execute($"DROP TABLE IF EXISTS main.{table}");
        connection.Execute($"DROP TABLE IF EXISTS main.{table}_content");
        connection.Execute($"DROP TABLE IF EXISTS main.{table}_documents");
        connection.Execute($"CREATE TABLE main.{table}_documents (rowid INTEGER PRIMARY KEY, Text TEXT, " +
            "PerekId INTEGER, PasukNum INTEGER, PerushId INTEGER, SeferId INTEGER)");
        connection.Execute($"CREATE VIRTUAL TABLE main.{table} USING fts5(Text, content='{table}_documents', content_rowid='rowid')");
    }

    /// <summary>
    /// Vocabulary, FTS merge and fingerprint — published only after a complete
    /// import; an interrupted build is rebuilt on next launch. `main.` keeps
    /// the publish targeting the working index while a delivered copy is
    /// attached.
    /// </summary>
    private static void PublishIndexTable(SQLiteConnection connection, string table, string fingerprint)
    {
        connection.Execute($"CREATE VIRTUAL TABLE main.{table}_vocab USING fts5vocab({table}, 'row')");
        connection.Execute($"INSERT INTO main.{table}({table}) VALUES ('optimize')");
        connection.Execute("INSERT OR REPLACE INTO main.search_metadata VALUES (?, ?)", table, fingerprint);
    }

    public async ValueTask DisposeAsync()
    {
        Task[] builds;
        if (_notes != null)
        {
            _notes.OperationCompleted -= OnNotesOperationCompleted;
        }
        lock (_buildSync)
        {
            _disposed = true;
            builds = _buildTasks.Values.Append(_initialization).ToArray();
        }
        try { await Task.WhenAll(builds); }
        finally
        {
            foreach (var gate in _gates.Values)
            {
                await gate.WaitAsync();
            }
            try { await _index.CloseAsync(); }
            finally { DisposeGates(); }
        }
    }

    private void DisposeGates()
    {
        foreach (var gate in _gates.Values)
        {
            gate.Dispose();
        }
    }

    private class StoredIndexEntry
    {
        [PrimaryKey, AutoIncrement, Column("rowid")]
        public long RowId { get; set; }
        public string Text { get; set; } = string.Empty;
        public int PerekId { get; set; }
        public int PasukNum { get; set; }
        public int PerushId { get; set; }
        public int SeferId { get; set; }
    }

    [Table("verses_documents")]
    private sealed class VerseIndexEntry : StoredIndexEntry;

    private class TokenIndexEntry
    {
        [Column("rowid")]
        public long RowId { get; set; }
        public string Text { get; set; } = string.Empty;
    }

    [Table("verses")]
    private sealed class VerseTokenEntry : TokenIndexEntry;

    /// <summary>One verse's precomputed index payload: document text plus the
    /// normalized token string the FTS table indexes.</summary>
    internal readonly record struct PreparedVerse(string Text, string Tokens,
        int PerekId, int PasukNum, int PerushId, int SeferId);

    internal sealed class IndexRow
    {
        public long RowId { get; set; }
        public int PerekId { get; set; }
        public int PasukNum { get; set; }
        public int PerushId { get; set; }
        public int NoteIdx { get; set; }
        public string Body { get; set; } = string.Empty;
    }

    private sealed class DocumentRow
    {
        public long RowId { get; set; }
        public string Text { get; set; } = string.Empty;
    }

    private sealed class PragmaColumn
    {
        public string Name { get; set; } = string.Empty;
    }

    private sealed class VocabularyRow
    {
        [Column("term")]
        public string Term { get; set; } = string.Empty;
    }
}

public sealed record SearchHit(SearchFilter Type, int PerekId, int PasukNum, int PerushId, string Text, int Score);
