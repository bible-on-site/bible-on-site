using BibleOnSite.Helpers;
using BibleOnSite.Models;
using BibleOnSite.Services;
using BibleOnSite.Tests.Support;
using BibleOnSite.ViewModels;

namespace BibleOnSite.Tests.Services;

public class SearchIndexServiceTests
{
    private const string BibleDb = "sefaria-dump-5784-sivan-4.tanah_view.sqlite";
    private const string NotesDb = "sefaria-dump-5784-sivan-4.perushim_notes.sqlite";

    [Fact]
    public async Task DirectMatchesDoNotWaitForOrIncludeSpellingSuggestions()
    {
        await using var storage = new TestStorage();
        var perakim = await SeedAsync(storage);
        var source = await storage.CreateDatabaseAsync(BibleDb);
        await source.ExecuteAsync("INSERT INTO tanah_pasuk_segment VALUES (5,1,2,'qri')");
        await source.ExecuteAsync("INSERT INTO tanah_pasuk_segment_value VALUES (5,'בראשיט ברא אלהים')");
        await using var index = new SearchIndexService(perakim, null, Path.Join(storage.Root, "search.sqlite"));
        var filters = new HashSet<SearchFilter> { SearchFilter.Pasuk };
        var books = new HashSet<int> { 1 };

        var direct = await index.SearchAsync("בראשית", filters, books, 10, TestContext.Current.CancellationToken);
        direct.Should().ContainSingle().Which.PasukNum.Should().Be(1);
        var fallback = await index.SearchAsync("בראשיח", filters, books, 10, TestContext.Current.CancellationToken);
        fallback.Should().HaveCount(2, "a misspelled query still searches every matching spelling candidate");
    }

    [Fact]
    public async Task GenerationOrdering_AppliesBeforeLimit_AndKeepsUnknownDatesLast()
    {
        await using var storage = new TestStorage();
        var perakim = await SeedAsync(storage);
        await storage.CreateDatabaseAsync(NotesDb,
            NotesDbV2.Statements((7, 1, 1, 0, "בראשית"), (8, 1, 1, 0, "בראשית"), (9, 1, 1, 0, "בראשית")));
        var delivery = new Mock<IPadDeliveryService>();
        delivery.Setup(service => service.TryGetAssetPathAsync(It.IsAny<string>(), It.IsAny<CancellationToken>())).ReturnsAsync((string?)null);
        var notes = PerushimNotesService.CreateForTesting(delivery.Object, storage.Root);
        await using var index = await CreateFixtureIndexAsync(perakim, notes, storage);
        var ordering = new SearchOrdering(SearchSort.Generation, new Dictionary<int, int> { [7] = 1800, [8] = 1040 });
        var hits = await index.SearchAsync("בראשית", new HashSet<SearchFilter> { SearchFilter.Perush }, new HashSet<int> { 1 }, 1, TestContext.Current.CancellationToken, null, ordering);
        hits.Should().ContainSingle().Which.PerushId.Should().Be(8);
        hits = await index.SearchAsync("בראשית", new HashSet<SearchFilter> { SearchFilter.Perush }, new HashSet<int> { 1 }, 10, TestContext.Current.CancellationToken, null, ordering);
        hits.Select(hit => hit.PerushId).Should().Equal(8, 7, 9);
        (await index.SearchAsync("ברא", new HashSet<SearchFilter> { SearchFilter.Pasuk }, new HashSet<int> { 1, 2 }, 1, TestContext.Current.CancellationToken, null, ordering))
            .Should().ContainSingle().Which.PerekId.Should().Be(1);
    }

    private static async Task<PerekDataService> SeedAsync(TestStorage storage)
    {
        var db = await storage.CreateDatabaseAsync(BibleDb, PerekDataServiceTests.Schema);
        await db.ExecuteAsync("INSERT INTO tanah_sefer VALUES (1,'בראשית','Genesis',1,2),(2,'שמות','Exodus',3,3)");
        await db.ExecuteAsync("INSERT INTO tanah_perek VALUES (1,1,'בריאת העולם'),(2,2,'גן עדן'),(3,1,'בני ישראל')");
        await db.ExecuteAsync("INSERT INTO tanah_pasuk_segment VALUES (1,1,1,'qri'),(2,1,1,'qri'),(3,2,1,'qri'),(4,3,1,'qri')");
        await db.ExecuteAsync("INSERT INTO tanah_pasuk_segment_value VALUES (1,'בְּרֵאשִׁ֖ית'),(2,'בָּרָ֣א אֱלֹהִ֑ים'),(3,'אלהים ברא את העולם'),(4,'אלהים ברא')");
        return new PerekDataService(new LocalDatabaseService(storage.FileSystem.Object));
    }

