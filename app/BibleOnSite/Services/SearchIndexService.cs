using BibleOnSite.Helpers;
using BibleOnSite.Models;
using SQLite;
using System.Collections.Concurrent;
using System.Diagnostics;

namespace BibleOnSite.Services;

/// <summary>Disposable derived FTS5 indexes; the installed content databases remain read-only.</summary>
public sealed class SearchIndexService : IAsyncDisposable
{
    private const int ImportBatchSize = 4096;
    private readonly PerekDataService _perakim;
    private readonly PerushimNotesService? _notes;
    private readonly SQLiteAsyncConnection _index;
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

    private static readonly Lazy<SearchIndexService> _instance = new(() => new(PerekDataService.Instance,
        PerushimNotesService.Instance, Path.Combine(FileSystem.Current.CacheDirectory, "hebrew-search-v1.sqlite")));
    public static SearchIndexService Instance => _instance.Value;

    public SearchIndexService(PerekDataService perakim, PerushimNotesService? notes, string indexPath)
    {
        _perakim = perakim;
        _notes = notes;
        _index = new SQLiteAsyncConnection(indexPath);
        _initialization = InitializeIndexAsync();
    }

    public bool CommentaryAvailable { get; private set; }

    // The mobile-e2e harness launches the app with this marker so the index
    // builds while earlier scenarios still run, instead of the first perush
    // search paying the multi-minute commentary import inside its own window.
    // Production launches never set it and keep the lazy path.
    internal const string E2eEnvironmentVariable = "BIBLE_E2E";

    public static void WarmupForE2e()
    {
        if (Environment.GetEnvironmentVariable(E2eEnvironmentVariable) != "1")
        {
            return;
        }
        _ = WarmupIndexesAsync();
    }

    private static async Task WarmupIndexesAsync()
    {
        try
        {
            var service = Instance;
            await Task.WhenAll(service.WarmTableAsync("verses"), service.WarmTableAsync("notes"));
        }
        catch (Exception exception)
        {
            Console.WriteLine($"E2E search-index warmup failed: {exception}");
        }
    }

    // Shares the search path's dedup so a warmup build is also the build a
    // concurrent search awaits, and DisposeAsync can drain it.
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

