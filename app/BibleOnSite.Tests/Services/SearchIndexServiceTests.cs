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
    public async Task HebrewSearch_IgnoresVowels_RequiresEveryWord_AndFiltersBeforeLimiting()
    {
        await using var storage = new TestStorage();
        var perakim = await SeedAsync(storage);
        await using var index = new SearchIndexService(perakim, null, Path.Combine(storage.Root, "search.sqlite"));
        var filters = new HashSet<SearchFilter> { SearchFilter.Pasuk };
        var books = new HashSet<int> { 1, 2 };
        var hits = await index.SearchAsync("ברא אלהים", filters, books, 10, default);
        hits.Should().HaveCount(3);
        hits.Should().Contain(hit => hit.PerekId == 1 && hit.Text.Contains("בָּרָ֣א"));
        (await index.SearchAsync("ברא אלהים", filters, new HashSet<int> { 2 }, 1, default)).Should().ContainSingle().Which.PerekId.Should().Be(3);
        (await index.SearchAsync("ברא ירח", filters, books, 10, default)).Should().BeEmpty();
        (await index.SearchAsync("ברא", filters, new HashSet<int>(), 10, default)).Should().BeEmpty();
        (await index.SearchAsync("\" OR * -", filters, books, 10, default)).Should().BeEmpty();
    }

    [Theory]
    [InlineData(1)]
    [InlineData(2)]
    public async Task LegacyIndex_IsRebuiltAndKeepsOriginalScriptureInExternalContent(int version)
    {
        await using var storage = new TestStorage();
        var perakim = await SeedAsync(storage);
        var path = Path.Combine(storage.Root, "search.sqlite");
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
        var source = new FileInfo(Path.Combine(storage.Root, BibleDb));
        await legacy.ExecuteAsync("INSERT INTO search_metadata VALUES ('verses', ?)", $"v{version}:{source.Length}:{source.LastWriteTimeUtc.Ticks}");
        await legacy.RunInTransactionAsync(connection =>
            SQLitePCL.raw.sqlite3_db_config(connection.Handle, SQLitePCL.raw.SQLITE_DBCONFIG_DEFENSIVE, 1, out _)
                .Should().Be(SQLitePCL.raw.SQLITE_OK));
        await using var index = new SearchIndexService(perakim, null, path);
        var hits = await index.SearchAsync("בראשית", new HashSet<SearchFilter> { SearchFilter.Pasuk }, new HashSet<int> { 1 }, 10, default);
        hits.Should().ContainSingle().Which.Text.Should().Contain("בְּרֵאשִׁ֖ית");
        (await legacy.ExecuteScalarAsync<string>("SELECT Text FROM verses_documents WHERE PerekId = 1"))
            .Should().Contain("בְּרֵאשִׁ֖ית");
        (await legacy.ExecuteScalarAsync<string>("SELECT fingerprint FROM search_metadata WHERE name = 'verses'"))
            .Should().StartWith("v3:");
        (await index.SearchAsync("ישן", new HashSet<SearchFilter> { SearchFilter.Pasuk }, new HashSet<int> { 1 }, 10, default))
            .Should().BeEmpty("a migrated cache cannot retain stale search results");
    }

    [Fact]
    public async Task DefensiveSqlite_CanBuildAndSearchBothExternalContentIndexes()
    {
        await using var storage = new TestStorage();
        var perakim = await SeedAsync(storage);
        await storage.CreateDatabaseAsync(NotesDb,
            "CREATE TABLE note (perush_id INTEGER,perek_id INTEGER,pasuk INTEGER,note_idx INTEGER,note_content TEXT)",
            "INSERT INTO note VALUES (7,1,1,0,'בראשית ברא אלהים')");
        var inspection = await storage.CreateDatabaseAsync("search.sqlite");
        await inspection.RunInTransactionAsync(connection =>
        {
            SQLitePCL.raw.sqlite3_db_config(connection.Handle, SQLitePCL.raw.SQLITE_DBCONFIG_DEFENSIVE, 1, out var enabled)
                .Should().Be(SQLitePCL.raw.SQLITE_OK);
            enabled.Should().Be(1);
        });
        var delivery = new Mock<IPadDeliveryService>();
        delivery.Setup(service => service.TryGetAssetPathAsync(It.IsAny<string>(), It.IsAny<CancellationToken>())).ReturnsAsync((string?)null);
        var notes = PerushimNotesService.CreateForTesting(delivery.Object, storage.Root);
        await using var index = new SearchIndexService(perakim, notes, Path.Combine(storage.Root, "search.sqlite"));
        var hits = await index.SearchAsync("בראשית ברא אלהים",
            new HashSet<SearchFilter> { SearchFilter.Pasuk, SearchFilter.Perush }, new HashSet<int> { 1 }, 10, default);
        hits.Should().HaveCount(2);
        hits.Should().Contain(hit => hit.Type == SearchFilter.Pasuk && hit.PerekId == 1);
        hits.Should().Contain(hit => hit.Type == SearchFilter.Perush && hit.PerushId == 7);
    }

    [Fact]
    public async Task Search_UsesLevenshteinFallback_AndReusesCompletedIndex()
    {
        await using var storage = new TestStorage();
        var perakim = await SeedAsync(storage);
        var path = Path.Combine(storage.Root, "search.sqlite");
        var filters = new HashSet<SearchFilter> { SearchFilter.Pasuk };
        var books = new HashSet<int> { 1 };
        await using (var index = new SearchIndexService(perakim, null, path))
        {
            var hits = await index.SearchAsync("בראשיט", filters, books, 10, default);
            hits.Should().ContainSingle().Which.PerekId.Should().Be(1);
        }
        await using var reopened = new SearchIndexService(perakim, null, path);
        (await reopened.SearchAsync("בראשית", filters, books, 10, default)).Should().ContainSingle();
        var unchanged = new FileInfo(path).LastWriteTimeUtc;
        await reopened.SearchAsync("אלהים", filters, books, 10, default);
        new FileInfo(path).LastWriteTimeUtc.Should().Be(unchanged);
    }

    [Fact]
    public async Task CommentarySearch_StripsHtml_RespectsBooks_AndReturnsNavigationIds()
    {
        await using var storage = new TestStorage();
        var perakim = await SeedAsync(storage);
        var notesDb = await storage.CreateDatabaseAsync(NotesDb,
            "CREATE TABLE note (perush_id INTEGER,perek_id INTEGER,pasuk INTEGER,note_idx INTEGER,note_content TEXT)",
            "INSERT INTO note VALUES (7,1,1,0,'<b>בריאת</b> הָעוֹלָם'),(8,3,1,0,'בריאת העולם')");
        var delivery = new Mock<IPadDeliveryService>();
        delivery.Setup(service => service.TryGetAssetPathAsync(It.IsAny<string>(), It.IsAny<CancellationToken>())).ReturnsAsync((string?)null);
        var notes = PerushimNotesService.CreateForTesting(delivery.Object, storage.Root);
        await using var index = new SearchIndexService(perakim, notes, Path.Combine(storage.Root, "search.sqlite"));
        var hits = await index.SearchAsync("בריאת העולם", new HashSet<SearchFilter> { SearchFilter.Perush }, new HashSet<int> { 1 }, 10, default);
        index.CommentaryAvailable.Should().BeTrue();
        hits.Should().ContainSingle();
        hits[0].PerushId.Should().Be(7);
        hits[0].PasukNum.Should().Be(1);
        hits[0].PerekId.Should().Be(1);
        hits[0].Text.Should().NotContain("<b>");
        (await notesDb.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM note")).Should().Be(2, "search must not alter source content");
        var vm = new SearchViewModel(perakim, index) { SearchPhrase = "בריאת העולם" };
        vm.SetPerushim([new Perush { Id = 7, Name = "רש\"י" }]);
        await vm.SearchAsync();
        vm.SearchResults.OfType<PerushSearchResult>().Should().Contain(result => result.Title == "רש\"י - בראשית א א");
    }

    [Fact]
    public async Task ViewModel_AppliesOneGlobalLimit_AndShowsMissingCommentaryHint()
    {
        await using var storage = new TestStorage();
        var perakim = await SeedAsync(storage);
        await using var index = new SearchIndexService(perakim, null, Path.Combine(storage.Root, "search.sqlite"));
        var vm = new SearchViewModel(perakim, index) { SearchPhrase = "בראשית", ResultsLimit = 2 };
        vm.SetAuthors([new Author { Id = 1, Name = "הרב בראשית", Details = "<i>תיאור</i>" }]);
        await vm.SearchAsync();
        vm.SearchResults.Should().HaveCount(2);
        vm.SearchResults.First().Should().BeOfType<AuthorSearchResult>();
        vm.AvailabilityMessage.Should().Contain("בהגדרות");
        vm.SearchResults.Should().OnlyContain(result => !string.IsNullOrEmpty(result.Title));
        vm.SearchPhrase = "   ";
        await vm.SearchAsync();
        vm.SearchResults.Should().BeEmpty();
        vm.IsLoading.Should().BeFalse();
        vm.AvailabilityMessage.Should().BeEmpty();
    }

    [Fact]
    public async Task ViewModel_CancelledQueryCannotOverwriteTheNextQuery()
    {
        await using var storage = new TestStorage();
        var perakim = await SeedAsync(storage);
        await using var index = new SearchIndexService(perakim, null, Path.Combine(storage.Root, "search.sqlite"));
        var vm = new SearchViewModel(perakim, index) { SearchPhrase = "בראשית" };
        vm.SetFilterEnabled(SearchFilter.Perush, false);
        var previous = vm.SearchAsync();
        vm.SearchPhrase = "שמות 1";
        await vm.SearchAsync();
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
        await using var index = new SearchIndexService(perakim, null, Path.Combine(storage.Root, "search.sqlite"));
        var hits = await index.SearchAsync("ברא", new HashSet<SearchFilter> { SearchFilter.Pasuk }, new HashSet<int> { 1 }, 1, default);
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
        await using var index = new SearchIndexService(perakim, notes, Path.Combine(storage.Root, "search.sqlite"));
        var books = new HashSet<int> { 1 };
        var verses = new HashSet<SearchFilter> { SearchFilter.Pasuk };
        await index.SearchAsync("בראשית", verses, books, 10, default);
        var commentary = index.SearchAsync("בראשית", new HashSet<SearchFilter> { SearchFilter.Perush }, books, 10, default);
        try
        {
            await entered.Task.WaitAsync(TimeSpan.FromSeconds(5));
            (await index.SearchAsync("בראשית", verses, books, 10, default).WaitAsync(TimeSpan.FromSeconds(5)))
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
            "CREATE TABLE note (perush_id INTEGER,perek_id INTEGER,pasuk INTEGER,note_idx INTEGER,note_content TEXT)",
            "INSERT INTO note VALUES (7,1,1,0,'אמר משה'),(8,1,1,0,'אמר הרב משה')");
        var delivery = new Mock<IPadDeliveryService>();
        delivery.Setup(service => service.TryGetAssetPathAsync(It.IsAny<string>(), It.IsAny<CancellationToken>())).ReturnsAsync((string?)null);
        var notes = PerushimNotesService.CreateForTesting(delivery.Object, storage.Root);
        await using var index = new SearchIndexService(perakim, notes, Path.Combine(storage.Root, "search.sqlite"));
        var vm = new SearchViewModel(perakim, index) { SearchPhrase = "הרב משה" };
        vm.SetFilterEnabled(SearchFilter.Author, false);
        vm.SetFilterEnabled(SearchFilter.Pasuk, false);
        vm.SetFilterEnabled(SearchFilter.Perek, false);
        await vm.SearchAsync();
        vm.SearchResults.Should().ContainSingle().Which.Should().BeOfType<PerushSearchResult>()
            .Which.PerushId.Should().Be("8");
    }
}