    [Fact]
    public async Task PrebuiltCommentaryIndex_SearchesTheEndOfALargeCorpus()
    {
        await using var storage = new TestStorage();
        var perakim = await SeedAsync(storage);
        await storage.CreateDatabaseAsync(NotesDb,
            NotesDbV2.Statements([.. Enumerable.Range(1, 32769)
                .Select(n => (7, 1, 1, n, n == 32769 ? "אחרון" : "רגיל"))]));
        var delivery = new Mock<IPadDeliveryService>();
        delivery.Setup(service => service.TryGetAssetPathAsync(It.IsAny<string>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync((string?)null);
        var notes = PerushimNotesService.CreateForTesting(delivery.Object, storage.Root);
        await using var index = await CreateFixtureIndexAsync(perakim, notes, storage);

        var hits = await index.SearchAsync("אחרון", new HashSet<SearchFilter> { SearchFilter.Perush },
            new HashSet<int> { 1 }, 10, TestContext.Current.CancellationToken);

        hits.Should().ContainSingle().Which.Text.Should().Be("אחרון");
    }

    [Fact]
    public async Task HebrewSearch_IgnoresVowels_RequiresEveryWord_AndFiltersBeforeLimiting()
    {
        await using var storage = new TestStorage();
        var perakim = await SeedAsync(storage);
        await using var index = new SearchIndexService(perakim, null, Path.Join(storage.Root, "search.sqlite"));
        var filters = new HashSet<SearchFilter> { SearchFilter.Pasuk };
        var books = new HashSet<int> { 1, 2 };
        var hits = await index.SearchAsync("ברא אלהים", filters, books, 10, TestContext.Current.CancellationToken);
        hits.Should().HaveCount(3);
        hits.Should().Contain(hit => hit.PerekId == 1 && hit.Text.Contains("בָּרָ֣א"));
        (await index.SearchAsync("ברא אלהים", filters, new HashSet<int> { 2 }, 1, TestContext.Current.CancellationToken)).Should().ContainSingle().Which.PerekId.Should().Be(3);
        (await index.SearchAsync("ברא ירח", filters, books, 10, TestContext.Current.CancellationToken)).Should().BeEmpty();
        (await index.SearchAsync("ברא", filters, new HashSet<int>(), 10, TestContext.Current.CancellationToken)).Should().BeEmpty();
        (await index.SearchAsync("\" OR * -", filters, books, 10, TestContext.Current.CancellationToken)).Should().BeEmpty();
    }

    [Theory]
    [InlineData(1)]
    [InlineData(2)]
    public async Task LegacyIndex_IsRebuiltAndKeepsOriginalScriptureInExternalContent(int version)
    {
        await using var storage = new TestStorage();
        var perakim = await SeedAsync(storage);
        var path = Path.Join(storage.Root, "search.sqlite");
        string[] schema = version == 1 ? [
            "CREATE VIRTUAL TABLE verses USING fts5(Text, Body UNINDEXED, PerekId UNINDEXED, PasukNum UNINDEXED, PerushId UNINDEXED, SeferId UNINDEXED)",
            "INSERT INTO verses VALUES ('ישן','תוכן ישן',1,1,0,1)"
        ] : [
            "CREATE TABLE verses_content (rowid INTEGER PRIMARY KEY, Text TEXT, PerekId INTEGER, PasukNum INTEGER, PerushId INTEGER, SeferId INTEGER)",
            "CREATE VIRTUAL TABLE verses USING fts5(Text, content='verses_content', content_rowid='rowid')",
            "INSERT INTO verses_content VALUES (1,'תוכן ישן',1,1,0,1)",
            "INSERT INTO verses VALUES ('ישן')"
        ];
        var legacy = await storage.CreateDatabaseAsync("search.sqlite",
            ["CREATE TABLE search_metadata (name TEXT PRIMARY KEY, fingerprint TEXT)", .. schema]);
        var source = new FileInfo(Path.Join(storage.Root, BibleDb));
        await legacy.ExecuteAsync("INSERT INTO search_metadata VALUES ('verses', ?)", $"v{version}:{source.Length}:{source.LastWriteTimeUtc.Ticks}");
        await legacy.RunInTransactionAsync(connection =>
            SQLitePCL.raw.sqlite3_db_config(connection.Handle, SQLitePCL.raw.SQLITE_DBCONFIG_DEFENSIVE, 1, out _)
                .Should().Be(SQLitePCL.raw.SQLITE_OK));
        await using var index = new SearchIndexService(perakim, null, path);
        var hits = await index.SearchAsync("בראשית", new HashSet<SearchFilter> { SearchFilter.Pasuk }, new HashSet<int> { 1 }, 10, TestContext.Current.CancellationToken);
        hits.Should().ContainSingle().Which.Text.Should().Contain("בְּרֵאשִׁ֖ית");
        (await legacy.ExecuteScalarAsync<string>("SELECT Text FROM verses_documents WHERE PerekId = 1"))
            .Should().Contain("בְּרֵאשִׁ֖ית");
        (await legacy.ExecuteScalarAsync<string>("SELECT fingerprint FROM search_metadata WHERE name = 'verses'"))
            .Should().StartWith("v4:");
        (await index.SearchAsync("ישן", new HashSet<SearchFilter> { SearchFilter.Pasuk }, new HashSet<int> { 1 }, 10, TestContext.Current.CancellationToken))
            .Should().BeEmpty("a migrated cache cannot retain stale search results");
    }

    [Fact]
    public async Task DefensiveSqlite_CanAdoptNotesAndBuildVerseIndexes()
    {
        await using var storage = new TestStorage();
        var perakim = await SeedAsync(storage);
        await storage.CreateDatabaseAsync(NotesDb,
            NotesDbV2.Statements((7, 1, 1, 0, "בראשית ברא אלהים")));
        var inspection = await storage.CreateDatabaseAsync("search.sqlite");
        var delivery = new Mock<IPadDeliveryService>();
        delivery.Setup(service => service.TryGetAssetPathAsync(It.IsAny<string>(), It.IsAny<CancellationToken>())).ReturnsAsync((string?)null);
        var notes = PerushimNotesService.CreateForTesting(delivery.Object, storage.Root);
        await using var index = await CreateFixtureIndexAsync(perakim, notes, storage);
        await index.SearchAsync("בראשית", new HashSet<SearchFilter> { SearchFilter.Perush },
            new HashSet<int> { 1 }, 10, TestContext.Current.CancellationToken);
        await inspection.RunInTransactionAsync(connection =>
        {
            SQLitePCL.raw.sqlite3_db_config(connection.Handle, SQLitePCL.raw.SQLITE_DBCONFIG_DEFENSIVE, 1, out var enabled)
                .Should().Be(SQLitePCL.raw.SQLITE_OK);
            enabled.Should().Be(1);
        });
        var hits = await index.SearchAsync("בראשית ברא אלהים",
            new HashSet<SearchFilter> { SearchFilter.Pasuk, SearchFilter.Perush }, new HashSet<int> { 1 }, 10, TestContext.Current.CancellationToken);
        hits.Should().HaveCount(2);
        hits.Should().Contain(hit => hit.Type == SearchFilter.Pasuk && hit.PerekId == 1);
        hits.Should().Contain(hit => hit.Type == SearchFilter.Perush && hit.PerushId == 7);
    }

    [Fact]
    public async Task Search_UsesLevenshteinFallback_AndReusesCompletedIndex()
    {
        await using var storage = new TestStorage();
        var perakim = await SeedAsync(storage);
        var path = Path.Join(storage.Root, "search.sqlite");
        var filters = new HashSet<SearchFilter> { SearchFilter.Pasuk };
        var books = new HashSet<int> { 1 };
        await using (var index = new SearchIndexService(perakim, null, path))
        {
            var hits = await index.SearchAsync("בראשיט", filters, books, 10, TestContext.Current.CancellationToken);
            hits.Should().ContainSingle().Which.PerekId.Should().Be(1);
        }
        await using var reopened = new SearchIndexService(perakim, null, path);
        (await reopened.SearchAsync("בראשית", filters, books, 10, TestContext.Current.CancellationToken)).Should().ContainSingle();
        var unchanged = new FileInfo(path).LastWriteTimeUtc;
        await reopened.SearchAsync("אלהים", filters, books, 10, TestContext.Current.CancellationToken);
        new FileInfo(path).LastWriteTimeUtc.Should().Be(unchanged);
    }

    [Fact]
    public async Task CommentarySearch_StripsHtml_RespectsBooks_AndReturnsNavigationIds()
    {
        await using var storage = new TestStorage();
        var perakim = await SeedAsync(storage);
        var notesDb = await storage.CreateDatabaseAsync(NotesDb,
            NotesDbV2.Statements((7, 1, 1, 0, "<b>בריאת</b> הָעוֹלָם"), (8, 3, 1, 0, "בריאת העולם")));
        var delivery = new Mock<IPadDeliveryService>();
        delivery.Setup(service => service.TryGetAssetPathAsync(It.IsAny<string>(), It.IsAny<CancellationToken>())).ReturnsAsync((string?)null);
        var notes = PerushimNotesService.CreateForTesting(delivery.Object, storage.Root);
        await using var index = await CreateFixtureIndexAsync(perakim, notes, storage);
        var hits = await index.SearchAsync("בריאת העולם", new HashSet<SearchFilter> { SearchFilter.Perush }, new HashSet<int> { 1 }, 10, TestContext.Current.CancellationToken);
        index.CommentaryAvailable.Should().BeTrue();
        hits.Should().ContainSingle();
        hits[0].PerushId.Should().Be(7);
        hits[0].PasukNum.Should().Be(1);
        hits[0].PerekId.Should().Be(1);
        hits[0].Text.Should().NotContain("<b>");
        var sourceBlobs = await notesDb.QueryAsync<SourceBlobRow>("SELECT perek_id AS PerekId, data AS Data FROM note_blob");
        sourceBlobs.Sum(row => PerushNoteBlob.Decode(row.Data).Count).Should().Be(2, "search must not alter source content");
        var vm = new SearchViewModel(perakim, index) { SearchPhrase = "בריאת העולם" };
        vm.SetPerushim([new Perush { Id = 7, Name = "רש\"י" }]);
        await vm.SearchAsync(TestContext.Current.CancellationToken);
        vm.SearchResults.OfType<PerushSearchResult>().Should().Contain(result => result.Title == "רש\"י - בראשית א א");
    }

    [Fact]
    public async Task ViewModel_AppliesOneGlobalLimit_AndShowsMissingCommentaryHint()
    {
        await using var storage = new TestStorage();
        var perakim = await SeedAsync(storage);
        await using var index = new SearchIndexService(perakim, null, Path.Join(storage.Root, "search.sqlite"));
        var vm = new SearchViewModel(perakim, index) { SearchPhrase = "בראשית", ResultsLimit = 2 };
        vm.SetAuthors([new Author { Id = 1, Name = "הרב בראשית", Details = "<i>תיאור</i>" }]);
        await vm.SearchAsync(TestContext.Current.CancellationToken);
        vm.SearchResults.Should().HaveCount(2);
        vm.SearchResults.First().Should().BeOfType<AuthorSearchResult>();
        vm.AvailabilityMessage.Should().Contain("בהגדרות");
        vm.SearchResults.Should().OnlyContain(result => !string.IsNullOrEmpty(result.Title));
        vm.SearchPhrase = "   ";
        await vm.SearchAsync(TestContext.Current.CancellationToken);
        vm.SearchResults.Should().BeEmpty();
        vm.IsLoading.Should().BeFalse();
        vm.AvailabilityMessage.Should().BeEmpty();
    }

    [Fact]
    public async Task ViewModel_CancelledQueryCannotOverwriteTheNextQuery()
    {
        await using var storage = new TestStorage();
        var perakim = await SeedAsync(storage);
        await using var index = new SearchIndexService(perakim, null, Path.Join(storage.Root, "search.sqlite"));
        var vm = new SearchViewModel(perakim, index) { SearchPhrase = "בראשית" };
        vm.SetFilterEnabled(SearchFilter.Perush, false);
        var previous = vm.SearchAsync(TestContext.Current.CancellationToken);
        vm.SearchPhrase = "שמות 1";
        await vm.SearchAsync(TestContext.Current.CancellationToken);
        await previous;
        vm.SearchResults.Should().ContainSingle().Which.Title.Should().Be("שמות א");
        vm.IsLoading.Should().BeFalse();
        using var cancellation = new CancellationTokenSource();
        cancellation.Cancel();
        await vm.SearchAsync(cancellation.Token);
        vm.SearchResults.Should().BeEmpty();
        vm.IsLoading.Should().BeFalse();
    }

    [Theory]
    [InlineData("בְּרֵאשִׁית־בָּרָא", "בראשית ברא")]
    [InlineData("שמואל ב, ה׳ ו״", "שמואל ב ה ו")]
    [InlineData("תנ״ך - בראשית", "תנך בראשית")]
    public void Normalize_AcceptsLegacyHebrewPunctuation(string value, string expected) => SearchText.Normalize(value).Should().Be(expected);

    [Fact]
    public void Snippet_PreservesVowelsAndSafeMarkup_AndHighlightsTheActualTypoMatch()
    {
        SearchText.Snippet("<b>בְּרֵאשִׁית</b> &lt;script&gt;", "בראשיט").Should().Contain("<b>בְּרֵאשִׁית</b>").And.NotContain("<script>");
        SearchText.Score("בראשית", "בראשית").Should().BeGreaterThan(SearchText.Score("בראשית", "בראשיט"));
        SearchText.Score("משה", "דוד").Should().Be(0);
        SearchText.Score("ברא אלהים", "ברא").Should().BeGreaterThan(SearchText.Score("בראשית", "ברא"));
        SearchText.PlainText("<p>בריאת</p><p>העולם</p>").Should().Contain("בריאת העולם");
        SearchText.PlainText("בריאה &amp; אור").Should().Be("בריאה & אור");
    }

    [Fact]
    public void HiddenHtmlAndAnEmptyQueryDoNotCreateSearchMatches()
    {
        SearchText.PlainText("<script>hidden</script><style>hidden</style><p>בריאה</p>")
            .Should().Contain("בריאה").And.NotContain("hidden");
        SearchText.Score("בריאה", " * ").Should().Be(0);
        SearchText.Score("", "בריאה").Should().Be(0);
        SearchText.Normalize("का").Should().Be("क", "spacing combining marks are removed along with Hebrew vowel marks");
    }

    [Theory]
    [InlineData("רש'י")]
    [InlineData("רש\"י")]
    [InlineData("רש׳י")]
    [InlineData("רש״י")]
    public void Snippet_MatchesLegacyAbbreviationsWithoutSplittingTheWord(string text)
    {
        SearchText.Snippet(text, "רשי").Should().Be("<b>" + System.Net.WebUtility.HtmlEncode(text) + "</b>");
    }

    [Fact]
    public async Task ExactWord_RanksAheadOfAPrefix_EvenWhenOnlyOneResultIsRequested()
    {
        await using var storage = new TestStorage();
        var perakim = await SeedAsync(storage);
        await using var index = new SearchIndexService(perakim, null, Path.Join(storage.Root, "search.sqlite"));
        var hits = await index.SearchAsync("ברא", new HashSet<SearchFilter> { SearchFilter.Pasuk }, new HashSet<int> { 1 }, 1, TestContext.Current.CancellationToken);
        hits.Should().ContainSingle();
        SearchText.Tokens(hits[0].Text).Should().Contain("ברא");
    }

    [Fact]
    public async Task VerseSearch_RemainsUsableWhileCommentaryAvailabilityIsBeingChecked()
    {
        await using var storage = new TestStorage();
        var perakim = await SeedAsync(storage);
        var entered = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var release = new TaskCompletionSource<string?>(TaskCreationOptions.RunContinuationsAsynchronously);
        var delivery = new Mock<IPadDeliveryService>();
        delivery.Setup(service => service.TryGetAssetPathAsync(It.IsAny<string>(), It.IsAny<CancellationToken>()))
            .Returns(() => { entered.TrySetResult(); return release.Task; });
        var notes = PerushimNotesService.CreateForTesting(delivery.Object, storage.Root);
        await using var index = new SearchIndexService(perakim, notes, Path.Join(storage.Root, "search.sqlite"));
        var books = new HashSet<int> { 1 };
        var verses = new HashSet<SearchFilter> { SearchFilter.Pasuk };
        await index.SearchAsync("בראשית", verses, books, 10, TestContext.Current.CancellationToken);
        var commentary = index.SearchAsync("בראשית", new HashSet<SearchFilter> { SearchFilter.Perush }, books, 10, TestContext.Current.CancellationToken);
        try
        {
            await entered.Task.WaitAsync(TimeSpan.FromSeconds(5), TestContext.Current.CancellationToken);
            (await index.SearchAsync("בראשית", verses, books, 10, TestContext.Current.CancellationToken).WaitAsync(TimeSpan.FromSeconds(5), TestContext.Current.CancellationToken))
                .Should().ContainSingle().Which.PerekId.Should().Be(1);
        }
        finally
        {
            release.TrySetResult(null);
            await commentary;
        }
    }

    [Fact]
    public async Task ContentSearch_KeepsWordsThatAreOptionalInAuthorNames()
    {
        await using var storage = new TestStorage();
        var perakim = await SeedAsync(storage);
        await storage.CreateDatabaseAsync(NotesDb,
            NotesDbV2.Statements((7, 1, 1, 0, "אמר משה"), (8, 1, 1, 0, "אמר הרב משה")));
        var delivery = new Mock<IPadDeliveryService>();
        delivery.Setup(service => service.TryGetAssetPathAsync(It.IsAny<string>(), It.IsAny<CancellationToken>())).ReturnsAsync((string?)null);
        var notes = PerushimNotesService.CreateForTesting(delivery.Object, storage.Root);
        await using var index = await CreateFixtureIndexAsync(perakim, notes, storage);
        var vm = new SearchViewModel(perakim, index) { SearchPhrase = "הרב משה" };
        vm.SetFilterEnabled(SearchFilter.Author, false);
        vm.SetFilterEnabled(SearchFilter.Pasuk, false);
        vm.SetFilterEnabled(SearchFilter.Perek, false);
        await vm.SearchAsync(TestContext.Current.CancellationToken);
        vm.SearchResults.Should().ContainSingle().Which.Should().BeOfType<PerushSearchResult>()
            .Which.PerushId.Should().Be("8");
    }

    /// <summary>Minimal queryable index DB as the pipeline ships it: the
    /// external-content FTS + documents tables + a fingerprint row.</summary>
    private static string[] DeliveredIndexStatements(string notesFingerprint, string markerDoc) =>
    [
        "CREATE TABLE search_metadata (name TEXT PRIMARY KEY, fingerprint TEXT)",
        $"INSERT INTO search_metadata VALUES ('notes','{notesFingerprint}')",
        "CREATE TABLE notes_documents (rowid INTEGER PRIMARY KEY, Text TEXT, PerekId INTEGER, PasukNum INTEGER, PerushId INTEGER, SeferId INTEGER)",
        $"INSERT INTO notes_documents VALUES (1,'{markerDoc}',1,1,7,1)",
        "CREATE VIRTUAL TABLE notes USING fts5(Text, content='notes_documents', content_rowid='rowid')",
        $"INSERT INTO notes(rowid,Text) VALUES (1,'{markerDoc}')",
        "CREATE VIRTUAL TABLE notes_vocab USING fts5vocab(notes, 'row')",
    ];

    private static Mock<IPadDeliveryService> NullPad()
    {
        var delivery = new Mock<IPadDeliveryService>();
        delivery.Setup(service => service.TryGetAssetPathAsync(It.IsAny<string>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync((string?)null);
        return delivery;
    }

    [Fact]
    public async Task DeliveredIndex_WithMatchingFingerprint_IsAdoptedWithoutRebuilding()
    {
        await using var storage = new TestStorage();
        var perakim = await SeedAsync(storage);
        await storage.CreateDatabaseAsync(NotesDb,
            [.. NotesDbV2.Statements((7, 1, 1, 0, "בראשית")), "INSERT INTO _metadata VALUES ('build_timestamp','42')"]);
        // The staged pack payload carries a ready index for this generation.
        var delivered = await storage.CreateDatabaseAsync(PerushimNotesService.SearchIndexDbName,
            DeliveredIndexStatements($"v4:42:n{SearchText.NormalizationVersion}", "סימן מובהק"));
        await delivered.CloseAsync();
        var notes = PerushimNotesService.CreateForTesting(NullPad().Object, storage.Root);
        await using var index = new SearchIndexService(perakim, notes, Path.Join(storage.Root, "search.sqlite"));

        var hits = await index.SearchAsync("סימן", new HashSet<SearchFilter> { SearchFilter.Perush },
            new HashSet<int> { 1 }, 10, TestContext.Current.CancellationToken);

        hits.Should().ContainSingle().Which.PerushId.Should().Be(7);
        File.Exists(Path.Join(storage.Root, PerushimNotesService.SearchIndexDbName))
            .Should().BeFalse("adoption moves the staged file into place — no duplicate ~300 MB copies");
        var inspection = new SQLite.SQLiteAsyncConnection(Path.Join(storage.Root, "search.sqlite"), SQLite.SQLiteOpenFlags.ReadOnly);
        try
        {
            var stored = await inspection.ExecuteScalarAsync<string>(
                "SELECT fingerprint FROM search_metadata WHERE name = 'notes'");
            stored.Should().Be($"v4:42:n{SearchText.NormalizationVersion}");
        }
        finally { await inspection.CloseAsync(); }
    }

    [Fact]
    public async Task EvictedWorkingCache_RestoresTheAvailablePackIndexWithoutImportingNotes()
    {
        await using var storage = new TestStorage();
        await using var pack = new TestStorage();
        var perakim = await SeedAsync(storage);
        await storage.CreateDatabaseAsync(NotesDb,
            [.. NotesDbV2.Statements((7, 1, 1, 0, "בראשית")), "INSERT INTO _metadata VALUES ('build_timestamp','42')"]);
        var delivered = await pack.CreateDatabaseAsync(PerushimNotesService.SearchIndexDbName,
            DeliveredIndexStatements("v4:42:n1", "סימן מובהק"));
        await delivered.CloseAsync();
        File.Copy(Path.Join(pack.Root, PerushimNotesService.SearchIndexDbName),
            Path.Join(storage.Root, PerushimNotesService.SearchIndexDbName));
        var delivery = NullPad();
        delivery.Setup(service => service.TryGetAssetPathAsync(It.IsAny<string>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(pack.Root);
        var notes = PerushimNotesService.CreateForTesting(delivery.Object, storage.Root);
        var cachePath = Path.Join(storage.Root, "search.sqlite");
        var filters = new HashSet<SearchFilter> { SearchFilter.Perush };
        var books = new HashSet<int> { 1 };
        await using (var first = new SearchIndexService(perakim, notes, cachePath))
        {
            (await first.SearchAsync("סימן", filters, books, 10, TestContext.Current.CancellationToken))
                .Should().ContainSingle();
        }
        File.Delete(cachePath);
        await using var restored = new SearchIndexService(perakim, notes, cachePath);
        (await restored.SearchAsync("סימן", filters, books, 10, TestContext.Current.CancellationToken))
            .Should().ContainSingle("cache eviction must restore the pack's index instead of rebuilding the corpus");
        delivery.Verify(service => service.FetchAsync(It.IsAny<string>(), It.IsAny<IProgress<double>>(),
            It.IsAny<CancellationToken>()), Times.Never);
    }

    [Fact]
    public async Task FirstVerseQuery_UsesTheInstalledDeliveredIndexBeforeBuilding()
    {
        await using var storage = new TestStorage();
        var perakim = await SeedAsync(storage);
        var source = await perakim.GetSearchConnectionAsync();
        await source.CloseAsync();
        var bibleFile = new FileInfo(Path.Join(storage.Root, BibleDb));
        var verseFingerprint = $"v4:{bibleFile.Length}:{bibleFile.LastWriteTimeUtc.Ticks}:n1";
        await storage.CreateDatabaseAsync(NotesDb,
            [.. NotesDbV2.Statements((7, 1, 1, 0, "בראשית")), "INSERT INTO _metadata VALUES ('build_timestamp','42')"]);
        var delivered = await storage.CreateDatabaseAsync(PerushimNotesService.SearchIndexDbName,
            [.. DeliveredIndexStatements("v4:42:n1", "סימן מובהק"),
            $"INSERT INTO search_metadata VALUES ('verses','{verseFingerprint}')",
            "CREATE TABLE verses_documents (rowid INTEGER PRIMARY KEY, Text TEXT, PerekId INTEGER, PasukNum INTEGER, PerushId INTEGER, SeferId INTEGER)",
            "INSERT INTO verses_documents VALUES (1,'מוכן מראש',1,1,0,1)",
            "CREATE VIRTUAL TABLE verses USING fts5(Text, content='verses_documents', content_rowid='rowid')",
            "INSERT INTO verses(rowid,Text) VALUES (1,'מוכן מראש')",
            "CREATE VIRTUAL TABLE verses_vocab USING fts5vocab(verses, 'row')"]);
        await delivered.CloseAsync();
        var notes = PerushimNotesService.CreateForTesting(NullPad().Object, storage.Root);
        await notes.InitializeAsync();
        await using var index = new SearchIndexService(perakim, notes, Path.Join(storage.Root, "search.sqlite"));

        (await index.SearchAsync("מוכן מראש", new HashSet<SearchFilter> { SearchFilter.Pasuk },
            new HashSet<int> { 1 }, 10, TestContext.Current.CancellationToken))
            .Should().ContainSingle().Which.Text.Should().Be("מוכן מראש");
    }

    [Fact]
    public async Task DeliveredIndex_AdoptionInvalidatesPreviouslyReadyVerseTables()
    {
        await using var storage = new TestStorage();
        var perakim = await SeedAsync(storage);
        await storage.CreateDatabaseAsync(NotesDb,
            [.. NotesDbV2.Statements((7, 1, 1, 0, "בראשית")), "INSERT INTO _metadata VALUES ('build_timestamp','42')"]);
        var delivered = await storage.CreateDatabaseAsync(PerushimNotesService.SearchIndexDbName,
            DeliveredIndexStatements("v4:42:n1", "סימן מובהק"));
        await delivered.CloseAsync();
        var notes = PerushimNotesService.CreateForTesting(NullPad().Object, storage.Root);
        await using var index = new SearchIndexService(perakim, notes, Path.Join(storage.Root, "search.sqlite"));
        var books = new HashSet<int> { 1 };
        var verses = new HashSet<SearchFilter> { SearchFilter.Pasuk };
        (await index.SearchAsync("בראשית", verses, books, 10, TestContext.Current.CancellationToken)).Should().ContainSingle();
        await index.SearchAsync("סימן", new HashSet<SearchFilter> { SearchFilter.Perush }, books, 10, TestContext.Current.CancellationToken);

        (await index.SearchAsync("בראשית", verses, books, 10, TestContext.Current.CancellationToken))
            .Should().ContainSingle("replacing the database invalidates readiness for every replaced table");
    }

    private sealed class SearchUiContext : SynchronizationContext
    {
        private int _posts;
        public int Posts => _posts;
        public override void Post(SendOrPostCallback callback, object? state)
        {
            Interlocked.Increment(ref _posts);
            ThreadPool.QueueUserWorkItem(_ =>
            {
                SetSynchronizationContext(this);
                callback(state);
            });
        }
    }

    [Fact]
    public async Task ColdSearch_DoesNotRunCorpusWorkOnTheCallersUiContext()
    {
        await using var storage = new TestStorage();
        var perakim = await SeedAsync(storage);
        await using var index = new SearchIndexService(perakim, null, Path.Join(storage.Root, "search.sqlite"));
        var ui = new SearchUiContext();
        var previous = SynchronizationContext.Current;
        Task<List<SearchHit>> search;
        SynchronizationContext.SetSynchronizationContext(ui);
        try
        {
            search = index.SearchAsync("בראשית", new HashSet<SearchFilter> { SearchFilter.Pasuk },
                new HashSet<int> { 1 }, 10, TestContext.Current.CancellationToken);
        }
        finally { SynchronizationContext.SetSynchronizationContext(previous); }

        (await search).Should().ContainSingle();
        ui.Posts.Should().Be(0, "index construction, fuzzy expansion and scoring must not monopolize the UI dispatcher");
    }

    [Fact]
    public async Task DeliveredIndex_WithWrongGeneration_DoesNotBuildOnDevice()
    {
        await using var storage = new TestStorage();
        var perakim = await SeedAsync(storage);
        await storage.CreateDatabaseAsync(NotesDb,
            [.. NotesDbV2.Statements((7, 1, 1, 0, "בראשית")), "INSERT INTO _metadata VALUES ('build_timestamp','42')"]);
        var deliveredPath = Path.Join(storage.Root, PerushimNotesService.SearchIndexDbName);
        var delivered = await storage.CreateDatabaseAsync(PerushimNotesService.SearchIndexDbName,
            DeliveredIndexStatements("v4:999:n1", "סימן מובהק"));
        await delivered.CloseAsync();
        var notes = PerushimNotesService.CreateForTesting(NullPad().Object, storage.Root);
        await using var index = new SearchIndexService(perakim, notes, Path.Join(storage.Root, "search.sqlite"));

        var hits = await index.SearchAsync("בראשית", new HashSet<SearchFilter> { SearchFilter.Perush },
            new HashSet<int> { 1 }, 10, TestContext.Current.CancellationToken);

        hits.Should().BeEmpty("the wrong-generation index must not trigger a corpus import");
        index.CommentaryAvailable.Should().BeFalse();
        (await index.SearchAsync("סימן", new HashSet<SearchFilter> { SearchFilter.Perush },
            new HashSet<int> { 1 }, 10, TestContext.Current.CancellationToken))
            .Should().BeEmpty("the wrong-generation index must never be queried");
        File.Exists(deliveredPath).Should().BeFalse("an unadoptable staged index is removed rather than left on the device");
    }

    [Fact]
    public async Task DeliveredIndex_ForContentWithoutMetadata_MatchesByFileStats()
    {
        await using var storage = new TestStorage();
        var perakim = await SeedAsync(storage);
        // A hand-built v2 DB without build_timestamp — the fingerprint falls
        // back to file size + modification time.
        var notesDb = await storage.CreateDatabaseAsync(NotesDb,
            NotesDbV2.Statements((7, 1, 1, 0, "בראשית")));
        await notesDb.CloseAsync();
        var notesFile = new FileInfo(Path.Join(storage.Root, NotesDb));
        var fingerprint = $"v4:{notesFile.Length}:{notesFile.LastWriteTimeUtc.Ticks}:n{SearchText.NormalizationVersion}";
        var delivered = await storage.CreateDatabaseAsync(PerushimNotesService.SearchIndexDbName,
            DeliveredIndexStatements(fingerprint, "סימן מובהק"));
        await delivered.CloseAsync();
        var notes = PerushimNotesService.CreateForTesting(NullPad().Object, storage.Root);
        await using var index = new SearchIndexService(perakim, notes, Path.Join(storage.Root, "search.sqlite"));

        var hits = await index.SearchAsync("סימן", new HashSet<SearchFilter> { SearchFilter.Perush },
            new HashSet<int> { 1 }, 10, TestContext.Current.CancellationToken);

        hits.Should().ContainSingle().Which.PerushId.Should().Be(7);
    }

    [Fact]
    public async Task Search_WhenNotesPackMissing_DropsStaleCommentaryIndex()
    {
        await using var storage = new TestStorage();
        var perakim = await SeedAsync(storage);
        // A working index already containing a stale notes table + fingerprint.
        var working = await storage.CreateDatabaseAsync("search.sqlite",
            DeliveredIndexStatements("v4:1:n1", "סימן מובהק"));
        await working.CloseAsync();
        var notes = PerushimNotesService.CreateForTesting(NullPad().Object, storage.Root);
        await using var index = new SearchIndexService(perakim, notes, Path.Join(storage.Root, "search.sqlite"));

        var hits = await index.SearchAsync("סימן", new HashSet<SearchFilter> { SearchFilter.Perush },
            new HashSet<int> { 1 }, 10, TestContext.Current.CancellationToken);

        index.CommentaryAvailable.Should().BeFalse();
        hits.Should().BeEmpty();
        var inspection = new SQLite.SQLiteAsyncConnection(Path.Join(storage.Root, "search.sqlite"), SQLite.SQLiteOpenFlags.ReadOnly);
        try
        {
            var tables = await inspection.ExecuteScalarAsync<int>(
                "SELECT COUNT(*) FROM sqlite_schema WHERE name = 'notes_documents'");
            tables.Should().Be(0, "commentary index data is removed when its pack is gone");
        }
        finally { await inspection.CloseAsync(); }
    }

    [Fact]
    public async Task SearchAsync_ReportsProgressDuringCommentaryInitialization()
    {
        await using var storage = new TestStorage();
        var perakim = await SeedAsync(storage);
        await storage.CreateDatabaseAsync(NotesDb,
            NotesDbV2.Statements((7, 1, 1, 0, "בראשית")));
        var notes = PerushimNotesService.CreateForTesting(NullPad().Object, storage.Root);
        await using var index = await CreateFixtureIndexAsync(perakim, notes, storage);
        // Verify the synchronous reporting contract. Progress<T> posts callbacks
        // to a context/thread pool that can run after SearchAsync has returned.
        var progress = new Mock<IProgress<string>>();

        var hits = await index.SearchAsync("בראשית", new HashSet<SearchFilter> { SearchFilter.Perush },
            new HashSet<int> { 1 }, 10, TestContext.Current.CancellationToken, progress.Object);

        hits.Should().ContainSingle();
        progress.Verify(p => p.Report(It.Is<string>(message => message.Contains("מכין"))),
            Times.AtLeastOnce(), "commentary initialization reports its status");
    }

    [Fact]
    public async Task SearchAsync_RejectsOversizedQueries()
    {
        await using var storage = new TestStorage();
        var perakim = await SeedAsync(storage);
        await using var index = new SearchIndexService(perakim, null, Path.Join(storage.Root, "search.sqlite"));
        var filters = new HashSet<SearchFilter> { SearchFilter.Pasuk };
        var books = new HashSet<int> { 1 };

        // 17 terms and a 65-character term are both beyond the query contract.
        var tooMany = string.Join(' ', Enumerable.Range(1, 17).Select(_ => "ברא"));
        (await index.SearchAsync(tooMany, filters, books, 10, TestContext.Current.CancellationToken))
            .Should().BeEmpty();
        (await index.SearchAsync(new string('ב', 65), filters, books, 10, TestContext.Current.CancellationToken))
            .Should().BeEmpty();
        // A well-formed query still works afterwards.
        (await index.SearchAsync("בראשית", filters, books, 10, TestContext.Current.CancellationToken))
            .Should().ContainSingle();
    }

    [Fact]
    public async Task SearchAsync_AfterDispose_Throws()
    {
        await using var storage = new TestStorage();
        var perakim = await SeedAsync(storage);
        var index = new SearchIndexService(perakim, null, Path.Join(storage.Root, "search.sqlite"));
        await index.DisposeAsync();

        await Assert.ThrowsAsync<ObjectDisposedException>(() => index.SearchAsync("בראשית",
            new HashSet<SearchFilter> { SearchFilter.Pasuk }, new HashSet<int> { 1 },
            10, TestContext.Current.CancellationToken));
    }

    [Fact]
    public async Task DeliveredIndex_WithCorruptFile_DoesNotBuildOnDevice()
    {
        await using var storage = new TestStorage();
        var perakim = await SeedAsync(storage);
        await storage.CreateDatabaseAsync(NotesDb,
            [.. NotesDbV2.Statements((7, 1, 1, 0, "בראשית")), "INSERT INTO _metadata VALUES ('build_timestamp','42')"]);
        var deliveredPath = Path.Join(storage.Root, PerushimNotesService.SearchIndexDbName);
        await File.WriteAllTextAsync(deliveredPath, "not a sqlite index", TestContext.Current.CancellationToken);
        var notes = PerushimNotesService.CreateForTesting(NullPad().Object, storage.Root);
        await using var index = new SearchIndexService(perakim, notes, Path.Join(storage.Root, "search.sqlite"));

        var hits = await index.SearchAsync("בראשית", new HashSet<SearchFilter> { SearchFilter.Perush },
            new HashSet<int> { 1 }, 10, TestContext.Current.CancellationToken);

        hits.Should().BeEmpty("a corrupt prebuilt index must not trigger a corpus import");
        index.CommentaryAvailable.Should().BeFalse();
        File.Exists(deliveredPath).Should().BeFalse("the unusable staged index is removed");
    }

    [Fact]
    public async Task DeliveredIndex_Missing_DoesNotBuildOnDevice()
    {
        await using var storage = new TestStorage();
        var perakim = await SeedAsync(storage);
        // Notes pack without a staged index — the oldest delivered format.
        await storage.CreateDatabaseAsync(NotesDb,
            [.. NotesDbV2.Statements((7, 1, 1, 0, "מיוחד")), "INSERT INTO _metadata VALUES ('build_timestamp','42')"]);
        var notes = PerushimNotesService.CreateForTesting(NullPad().Object, storage.Root);
        await using var index = new SearchIndexService(perakim, notes, Path.Join(storage.Root, "search.sqlite"));

        var hits = await index.SearchAsync("מיוחד", new HashSet<SearchFilter> { SearchFilter.Perush },
            new HashSet<int> { 1 }, 10, TestContext.Current.CancellationToken);

        hits.Should().BeEmpty("a missing prebuilt index must not trigger a corpus import");
        index.CommentaryAvailable.Should().BeFalse();
        (await index.SearchAsync("בראשית", new HashSet<SearchFilter> { SearchFilter.Pasuk },
            new HashSet<int> { 1 }, 10, TestContext.Current.CancellationToken)).Should().ContainSingle();
    }

    [Fact]
    public async Task PrebuiltCommentaryFixture_ExcludesUnknownPerakim()
    {
        await using var storage = new TestStorage();
        var perakim = await SeedAsync(storage);
        // Perek 999 is outside the sefer map — its notes cannot be navigated
        // to and are skipped instead of indexed with a broken SeferId.
        await storage.CreateDatabaseAsync(NotesDb,
            NotesDbV2.Statements((7, 999, 1, 0, "אורפן"), (7, 1, 1, 0, "שלם")));
        var notes = PerushimNotesService.CreateForTesting(NullPad().Object, storage.Root);
        await using var index = await CreateFixtureIndexAsync(perakim, notes, storage);

        var hits = await index.SearchAsync("אורפן", new HashSet<SearchFilter> { SearchFilter.Perush },
            new HashSet<int> { 1 }, 10, TestContext.Current.CancellationToken);

        hits.Should().BeEmpty();
        (await index.SearchAsync("שלם", new HashSet<SearchFilter> { SearchFilter.Perush },
            new HashSet<int> { 1 }, 10, TestContext.Current.CancellationToken))
            .Should().ContainSingle("in-range notes still index normally");
        var inspection = new SQLite.SQLiteAsyncConnection(Path.Join(storage.Root, "search.sqlite"), SQLite.SQLiteOpenFlags.ReadOnly);
        try
        {
            (await inspection.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM notes_documents"))
                .Should().Be(1, "only the known perek made it into the index");
        }
        finally { await inspection.CloseAsync(); }
    }

    [Fact]
    public async Task Search_WhenNotesPackMissing_WithoutPriorIndex_Succeeds()
    {
        await using var storage = new TestStorage();
        var perakim = await SeedAsync(storage);
        var notes = PerushimNotesService.CreateForTesting(NullPad().Object, storage.Root);
        await using var index = new SearchIndexService(perakim, notes, Path.Join(storage.Root, "search.sqlite"));

        var hits = await index.SearchAsync("בראשית", new HashSet<SearchFilter> { SearchFilter.Perush },
            new HashSet<int> { 1 }, 10, TestContext.Current.CancellationToken);

        index.CommentaryAvailable.Should().BeFalse();
        hits.Should().BeEmpty();
    }

    [Fact]
    public async Task Initialization_SweepsObsoleteIndexFiles()
    {
        await using var storage = new TestStorage();
        var perakim = await SeedAsync(storage);
        var indexPath = Path.Join(storage.Root, "search.sqlite");
        // The superseded v1 cache + interrupted atomic-replace leftovers sit
        // next to the working index and must not accumulate.
        foreach (var name in new[] { "hebrew-search-v1.sqlite", "hebrew-search-v1.sqlite-wal",
                 "hebrew-search-v1.sqlite-shm", $"search.sqlite.{Guid.NewGuid():N}.tmp" })
        {
            await File.WriteAllTextAsync(Path.Join(storage.Root, name), "stale", TestContext.Current.CancellationToken);
        }

        await using (var index = new SearchIndexService(perakim, null, indexPath))
        {
            (await index.SearchAsync("בראשית", new HashSet<SearchFilter> { SearchFilter.Pasuk },
                new HashSet<int> { 1 }, 10, TestContext.Current.CancellationToken))
                .Should().ContainSingle();
        }

        Directory.GetFiles(storage.Root, "hebrew-search-v1.sqlite*").Should().BeEmpty();
        Directory.GetFiles(storage.Root, "search.sqlite.*.tmp").Should().BeEmpty();
    }

    [Fact]
    public async Task DeliveredIndex_WhenDeleteFails_DoesNotBuildOnDevice()
    {
        await using var storage = new TestStorage();
        var perakim = await SeedAsync(storage);
        await storage.CreateDatabaseAsync(NotesDb,
            [.. NotesDbV2.Statements((7, 1, 1, 0, "בראשית")), "INSERT INTO _metadata VALUES ('build_timestamp','42')"]);
        var deliveredPath = Path.Join(storage.Root, PerushimNotesService.SearchIndexDbName);
        var delivered = await storage.CreateDatabaseAsync(PerushimNotesService.SearchIndexDbName,
            DeliveredIndexStatements("v4:999:n1", "סימן מובהק"));
        await delivered.CloseAsync();
        var indexDir = Path.Join(storage.Root, "index");
        Directory.CreateDirectory(indexDir);
        // A locked staged index cannot be deleted; it must remain untrusted
        // without triggering a full-corpus import. Windows
        // honors the open handle; on POSIX an advisory lock does not block
        // unlink, so the data directory itself is made non-writable.
        await using var locked = new FileStream(deliveredPath, FileMode.Open, FileAccess.Read, FileShare.None);
        var lockedDirectory = !OperatingSystem.IsWindows();
        if (lockedDirectory)
        {
            File.SetUnixFileMode(storage.Root, UnixFileMode.UserRead | UnixFileMode.UserExecute);
        }
        try
        {
            var notes = PerushimNotesService.CreateForTesting(NullPad().Object, storage.Root);
            await using var index = new SearchIndexService(perakim, notes, Path.Join(indexDir, "search.sqlite"));

            var hits = await index.SearchAsync("בראשית", new HashSet<SearchFilter> { SearchFilter.Perush },
                new HashSet<int> { 1 }, 10, TestContext.Current.CancellationToken);

            hits.Should().BeEmpty("an undeletable invalid index must not trigger a corpus import");
            index.CommentaryAvailable.Should().BeFalse();
            File.Exists(deliveredPath).Should().BeTrue("the undeletable staged file lingers");
        }
        finally
        {
            if (lockedDirectory)
            {
                File.SetUnixFileMode(storage.Root,
                    UnixFileMode.UserRead | UnixFileMode.UserWrite | UnixFileMode.UserExecute);
            }
        }
    }

    [Fact]
    public void Instance_OnUnitTestHost_ThrowsPlatformNotImplemented()
    {
        // The production singleton resolves FileSystem.Current, which has no
        // implementation in the unit-test host.
        var act = () => _ = SearchIndexService.Instance;

        act.Should().Throw<NotImplementedException>();
    }

    [Fact]
    public async Task Initialization_WhenStaleTempCannotBeDeleted_StillServesQueries()
    {
        await using var storage = new TestStorage();
        var perakim = await SeedAsync(storage);
        var indexDir = Path.Join(storage.Root, "index");
        Directory.CreateDirectory(indexDir);
        var indexPath = Path.Join(indexDir, "search.sqlite");
        // A read-only index directory must still serve queries: pre-create the
        // index in WAL mode so -wal/-shm already exist and stay writable.
        var preOpen = new SQLite.SQLiteAsyncConnection(indexPath);
        await preOpen.ExecuteScalarAsync<string>("PRAGMA journal_mode=WAL");
        await preOpen.ExecuteAsync("CREATE TABLE search_metadata (name TEXT PRIMARY KEY, fingerprint TEXT)");
        var stale = Path.Join(indexDir, $"search.sqlite.{Guid.NewGuid():N}.tmp");
        await File.WriteAllTextAsync(stale, "interrupted replace", TestContext.Current.CancellationToken);
        // Windows honors the open handle; on POSIX an advisory lock does not
        // block unlink, so the index directory itself is made non-writable.
        await using var locked = new FileStream(stale, FileMode.Open, FileAccess.Read, FileShare.None);
        var lockedDirectory = !OperatingSystem.IsWindows();
        if (lockedDirectory)
        {
            File.SetUnixFileMode(indexDir, UnixFileMode.UserRead | UnixFileMode.UserExecute);
        }
        try
        {
            await using var index = new SearchIndexService(perakim, null, indexPath);
            var hits = await index.SearchAsync("בראשית", new HashSet<SearchFilter> { SearchFilter.Pasuk },
                new HashSet<int> { 1 }, 10, TestContext.Current.CancellationToken);

            hits.Should().ContainSingle("a stuck temp file must not break the index");
            File.Exists(stale).Should().BeTrue("the undeletable temp file lingers until a later sweep");
        }
        finally
        {
            if (lockedDirectory)
            {
                File.SetUnixFileMode(indexDir,
                    UnixFileMode.UserRead | UnixFileMode.UserWrite | UnixFileMode.UserExecute);
            }
            await preOpen.CloseAsync();
        }
    }

    [Fact]
    public async Task GenerationOrdering_WithoutCommentaryYears_KeepsDocumentOrder()
    {
        await using var storage = new TestStorage();
        var perakim = await SeedAsync(storage);
        await storage.CreateDatabaseAsync(NotesDb,
            NotesDbV2.Statements((7, 1, 1, 0, "בראשית"), (8, 1, 1, 0, "בראשית"), (9, 1, 1, 0, "בראשית")));
        var notes = PerushimNotesService.CreateForTesting(NullPad().Object, storage.Root);
        await using var index = await CreateFixtureIndexAsync(perakim, notes, storage);
        // A catalog without publication years leaves every perush at the
        // fallback ordering: perek, pasuk, insertion order.
        var ordering = new SearchOrdering(SearchSort.Generation, new Dictionary<int, int>());

        var hits = await index.SearchAsync("בראשית", new HashSet<SearchFilter> { SearchFilter.Perush },
            new HashSet<int> { 1 }, 10, TestContext.Current.CancellationToken, null, ordering);

        hits.Select(hit => hit.PerushId).Should().Equal(7, 8, 9);
    }

    [Fact]
    public async Task DeliveredIndex_WithMismatchedNotesFingerprint_StillAdoptsTheVersesTable()
    {
        await using var storage = new TestStorage();
        var perakim = await SeedAsync(storage);
        var source = await perakim.GetSearchConnectionAsync();
        await source.CloseAsync();
        var bibleFile = new FileInfo(Path.Join(storage.Root, BibleDb));
        var verseFingerprint = $"v4:{bibleFile.Length}:{bibleFile.LastWriteTimeUtc.Ticks}:n{SearchText.NormalizationVersion}";
        await storage.CreateDatabaseAsync(NotesDb,
            [.. NotesDbV2.Statements((7, 1, 1, 0, "בראשית")), "INSERT INTO _metadata VALUES ('build_timestamp','42')"]);
        var stagedPath = Path.Join(storage.Root, PerushimNotesService.SearchIndexDbName);
        // The notes side of the staged index belongs to another generation; the
        // verses side is valid — its fingerprint is generated independently.
        var delivered = await storage.CreateDatabaseAsync(PerushimNotesService.SearchIndexDbName,
            [.. DeliveredIndexStatements("v4:999:n1", "סימן מובהק"),
            $"INSERT INTO search_metadata VALUES ('verses','{verseFingerprint}')",
            "CREATE TABLE verses_documents (rowid INTEGER PRIMARY KEY, Text TEXT, PerekId INTEGER, PasukNum INTEGER, PerushId INTEGER, SeferId INTEGER)",
            "INSERT INTO verses_documents VALUES (1,'מְנֻקָּד מִן הַחֶבְרָה',1,1,0,1)",
            "CREATE VIRTUAL TABLE verses USING fts5(Text, content='verses_documents', content_rowid='rowid')",
            "INSERT INTO verses(rowid,Text) VALUES (1,'מנקד מן החברה')",
            "CREATE VIRTUAL TABLE verses_vocab USING fts5vocab(verses, 'row')"]);
        await delivered.CloseAsync();
        var notes = PerushimNotesService.CreateForTesting(NullPad().Object, storage.Root);
        await notes.InitializeAsync();
        await using var index = new SearchIndexService(perakim, notes, Path.Join(storage.Root, "search.sqlite"));

        var hits = await index.SearchAsync("מנקד מן", new HashSet<SearchFilter> { SearchFilter.Pasuk },
            new HashSet<int> { 1 }, 10, TestContext.Current.CancellationToken);

        hits.Should().ContainSingle().Which.Text.Should().Be("מְנֻקָּד מִן הַחֶבְרָה");
        index.CommentaryAvailable.Should().BeFalse();
        File.Exists(stagedPath).Should().BeFalse("the spent staged index is removed");
        var inspection = new SQLite.SQLiteAsyncConnection(Path.Join(storage.Root, "search.sqlite"), SQLite.SQLiteOpenFlags.ReadOnly);
        try
        {
            (await inspection.ExecuteScalarAsync<string>(
                    "SELECT fingerprint FROM search_metadata WHERE name = 'verses'"))
                .Should().Be(verseFingerprint);
            (await inspection.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM verses_vocab"))
                .Should().BeGreaterThan(0);
        }
        finally { await inspection.CloseAsync(); }
        // The mismatched notes half of the staged index is never adopted.
        (await index.SearchAsync("סימן", new HashSet<SearchFilter> { SearchFilter.Perush },
            new HashSet<int> { 1 }, 10, TestContext.Current.CancellationToken)).Should().BeEmpty();
    }

    [Fact]
    public async Task DeliveredIndex_WithMismatchedNotesFingerprint_IsMinedForVersesDuringNotesSearch()
    {
        await using var storage = new TestStorage();
        var perakim = await SeedAsync(storage);
        var source = await perakim.GetSearchConnectionAsync();
        await source.CloseAsync();
        var bibleFile = new FileInfo(Path.Join(storage.Root, BibleDb));
        var verseFingerprint = $"v4:{bibleFile.Length}:{bibleFile.LastWriteTimeUtc.Ticks}:n{SearchText.NormalizationVersion}";
        await storage.CreateDatabaseAsync(NotesDb,
            [.. NotesDbV2.Statements((7, 1, 1, 0, "בראשית")), "INSERT INTO _metadata VALUES ('build_timestamp','42')"]);
        var delivered = await storage.CreateDatabaseAsync(PerushimNotesService.SearchIndexDbName,
            [.. DeliveredIndexStatements("v4:999:n1", "סימן מובהק"),
            $"INSERT INTO search_metadata VALUES ('verses','{verseFingerprint}')",
            "CREATE TABLE verses_documents (rowid INTEGER PRIMARY KEY, Text TEXT, PerekId INTEGER, PasukNum INTEGER, PerushId INTEGER, SeferId INTEGER)",
            "INSERT INTO verses_documents VALUES (1,'מְנֻקָּד מִן הַחֶבְרָה',1,1,0,1)",
            "CREATE VIRTUAL TABLE verses USING fts5(Text, content='verses_documents', content_rowid='rowid')",
            "INSERT INTO verses(rowid,Text) VALUES (1,'מנקד מן החברה')",
            "CREATE VIRTUAL TABLE verses_vocab USING fts5vocab(verses, 'row')"]);
        await delivered.CloseAsync();
        var notes = PerushimNotesService.CreateForTesting(NullPad().Object, storage.Root);
        await using var index = new SearchIndexService(perakim, notes, Path.Join(storage.Root, "search.sqlite"));

        // A commentary-first search must not discard the still-valid verses
        // half of the unadoptable staged index.
        (await index.SearchAsync("סימן", new HashSet<SearchFilter> { SearchFilter.Perush },
            new HashSet<int> { 1 }, 10, TestContext.Current.CancellationToken)).Should().BeEmpty();
        index.CommentaryAvailable.Should().BeFalse();
        File.Exists(Path.Join(storage.Root, PerushimNotesService.SearchIndexDbName))
            .Should().BeFalse("the staged file is removed once mined");

        (await index.SearchAsync("מנקד", new HashSet<SearchFilter> { SearchFilter.Pasuk },
            new HashSet<int> { 1 }, 10, TestContext.Current.CancellationToken))
            .Should().ContainSingle().Which.Text.Should().Be("מְנֻקָּד מִן הַחֶבְרָה");
    }

    [Fact]
    public async Task DeliveredIndex_WithoutUsableNotesPack_StillAdoptsTheVersesTable()
    {
        await using var storage = new TestStorage();
        var perakim = await SeedAsync(storage);
        var source = await perakim.GetSearchConnectionAsync();
        await source.CloseAsync();
        var bibleFile = new FileInfo(Path.Join(storage.Root, BibleDb));
        var verseFingerprint = $"v4:{bibleFile.Length}:{bibleFile.LastWriteTimeUtc.Ticks}:n{SearchText.NormalizationVersion}";
        var stagedPath = Path.Join(storage.Root, PerushimNotesService.SearchIndexDbName);
        // No notes DB at all — only a staged index file carrying a verses table.
        var delivered = await storage.CreateDatabaseAsync(PerushimNotesService.SearchIndexDbName,
            ["CREATE TABLE search_metadata (name TEXT PRIMARY KEY, fingerprint TEXT)",
            $"INSERT INTO search_metadata VALUES ('verses','{verseFingerprint}')",
            "CREATE TABLE verses_documents (rowid INTEGER PRIMARY KEY, Text TEXT, PerekId INTEGER, PasukNum INTEGER, PerushId INTEGER, SeferId INTEGER)",
            "INSERT INTO verses_documents VALUES (1,'מְנֻקָּד מִן הַחֶבְרָה',1,1,0,1)",
            "CREATE VIRTUAL TABLE verses USING fts5(Text, content='verses_documents', content_rowid='rowid')",
            "INSERT INTO verses(rowid,Text) VALUES (1,'מנקד מן החברה')",
            "CREATE VIRTUAL TABLE verses_vocab USING fts5vocab(verses, 'row')"]);
        await delivered.CloseAsync();
        var notes = PerushimNotesService.CreateForTesting(NullPad().Object, storage.Root);
        await notes.InitializeAsync();
        await using var index = new SearchIndexService(perakim, notes, Path.Join(storage.Root, "search.sqlite"));

        var hits = await index.SearchAsync("מנקד", new HashSet<SearchFilter> { SearchFilter.Pasuk },
            new HashSet<int> { 1 }, 10, TestContext.Current.CancellationToken);

        hits.Should().ContainSingle().Which.Text.Should().Be("מְנֻקָּד מִן הַחֶבְרָה");
        File.Exists(stagedPath).Should().BeFalse("the spent staged index is removed");
    }

    [Fact]
    public async Task StagedIndex_WhenVersesIndexAlreadyCurrent_IsDroppedUnopened()
    {
        await using var storage = new TestStorage();
        var perakim = await SeedAsync(storage);
        var indexPath = Path.Join(storage.Root, "search.sqlite");
        var stagedPath = Path.Join(storage.Root, PerushimNotesService.SearchIndexDbName);
        var notes = PerushimNotesService.CreateForTesting(NullPad().Object, storage.Root);
        await notes.InitializeAsync();
        var filters = new HashSet<SearchFilter> { SearchFilter.Pasuk };
        var books = new HashSet<int> { 1 };

        // The first service builds the verses index and publishes its fingerprint.
        await using (var index = new SearchIndexService(perakim, notes, indexPath))
        {
            (await index.SearchAsync("בראשית", filters, books, 10, TestContext.Current.CancellationToken))
                .Should().NotBeEmpty();
        }

        await using (var index = new SearchIndexService(perakim, notes, indexPath))
        {
            // A leftover staged file whose working index is already current is
            // dropped on the stored-fingerprint check — never opened.
            await File.WriteAllTextAsync(stagedPath, "not a database");
            (await index.SearchAsync("בראשית", filters, books, 10, TestContext.Current.CancellationToken))
                .Should().NotBeEmpty();
            File.Exists(stagedPath).Should().BeFalse("the unneeded staged index is removed");

            // With the fingerprint ready in memory, a re-staged file exits
            // before even consulting the stored metadata.
            await File.WriteAllTextAsync(stagedPath, "not a database");
            (await index.SearchAsync("בראשית", filters, books, 10, TestContext.Current.CancellationToken))
                .Should().NotBeEmpty();
            File.Exists(stagedPath).Should().BeFalse();
        }
    }

    [Fact]
    public async Task StagedIndex_ThatIsTheWorkingIndex_IsSkippedBeforeAttach()
    {
        await using var storage = new TestStorage();
        var perakim = await SeedAsync(storage);
        var stagedPath = Path.Join(storage.Root, PerushimNotesService.SearchIndexDbName);
        var notes = PerushimNotesService.CreateForTesting(NullPad().Object, storage.Root);
        // The staged probe and the working index resolve to the same file —
        // adoption must bail before ATTACH-ing the database onto itself.
        var staged = await storage.CreateDatabaseAsync(PerushimNotesService.SearchIndexDbName,
            ["CREATE TABLE search_metadata (name TEXT PRIMARY KEY, fingerprint TEXT)",
             "INSERT INTO search_metadata VALUES ('verses','stale')"]);
        await staged.CloseAsync();
        await using var index = new SearchIndexService(perakim, notes, stagedPath);

        var hits = await index.SearchAsync("בראשית", new HashSet<SearchFilter> { SearchFilter.Pasuk },
            new HashSet<int> { 1 }, 10, TestContext.Current.CancellationToken);

        hits.Should().NotBeEmpty();
    }

    [Fact]
    public async Task DeliveredIndex_WithBrokenVersesTable_FallsBackToTheOnDeviceBuild()
    {
        await using var storage = new TestStorage();
        var perakim = await SeedAsync(storage);
        var source = await perakim.GetSearchConnectionAsync();
        await source.CloseAsync();
        var bibleFile = new FileInfo(Path.Join(storage.Root, BibleDb));
        var verseFingerprint = $"v4:{bibleFile.Length}:{bibleFile.LastWriteTimeUtc.Ticks}:n{SearchText.NormalizationVersion}";
        var stagedPath = Path.Join(storage.Root, PerushimNotesService.SearchIndexDbName);
        // The staged 'verses' fingerprint matches but its documents table is
        // missing — adoption must fail cleanly and the build must run instead.
        var delivered = await storage.CreateDatabaseAsync(PerushimNotesService.SearchIndexDbName,
            [.. DeliveredIndexStatements("v4:999:n1", "סימן מובהק"),
            $"INSERT INTO search_metadata VALUES ('verses','{verseFingerprint}')"]);
        await delivered.CloseAsync();
        await storage.CreateDatabaseAsync(NotesDb,
            [.. NotesDbV2.Statements((7, 1, 1, 0, "בראשית")), "INSERT INTO _metadata VALUES ('build_timestamp','42')"]);
        var notes = PerushimNotesService.CreateForTesting(NullPad().Object, storage.Root);
        await notes.InitializeAsync();
        await using var index = new SearchIndexService(perakim, notes, Path.Join(storage.Root, "search.sqlite"));

        var hits = await index.SearchAsync("בראשית", new HashSet<SearchFilter> { SearchFilter.Pasuk },
            new HashSet<int> { 1 }, 10, TestContext.Current.CancellationToken);

        hits.Should().ContainSingle().Which.PerekId.Should().Be(1);
        File.Exists(stagedPath).Should().BeFalse("the unusable staged index is removed");
        var inspection = new SQLite.SQLiteAsyncConnection(Path.Join(storage.Root, "search.sqlite"), SQLite.SQLiteOpenFlags.ReadOnly);
        try
        {
            (await inspection.ExecuteScalarAsync<string>(
                    "SELECT fingerprint FROM search_metadata WHERE name = 'verses'"))
                .Should().Be(verseFingerprint, "the local build still publishes the fingerprint");
        }
        finally { await inspection.CloseAsync(); }
    }

    private static string[] StagedVersesStatements(string verseFingerprint) =>
    [
        $"INSERT INTO search_metadata VALUES ('verses','{verseFingerprint}')",
        "CREATE TABLE verses_documents (rowid INTEGER PRIMARY KEY, Text TEXT, PerekId INTEGER, PasukNum INTEGER, PerushId INTEGER, SeferId INTEGER)",
        "INSERT INTO verses_documents VALUES (1,'מְנֻקָּד מִן הַחֶבְרָה',1,1,0,1)",
        "CREATE VIRTUAL TABLE verses USING fts5(Text, content='verses_documents', content_rowid='rowid')",
        "INSERT INTO verses(rowid,Text) VALUES (1,'מנקד מן החברה')",
        "CREATE VIRTUAL TABLE verses_vocab USING fts5vocab(verses, 'row')",
    ];

    private static async Task<string> VerseFingerprintAsync(PerekDataService perakim, TestStorage storage)
    {
        var source = await perakim.GetSearchConnectionAsync();
        await source.CloseAsync();
        var bibleFile = new FileInfo(Path.Join(storage.Root, BibleDb));
        return $"v4:{bibleFile.Length}:{bibleFile.LastWriteTimeUtc.Ticks}:n{SearchText.NormalizationVersion}";
    }

    [Fact]
    public async Task StagedIndex_WhileNotesUninitialized_AdoptsVersesAndStaysForTheNotesPath()
    {
        await using var storage = new TestStorage();
        var perakim = await SeedAsync(storage);
        var verseFingerprint = await VerseFingerprintAsync(perakim, storage);
        await storage.CreateDatabaseAsync(NotesDb,
            [.. NotesDbV2.Statements((7, 1, 1, 0, "בראשית")), "INSERT INTO _metadata VALUES ('build_timestamp','42')"]);
        var stagedPath = Path.Join(storage.Root, PerushimNotesService.SearchIndexDbName);
        var delivered = await storage.CreateDatabaseAsync(PerushimNotesService.SearchIndexDbName,
            [.. DeliveredIndexStatements($"v4:42:n{SearchText.NormalizationVersion}", "סימן מובהק"),
            .. StagedVersesStatements(verseFingerprint)]);
        await delivered.CloseAsync();
        var notes = PerushimNotesService.CreateForTesting(NullPad().Object, storage.Root);
        await using var index = new SearchIndexService(perakim, notes, Path.Join(storage.Root, "search.sqlite"));
        var books = new HashSet<int> { 1 };
        var verses = new HashSet<SearchFilter> { SearchFilter.Pasuk };

        (await index.SearchAsync("מנקד", verses, books, 10, TestContext.Current.CancellationToken))
            .Should().ContainSingle().Which.Text.Should().Be("מְנֻקָּד מִן הַחֶבְרָה");
        File.Exists(stagedPath).Should().BeTrue("the notes half is still undetermined and may be adopted");

        (await index.SearchAsync("סימן", new HashSet<SearchFilter> { SearchFilter.Perush }, books, 10,
            TestContext.Current.CancellationToken)).Should().ContainSingle().Which.PerushId.Should().Be(7);
        File.Exists(stagedPath).Should().BeFalse("whole-file adoption moves the staged index into place");
        // The adopted file carries the same verses table — served without an on-device rebuild.
        (await index.SearchAsync("מנקד", verses, books, 10, TestContext.Current.CancellationToken))
            .Should().ContainSingle().Which.Text.Should().Be("מְנֻקָּד מִן הַחֶבְרָה");
    }

    [Fact]
    public async Task StagedIndex_DuringPackInstallation_IsKeptUntilNotesSettle()
    {
        await using var storage = new TestStorage();
        var perakim = await SeedAsync(storage);
        var verseFingerprint = await VerseFingerprintAsync(perakim, storage);
        var stagedPath = Path.Join(storage.Root, PerushimNotesService.SearchIndexDbName);
        var delivered = await storage.CreateDatabaseAsync(PerushimNotesService.SearchIndexDbName,
            [.. DeliveredIndexStatements("v4:42:n1", "סימן מובהק"), .. StagedVersesStatements(verseFingerprint)]);
        await delivered.CloseAsync();
        var packLookup = new TaskCompletionSource<string?>(TaskCreationOptions.RunContinuationsAsynchronously);
        var delivery = new Mock<IPadDeliveryService>();
        delivery.Setup(service => service.TryGetAssetPathAsync(It.IsAny<string>(), It.IsAny<CancellationToken>()))
            .Returns(packLookup.Task);
        var notes = PerushimNotesService.CreateForTesting(delivery.Object, storage.Root);
        // Initialization holds the pack while delivery is still being resolved.
        var installing = notes.InitializeAsync();
        var index = new SearchIndexService(perakim, notes, Path.Join(storage.Root, "search.sqlite"));
        var books = new HashSet<int> { 1 };
        var verses = new HashSet<SearchFilter> { SearchFilter.Pasuk };

        (await index.SearchAsync("מנקד", verses, books, 10, TestContext.Current.CancellationToken))
            .Should().ContainSingle().Which.Text.Should().Be("מְנֻקָּד מִן הַחֶבְרָה");
        File.Exists(stagedPath).Should().BeTrue("verse search must not race pack installation");

        packLookup.SetResult(null);
        await installing;
        // No further search: the cleanup scheduled by the first one settles the file.
        await index.DisposeAsync();
        File.Exists(stagedPath).Should().BeFalse("no notes pack arrived, so the staged index is spent");
    }

    [Fact]
    public async Task StagedIndex_KeptWhileNotesUninitialized_IsRemovedWhenInitializationFindsNoPack()
    {
        await using var storage = new TestStorage();
        var perakim = await SeedAsync(storage);
        var verseFingerprint = await VerseFingerprintAsync(perakim, storage);
        var stagedPath = Path.Join(storage.Root, PerushimNotesService.SearchIndexDbName);
        var delivered = await storage.CreateDatabaseAsync(PerushimNotesService.SearchIndexDbName,
            [.. DeliveredIndexStatements("v4:42:n1", "סימן מובהק"), .. StagedVersesStatements(verseFingerprint)]);
        await delivered.CloseAsync();
        var notes = PerushimNotesService.CreateForTesting(NullPad().Object, storage.Root);
        var index = new SearchIndexService(perakim, notes, Path.Join(storage.Root, "search.sqlite"));

        (await index.SearchAsync("מנקד", new HashSet<SearchFilter> { SearchFilter.Pasuk },
            new HashSet<int> { 1 }, 10, TestContext.Current.CancellationToken)).Should().ContainSingle();
        File.Exists(stagedPath).Should().BeTrue("notes were never initialized");

        // The app initializes notes on its own schedule; no search follows.
        await notes.InitializeAsync();
        await index.DisposeAsync();
        File.Exists(stagedPath).Should().BeFalse("initialization settled notes as missing");
    }

    [Fact]
    public async Task StagedIndex_KeptDuringFailedDownload_IsRemovedWhenTheDownloadEnds()
    {
        await using var storage = new TestStorage();
        var perakim = await SeedAsync(storage);
        var verseFingerprint = await VerseFingerprintAsync(perakim, storage);
        var fetch = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
        var delivery = NullPad();
        delivery.Setup(service => service.FetchAsync(It.IsAny<string>(), It.IsAny<IProgress<double>?>(),
            It.IsAny<CancellationToken>())).Returns(fetch.Task);
        var notes = PerushimNotesService.CreateForTesting(delivery.Object, storage.Root);
        await notes.InitializeAsync();
        var downloading = notes.TryDownloadNotesAsync();
        var stagedPath = Path.Join(storage.Root, PerushimNotesService.SearchIndexDbName);
        var delivered = await storage.CreateDatabaseAsync(PerushimNotesService.SearchIndexDbName,
            [.. DeliveredIndexStatements("v4:42:n1", "סימן מובהק"), .. StagedVersesStatements(verseFingerprint)]);
        await delivered.CloseAsync();
        var index = new SearchIndexService(perakim, notes, Path.Join(storage.Root, "search.sqlite"));

        (await index.SearchAsync("מנקד", new HashSet<SearchFilter> { SearchFilter.Pasuk },
            new HashSet<int> { 1 }, 10, TestContext.Current.CancellationToken)).Should().ContainSingle();
        File.Exists(stagedPath).Should().BeTrue("the download may still install a matching pack");

        fetch.SetResult(false);
        (await downloading).Should().BeFalse();
        await index.DisposeAsync();
        File.Exists(stagedPath).Should().BeFalse("the failed download settled notes as missing");
    }

    [Fact]
    public async Task StagedIndex_AfterNotesRejection_IsRemovedOnceVersesAreAdopted()
    {
        await using var storage = new TestStorage();
        var perakim = await SeedAsync(storage);
        var verseFingerprint = await VerseFingerprintAsync(perakim, storage);
        // A legacy pack without schema_version is rejected by validation.
        await storage.CreateDatabaseAsync(NotesDb, "CREATE TABLE note_blob (perek_id INTEGER, data BLOB)");
        var notes = PerushimNotesService.CreateForTesting(NullPad().Object, storage.Root);
        await notes.InitializeAsync();
        notes.IsAvailable.Should().BeFalse();
        // The staged index can outlive its rejected pack (rejection races, partial cleanup).
        var stagedPath = Path.Join(storage.Root, PerushimNotesService.SearchIndexDbName);
        var delivered = await storage.CreateDatabaseAsync(PerushimNotesService.SearchIndexDbName,
            [.. DeliveredIndexStatements("v4:42:n1", "סימן מובהק"), .. StagedVersesStatements(verseFingerprint)]);
        await delivered.CloseAsync();
        await using var index = new SearchIndexService(perakim, notes, Path.Join(storage.Root, "search.sqlite"));

        (await index.SearchAsync("מנקד", new HashSet<SearchFilter> { SearchFilter.Pasuk },
            new HashSet<int> { 1 }, 10, TestContext.Current.CancellationToken))
            .Should().ContainSingle().Which.Text.Should().Be("מְנֻקָּד מִן הַחֶבְרָה");
        File.Exists(stagedPath).Should().BeFalse("the rejected pack settles notes, so the file is spent");
    }

    [Fact]
    public void VerseImport_ParallelPreparationMatchesTheSerialTransform()
    {
        var rows = Enumerable.Range(1, 300)
            .Select(n => new SearchIndexService.IndexRow
            {
                PerekId = n,
                PasukNum = n,
                PerushId = 0,
                Body = n % 5 == 0 ? $"<b>פסוק</b> &amp; {n}" : $"פָּסוּק מְנֻקָּד {n}",
            })
            .ToList();
        int? SeferOf(int perekId) => perekId == 13 ? null : perekId % 4;

        var prepared = SearchIndexService.PrepareVersesForImport(rows, SeferOf);

        prepared.Should().HaveCount(rows.Count);
        for (var i = 0; i < rows.Count; i++)
        {
            var expected = SeferOf(rows[i].PerekId) is { } seferId
                ? new SearchIndexService.PreparedVerse(
                    SearchText.PlainText(rows[i].Body),
                    SearchText.Normalize(SearchText.PlainText(rows[i].Body)),
                    rows[i].PerekId, rows[i].PasukNum, rows[i].PerushId, seferId)
                : (SearchIndexService.PreparedVerse?)null;
            prepared[i].Should().Be(expected, "row {0} must match the serial PlainText + Normalize + sefer resolution", i);
        }
    }

    private sealed class SourceBlobRow
    {
        public int PerekId { get; set; }
        public byte[] Data { get; set; } = [];
    }
    /// <summary>Test bootstrap creates the same delivery boundary the production data pipeline supplies.</summary>
    private static async Task<SearchIndexService> CreateFixtureIndexAsync(PerekDataService perakim,
        PerushimNotesService notes, TestStorage storage)
    {
        await perakim.LoadAsync();
        var source = (await notes.GetSearchConnectionAsync())!;
        string? generation = null;
        try { generation = await source.ExecuteScalarAsync<string>("SELECT value FROM _metadata WHERE key = 'build_timestamp'"); }
        catch (SQLite.SQLiteException) { generation = string.Empty; }
        if (string.IsNullOrEmpty(generation))
        {
            var file = new FileInfo(source.DatabasePath);
            generation = $"{file.Length}:{file.LastWriteTimeUtc.Ticks}";
        }
        var fixture = await storage.CreateDatabaseAsync(PerushimNotesService.SearchIndexDbName,
            "CREATE TABLE search_metadata (name TEXT PRIMARY KEY, fingerprint TEXT)",
            "CREATE TABLE notes_documents (rowid INTEGER PRIMARY KEY, Text TEXT, PerekId INTEGER, PasukNum INTEGER, PerushId INTEGER, SeferId INTEGER)",
            "CREATE VIRTUAL TABLE notes USING fts5(Text, content='notes_documents', content_rowid='rowid')",
            "CREATE VIRTUAL TABLE notes_vocab USING fts5vocab(notes, 'row')");
        await fixture.ExecuteAsync("INSERT INTO search_metadata VALUES ('notes', ?)",
            $"v4:{generation}:n{SearchText.NormalizationVersion}");
        var blobs = await source.QueryAsync<FixtureBlob>("SELECT perek_id AS PerekId, data AS Data FROM note_blob ORDER BY perek_id");
        await fixture.RunInTransactionAsync(connection =>
        {
            long row = 0;
            foreach (var blob in blobs)
            {
                var perek = perakim.GetPerek(blob.PerekId);
                if (perek == null) { continue; }
                foreach (var note in PerushNoteBlob.Decode(blob.Data))
                {
                    var text = SearchText.PlainText(note.Content);
                    connection.Execute("INSERT INTO notes_documents VALUES (?, ?, ?, ?, ?, ?)",
                        ++row, text, blob.PerekId, note.Pasuk, note.PerushId, perek.SeferId);
                    connection.Execute("INSERT INTO notes(rowid, Text) VALUES (?, ?)", row, SearchText.Normalize(text));
                }
            }
        });
        await fixture.CloseAsync();
        return new SearchIndexService(perakim, notes, Path.Join(storage.Root, "search.sqlite"));
    }

    private sealed class FixtureBlob
    {
        public int PerekId { get; set; }
        public byte[] Data { get; set; } = [];
    }

}
