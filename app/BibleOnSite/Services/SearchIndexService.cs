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
    private const int BlobImportBatchSize = 16;
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

    private static readonly Lazy<SearchIndexService> _instance = new(() => new(PerekDataService.Instance,
        PerushimNotesService.Instance, Path.Join(FileSystem.Current.CacheDirectory, "hebrew-search.sqlite")));
    public static SearchIndexService Instance => _instance.Value;

    public SearchIndexService(PerekDataService perakim, PerushimNotesService? notes, string indexPath)
    {
        _perakim = perakim;
        _notes = notes;
        _indexPath = indexPath;
        _index = new SQLiteAsyncConnection(indexPath);
        _initialization = InitializeIndexAsync();
    }

    public bool CommentaryAvailable { get; private set; }

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
            var directory = Path.GetDirectoryName(_indexPath) ?? ".";
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
                    await TryAdoptDeliveredIndexAsync(connection);
                    await BuildAsync("notes", connection, true);
                }
                else
                {
                    // The notes pack was rejected or never arrived — drop the
                    // stale table so the obsolete index does not linger.
                    await ClearTableAsync("notes");
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
    /// </summary>
    private async Task TryAdoptDeliveredIndexAsync(SQLiteAsyncConnection notesConnection)
    {
        var expected = await FingerprintAsync(notesConnection, "build_timestamp");
        var stored = await _index.ExecuteScalarAsync<string>(
            "SELECT fingerprint FROM search_metadata WHERE name = 'notes'");
        if (stored == expected)
        {
            _ready["notes"] = expected;
            // Working index already matches — the staged copy is dead weight.
            await DeleteStagedIndexAsync();
            return;
        }
        var deliveredPath = await _notes!.GetDeliveredIndexPathAsync();
        if (deliveredPath == null || string.Equals(deliveredPath, _indexPath, StringComparison.Ordinal))
        {
            return;
        }
        // Read the staged file's fingerprint without disturbing _index.
        string? deliveredFp = null;
        SQLiteAsyncConnection? delivered = null;
        try
        {
            delivered = new SQLiteAsyncConnection(deliveredPath, SQLiteOpenFlags.ReadOnly);
            deliveredFp = await delivered.ExecuteScalarAsync<string>(
                "SELECT fingerprint FROM search_metadata WHERE name = 'notes'");
        }
        catch (SQLiteException)
        {
            // Unusable delivered file — fall through to on-device build.
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
            // Index generated for another notes generation — it can never be
            // adopted, so the staged file must not linger (~300 MB of dead data).
            await DeleteStagedIndexAsync();
            return;
        }

        // Swap under both gates: a concurrent verses build/query may hold _index.
        await _gates["verses"].WaitAsync();
        try
        {
            await _index.CloseAsync();
            // Copy through a temp file — a plain rename is not guaranteed when
            // the staged index sits on a different volume than the cache.
            await using var staged = File.OpenRead(deliveredPath);
            await AtomicFile.CopyAsync(staged, _indexPath);
            _index = new SQLiteAsyncConnection(_indexPath);
            await OpenIndexAsync();
        }
        finally
        {
            _gates["verses"].Release();
        }
        await DeleteStagedIndexAsync();
    }

    /// <summary>
    /// Removes the staged delivered index once it can serve no purpose: either
    /// the working index already covers this content generation, or the staged
    /// file was built for a different one and would sit unadopted forever.
    /// </summary>
    private async Task DeleteStagedIndexAsync()
    {
        try
        {
            var path = await _notes!.GetDeliveredIndexPathAsync();
            if (path != null && !string.Equals(path, _indexPath, StringComparison.Ordinal))
            {
                File.Delete(path);
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
        var stored = await _index.ExecuteScalarAsync<string>(
            "SELECT fingerprint FROM search_metadata WHERE name = ?", table);
        if (stored == null)
        {
            return;
        }
        await _index.ExecuteAsync("DELETE FROM search_metadata WHERE name = ?", table);
        await _index.ExecuteAsync($"DROP TABLE IF EXISTS {table}_vocab");
        await _index.ExecuteAsync($"DROP TABLE IF EXISTS {table}");
        await _index.ExecuteAsync($"DROP TABLE IF EXISTS {table}_content");
        await _index.ExecuteAsync($"DROP TABLE IF EXISTS {table}_documents");
    }

    private async Task BuildAsync(string table, SQLiteAsyncConnection source, bool commentary)
    {
        var fingerprint = await FingerprintAsync(source, commentary ? "build_timestamp" : "generated_at");
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
                var imported = 0;
                var lastLogged = 0;
                var lastPerekId = 0;
                while (true)
                {
                    // Keyset pagination bounds memory even for the full commentary asset pack.
                    var blobs = await source.QueryAsync<BlobRow>("SELECT perek_id AS PerekId, data AS Data " +
                        $"FROM note_blob WHERE perek_id > ? ORDER BY perek_id LIMIT {BlobImportBatchSize}", lastPerekId);
                    if (blobs.Count == 0)
                    {
                        break;
                    }
                    lastPerekId = blobs[^1].PerekId;
                    var batch = new List<IndexRow>();
                    foreach (var blob in blobs)
                    {
                        foreach (var note in PerushNoteBlob.Decode(blob.Data))
                        {
                            batch.Add(new IndexRow
                            {
                                PerekId = blob.PerekId,
                                PasukNum = note.Pasuk,
                                PerushId = note.PerushId,
                                Body = note.Content
                            });
                        }
                    }
                    foreach (var chunk in batch.Chunk(ImportBatchSize))
                    {
                        await InsertAsync(table, chunk);
                    }
                    imported += batch.Count;
                    if (imported - lastLogged >= ImportBatchSize * 8)
                    {
                        lastLogged = imported;
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

    private sealed class BlobRow
    {
        public int PerekId { get; set; }
        public byte[] Data { get; set; } = [];
    }

    private sealed class VocabularyRow
    {
        [Column("term")]
        public string Term { get; set; } = string.Empty;
    }
}

public sealed record SearchHit(SearchFilter Type, int PerekId, int PasukNum, int PerushId, string Text, int Score);