    public async Task<List<SearchHit>> SearchAsync(string query, IReadOnlySet<SearchFilter> filters,
        IReadOnlySet<int> books, int limit, CancellationToken cancellationToken, IProgress<string>? progress, SearchOrdering ordering)
    {
        var terms = SearchText.Tokens(query);
        if (terms.Length is 0 or > 16 || terms.Any(term => term.Length > 64) || books.Count == 0)
        {
            return [];
        }
        limit = Math.Clamp(limit, 1, 50);
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
                    _buildTasks[table] = build = EnsureIndexAsync(table);
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
                // Expand only if exact/prefix matches have not filled the user's result limit.
                if (rows.Count < limit)
                {
                    var clauses = new List<string>();
                    foreach (var term in terms)
                    {
                        cancellationToken.ThrowIfCancellationRequested();
                        var edits = SearchText.MaxEdits(term);
                        var alternatives = edits == 0 ? [] : await _index.QueryAsync<VocabularyRow>(
                            $"SELECT term FROM {table}_vocab WHERE length(term) BETWEEN ? AND ?",
                            term.Length - edits, term.Length + edits);
                        var similar = await Task.Run(() => alternatives.Select(row => (row.Term, Distance: SearchText.Distance(row.Term, term, edits)))
                            .Where(row => row.Distance <= edits).OrderBy(row => row.Distance).ThenBy(row => row.Term, StringComparer.Ordinal)
                            .Take(24).Select(row => $"\"{row.Term}\"").ToArray(), cancellationToken);
                        clauses.Add("(" + string.Join(" OR ", similar.Prepend($"\"{term}\"*")) + ")");
                    }
                    var fuzzy = await QueryAsync(table, string.Join(" AND ", clauses), books, limit, ordering);
                    rows = rows.Concat(fuzzy).DistinctBy(row => row.RowId).ToList();
                }
                hits.AddRange(rows.Select(row => new SearchHit(type, row.PerekId, row.PasukNum,
                    row.PerushId, row.Body, SearchText.Score(row.Body, query))));
            }
            finally { _gates[table].Release(); }
        }
        cancellationToken.ThrowIfCancellationRequested();
        return (ordering.Sort == SearchSort.Generation
            ? hits.OrderBy(hit => ordering.YearFor(hit.PerushId)).ThenBy(hit => hit.PerekId).ThenBy(hit => hit.PasukNum)
            : hits.OrderByDescending(hit => hit.Score)).Take(limit).ToList();
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
        return _index.QueryAsync<IndexRow>($"SELECT {table}.rowid AS RowId, c.PerekId, c.PasukNum, c.PerushId, c.Text AS Body FROM {table} " +
            $"JOIN {table}_documents c ON c.rowid = {table}.rowid WHERE {table} MATCH ? AND c.SeferId IN ({placeholders}) " +
            $"ORDER BY {orderSql} LIMIT ?", arguments.ToArray());
    }

    private async Task InitializeIndexAsync()
    {
        var legacyTables = await _index.ExecuteScalarAsync<int>(
            "SELECT COUNT(*) FROM sqlite_schema WHERE name IN ('verses_content','notes_content')");
        if (legacyTables > 0)
        {
            // Defensive SQLite can also forbid dropping the old _content table.
            // Replace this derived cache before any import/query can use it.
            var path = _index.DatabasePath;
            await _index.CloseAsync();
            File.Delete(path);
        }
        await _index.ExecuteScalarAsync<string>("PRAGMA journal_mode=WAL");
        await _index.ExecuteAsync("PRAGMA synchronous=NORMAL");
        await _index.ExecuteAsync("CREATE TABLE IF NOT EXISTS search_metadata (name TEXT PRIMARY KEY, fingerprint TEXT)");
    }

    private async Task EnsureIndexAsync(string table)
    {
        await _initialization;
        await _gates[table].WaitAsync();
        try
        {
            await _perakim.LoadAsync();
            if (table == "verses")
            {
                await BuildAsync(table, await _perakim.GetSearchConnectionAsync(), false);
            }
            else if (_notes != null)
            {
                var connection = await _notes.GetSearchConnectionAsync();
                CommentaryAvailable = connection != null;
                if (connection != null)
                {
                    await BuildAsync("notes", connection, true);
                }
                else
                {
                    _ready.TryRemove("notes", out _);
                }
            }
        }
        finally { _gates[table].Release(); }
    }

    private async Task BuildAsync(string table, SQLiteAsyncConnection source, bool commentary)
    {
        var file = new FileInfo(source.DatabasePath);
        var fingerprint = $"v3:{file.Length}:{file.LastWriteTimeUtc.Ticks}";
        if (_ready.GetValueOrDefault(table) == fingerprint)
        {
            return;
        }
        var stored = await _index.ExecuteScalarAsync<string>("SELECT fingerprint FROM search_metadata WHERE name = ?", table);
        if (stored != fingerprint)
        {
            var timer = Stopwatch.StartNew();
            await _index.ExecuteAsync("DELETE FROM search_metadata WHERE name = ?", table);
            await _index.ExecuteAsync($"DROP TABLE IF EXISTS {table}_vocab");
            await _index.ExecuteAsync($"DROP TABLE IF EXISTS {table}");
            await _index.ExecuteAsync($"DROP TABLE IF EXISTS {table}_content");
            await _index.ExecuteAsync($"DROP TABLE IF EXISTS {table}_documents");
            // Keep one original text copy. An external-content FTS table stores
            // only tokens and positions instead of duplicating every note.
            // _content is a reserved FTS shadow-table name. Apple's defensive
            // SQLite mode rejects writes to it even with external content.
            await _index.ExecuteAsync($"CREATE TABLE {table}_documents (rowid INTEGER PRIMARY KEY, Text TEXT, " +
                "PerekId INTEGER, PasukNum INTEGER, PerushId INTEGER, SeferId INTEGER)");
            await _index.ExecuteAsync($"CREATE VIRTUAL TABLE {table} USING fts5(Text, content='{table}_documents', content_rowid='rowid')");
            if (commentary)
            {
                long lastId = 0;
                var imported = 0;
                while (true)
                {
                    // Keyset pagination bounds memory even for the full commentary asset pack.
                    var batch = await source.QueryAsync<IndexRow>("SELECT rowid AS RowId, perek_id AS PerekId, " +
                        $"pasuk AS PasukNum, perush_id AS PerushId, note_content AS Body FROM note WHERE rowid > ? ORDER BY rowid LIMIT {ImportBatchSize}", lastId);
                    if (batch.Count == 0)
                    {
                        break;
                    }
                    await InsertAsync(table, batch);
                    lastId = batch[^1].RowId;
                    imported += batch.Count;
                    if (imported % (ImportBatchSize * 8) == 0)
                    {
                        Console.WriteLine($"Search index '{table}': {imported} documents in {timer.Elapsed.TotalSeconds:F1}s.");
                    }
                }
            }
            else
            {
                var verses = await source.QueryAsync<IndexRow>("SELECT perek_id AS PerekId, pasuk_id AS PasukNum, " +
                    "group_concat(value, ' ') AS Body FROM (SELECT s.perek_id, s.pasuk_id, v.value " +
                    "FROM tanah_pasuk_segment s JOIN tanah_pasuk_segment_value v ON v.id = s.id " +
                    "WHERE s.segment_type IN ('qri','ktiv') ORDER BY s.perek_id, s.pasuk_id, s.id) GROUP BY perek_id, pasuk_id");
                foreach (var batch in verses.Chunk(ImportBatchSize))
                {
                    await InsertAsync(table, batch);
                }
            }
            await _index.ExecuteAsync($"CREATE VIRTUAL TABLE {table}_vocab USING fts5vocab({table}, 'row')");
            await _index.ExecuteAsync($"INSERT INTO {table}({table}) VALUES ('optimize')");
            // Publish only a complete import; an interrupted build is rebuilt on next launch.
            await _index.ExecuteAsync("INSERT OR REPLACE INTO search_metadata VALUES (?, ?)", table, fingerprint);
            Console.WriteLine($"Search index '{table}' complete in {timer.Elapsed.TotalSeconds:F1}s.");
        }
        _ready[table] = fingerprint;
    }

    private Task InsertAsync(string table, IEnumerable<IndexRow> rows) => _index.RunInTransactionAsync(connection =>
    {
        foreach (var row in rows)
        {
            var perek = _perakim.GetPerek(row.PerekId);
            if (perek == null)
            {
                continue;
            }
            var body = SearchText.PlainText(row.Body);
            StoredIndexEntry entry = table == "notes" ? new CommentaryIndexEntry() : new VerseIndexEntry();
            entry.Text = body;
            entry.PerekId = row.PerekId;
            entry.PasukNum = row.PasukNum;
            entry.PerushId = row.PerushId;
            entry.SeferId = perek.SeferId;
            // Insert caches a prepared statement for each mapped table. Execute
            // would prepare the same SQL again for every commentary note.
            connection.Insert(entry);
            TokenIndexEntry tokens = table == "notes" ? new CommentaryTokenEntry() : new VerseTokenEntry();
            tokens.RowId = entry.RowId;
            tokens.Text = SearchText.Normalize(body);
            connection.Insert(tokens);
        }
    });

    public async ValueTask DisposeAsync()
    {
        Task[] builds;
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
            finally
            {
                foreach (var gate in _gates.Values)
                {
                    gate.Dispose();
                }
            }
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

    [Table("notes_documents")]
    private sealed class CommentaryIndexEntry : StoredIndexEntry;

    private class TokenIndexEntry
    {
        [Column("rowid")]
        public long RowId { get; set; }
        public string Text { get; set; } = string.Empty;
    }

    [Table("verses")]
    private sealed class VerseTokenEntry : TokenIndexEntry;

    [Table("notes")]
    private sealed class CommentaryTokenEntry : TokenIndexEntry;

    private sealed class IndexRow
    {
        public long RowId { get; set; }
        public int PerekId { get; set; }
        public int PasukNum { get; set; }
        public int PerushId { get; set; }
        public string Body { get; set; } = string.Empty;
    }

    private sealed class VocabularyRow
    {
        [Column("term")]
        public string Term { get; set; } = string.Empty;
    }
}

public sealed record SearchHit(SearchFilter Type, int PerekId, int PasukNum, int PerushId, string Text, int Score);
