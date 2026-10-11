using BibleOnSite.Models;
using BibleOnSite.Services;
using BibleOnSite.Tests.Support;
using BibleOnSite.ViewModels;
using Moq;

namespace BibleOnSite.Tests.ViewModels;

public class TanahpediaViewModelTests
{
    private readonly Mock<ITanahpediaService> _service = new();
    private readonly Mock<IAppNavigator> _navigator = new();

    private TanahpediaViewModel Create() => new(_service.Object, _navigator.Object);

    [Fact]
    public async Task Load_PopulatesCountsTodayAndRecent()
    {
        _service.Setup(s => s.GetCategoryCountsAsync(It.IsAny<CancellationToken>()))
            .ReturnsAsync([new TanahpediaCategoryCount { Category = "PERSON", Count = 12 }]);
        _service.Setup(s => s.GetRecentEntriesAsync(It.IsAny<int>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync([new TanahpediaEntry { UniqueName = "שמשון", Title = "שמשון" }]);
        _service.Setup(s => s.GetTodayEntitiesAsync(It.IsAny<int>(), It.IsAny<int>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync([new TanahpediaEntityWithEntries { EntityName = "מתתיהו" }]);

        var vm = Create();
        await vm.LoadAsync();

        vm.IsLoaded.Should().BeTrue();
        vm.HasError.Should().BeFalse();
        vm.TodayEntities.Should().ContainSingle();
        vm.RecentEntries.Should().ContainSingle();
        vm.CategoryGroups.Should().HaveCount(TanahpediaTaxonomy.Hierarchy.Count);
        vm.CategoryGroups.First(g => g.Parent.Category.Key == "PERSON").Parent.Count.Should().Be(12);
        vm.CategoryGroups.First(g => g.Parent.Category.Key == "PLACE").Parent.Count.Should().Be(0);
    }

    [Fact]
    public async Task Load_ShowsErrorOnFailure()
    {
        _service.Setup(s => s.GetCategoryCountsAsync(It.IsAny<CancellationToken>()))
            .ThrowsAsync(new InvalidOperationException("offline"));

        var vm = Create();
        await vm.LoadAsync();

        vm.IsLoading.Should().BeFalse();
        vm.IsLoaded.Should().BeFalse();
        vm.HasError.Should().BeTrue();
    }

    [Fact]
    public async Task OpenCategory_NavigatesWithSubFilter()
    {
        var vm = Create();
        var king = TanahpediaTaxonomy.Find("KING")!;

        await vm.OpenCategoryAsync(new TanahpediaCategoryItem { Category = king });

        _navigator.Verify(n => n.GoToAsync(
            It.Is<string>(r => r.StartsWith("tanahpediaCategory") &&
                r.Contains("key=KING") && r.Contains("entityType=PERSON") && r.Contains("sub=KING"))),
            Times.Once);
    }

    [Fact]
    public async Task OpenEntry_NavigatesToEntryRoute()
    {
        var vm = Create();

        await vm.OpenEntryAsync("שמשון");

        _navigator.Verify(n => n.GoToAsync(
            It.Is<string>(r => r.StartsWith("tanahpediaEntry") && r.Contains("uniqueName="))), Times.Once);
    }
}

public class TanahpediaEntityTypeViewModelTests
{
    private readonly Mock<ITanahpediaService> _service = new();
    private readonly Mock<IAppNavigator> _navigator = new();

    private TanahpediaEntityTypeViewModel Create() => new(_service.Object, _navigator.Object);

    [Fact]
    public async Task Load_MapsListingAndHomepage()
    {
        _service.Setup(s => s.GetCategoryHomepageAsync("PLACE", It.IsAny<CancellationToken>()))
            .ReturnsAsync(new TanahpediaCategoryHomepage
            {
                EntityType = "PLACE",
                LayoutType = "MAP",
                Content = "<p>מבוא</p>",
            });
        _service.Setup(s => s.GetEntitiesWithEntriesAsync("PLACE", null, It.IsAny<CancellationToken>()))
            .ReturnsAsync([
                new TanahpediaEntityWithEntries
                {
                    EntityName = "ירושלים",
                    LinkedEntries = [new TanahpediaEntryStub { UniqueName = "ירושלים", Title = "ירושלים" }],
                },
            ]);

        var vm = Create();
        vm.CategoryKey = "PLACE";
        vm.EntityType = "PLACE";
        await vm.LoadAsync();

        vm.IsLoaded.Should().BeTrue();
        vm.Title.Should().Be("מקומות");
        vm.LayoutType.Should().Be("MAP");
        vm.IntroContent.Should().Be("<p>מבוא</p>");
        vm.Entities.Should().ContainSingle()
            .Which.IsSingleLink.Should().BeTrue();
    }

    [Fact]
    public async Task Load_SurvivesHomepageFailure()
    {
        _service.Setup(s => s.GetCategoryHomepageAsync(It.IsAny<string>(), It.IsAny<CancellationToken>()))
            .ThrowsAsync(new InvalidOperationException("missing table"));
        _service.Setup(s => s.GetEntitiesWithEntriesAsync("ANIMAL", "TAHOR", It.IsAny<CancellationToken>()))
            .ReturnsAsync([new TanahpediaEntityWithEntries { EntityName = "שור" }]);

        var vm = Create();
        vm.CategoryKey = "TAHOR";
        vm.EntityType = "ANIMAL";
        vm.Sub = "TAHOR";
        await vm.LoadAsync();

        vm.IsLoaded.Should().BeTrue();
        vm.HasError.Should().BeFalse();
        vm.IntroContent.Should().BeNull();
        vm.Entities.Should().ContainSingle()
            .Which.ShowNoEntryBadge.Should().BeTrue();
    }

    [Fact]
    public async Task Load_ShowsErrorWhenListingFails()
    {
        _service.Setup(s => s.GetCategoryHomepageAsync(It.IsAny<string>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync((TanahpediaCategoryHomepage?)null);
        _service.Setup(s => s.GetEntitiesWithEntriesAsync(It.IsAny<string>(), It.IsAny<string?>(), It.IsAny<CancellationToken>()))
            .ThrowsAsync(new InvalidOperationException("offline"));

        var vm = Create();
        vm.EntityType = "PERSON";
        await vm.LoadAsync();

        vm.HasError.Should().BeTrue();
        vm.IsLoaded.Should().BeFalse();
    }

    [Fact]
    public void Title_UsesSubCategoryLabel()
    {
        var vm = Create();
        vm.CategoryKey = "TAHOR";
        vm.EntityType = "ANIMAL";
        vm.Title.Should().Be("טהורים");
    }
}

public class TanahpediaEntryViewModelTests
{
    private const string DbName = "sefaria-dump-5784-sivan-4.tanah_view.sqlite";

    private readonly Mock<ITanahpediaService> _service = new();
    private readonly Mock<IAppNavigator> _navigator = new();

    private TanahpediaEntryViewModel Create(PerekDataService? perekData = null) =>
        new(_service.Object, _navigator.Object, perekData ?? EmptyPerekData());

    private static PerekDataService EmptyPerekData()
    {
        // No package database — LoadAsync fails and occurrences stay empty.
        var storage = new TestStorage();
        return new PerekDataService(new LocalDatabaseService(storage.FileSystem.Object));
    }

    private static async Task<(PerekDataService Data, TestStorage Storage)> PerekDataWithPerek250Async()
    {
        var storage = new TestStorage();
        var db = await storage.CreateDatabaseAsync(DbName,
            "CREATE TABLE tanah_sefer (id INTEGER, name TEXT, tanach_us_name TEXT, perek_id_from INTEGER, perek_id_to INTEGER)",
            "CREATE TABLE tanah_perek (id INTEGER, perek INTEGER, header TEXT)",
            "CREATE TABLE tanah_additional (id INTEGER, sefer_id INTEGER, perek_from INTEGER, perek_to INTEGER, letter TEXT, tanach_us_name TEXT)",
            "CREATE TABLE tanah_perek_date (perek_id INTEGER, cycle INTEGER, date TEXT, hebdate TEXT, star_rise TEXT)",
            "CREATE TABLE tanah_pasuk_segment (id INTEGER, perek_id INTEGER, pasuk_id INTEGER, segment_type TEXT)",
            "CREATE TABLE tanah_pasuk_segment_value (id INTEGER, value TEXT)",
            "CREATE TABLE tanah_pasuk_segment_qri_ktiv_offset (id INTEGER, qri_ktiv_offset INTEGER)");
        // שופטים covers perek ids 235-253 → perek 250 is chapter טז.
        await db.ExecuteAsync("INSERT INTO tanah_sefer VALUES (16,'שופטים','Judges',235,253)");
        await db.ExecuteAsync("INSERT INTO tanah_perek VALUES (250,16,NULL)");
        await db.ExecuteAsync("INSERT INTO tanah_pasuk_segment VALUES (1,250,3,'qri'),(2,250,3,'qri')");
        await db.ExecuteAsync("INSERT INTO tanah_pasuk_segment_value VALUES (1,'וַיָּקׇם'),(2,'שִׁמְשׁוֹן')");
        var data = new PerekDataService(new LocalDatabaseService(storage.FileSystem.Object));
        return (data, storage);
    }

    [Fact]
    public async Task Load_Entry_MapsDetailAndOccurrences()
    {
        var (perekData, storage) = await PerekDataWithPerek250Async();
        await using var _ = storage;

        _service.Setup(s => s.GetEntryDetailAsync("שמשון", It.IsAny<CancellationToken>()))
            .ReturnsAsync(new TanahpediaEntryDetail
            {
                UniqueName = "שמשון",
                Title = "שמשון הגיבור",
                Content = "<p>שופט</p>",
                Entities = [new TanahpediaLinkedEntity { EntityType = "PERSON", EntityName = "שמשון" }],
                Occurrences = [new TanahpediaEntryOccurrence { PerekId = 250, PasukNumber = 3 }],
            });

        var vm = Create(perekData);
        vm.UniqueName = "שמשון";
        await vm.LoadAsync();

        vm.ShowEntry.Should().BeTrue();
        vm.Title.Should().Be("שמשון הגיבור");
        vm.HasContent.Should().BeTrue();
        vm.Entities.Should().ContainSingle();
        vm.Occurrences.Should().ContainSingle();
        var occurrence = vm.Occurrences[0];
        occurrence.Citation.Should().Be("שופטים טז ג");
        occurrence.VerseText.Should().Be("וַיָּקׇם שִׁמְשׁוֹן");
    }

    [Fact]
    public async Task Load_Alias_LoadsCanonicalEntry()
    {
        _service.Setup(s => s.GetEntryDetailAsync("שמשון-הגיבור", It.IsAny<CancellationToken>()))
            .ReturnsAsync((TanahpediaEntryDetail?)null);
        _service.Setup(s => s.GetSynonymTargetsAsync("שמשון-הגיבור", It.IsAny<CancellationToken>()))
            .ReturnsAsync([new TanahpediaSynonymTarget { UniqueName = "שמשון", Title = "שמשון" }]);
        _service.Setup(s => s.GetEntryDetailAsync("שמשון", It.IsAny<CancellationToken>()))
            .ReturnsAsync(new TanahpediaEntryDetail { UniqueName = "שמשון", Title = "שמשון" });

        var vm = Create();
        vm.UniqueName = "שמשון-הגיבור";
        await vm.LoadAsync();

        vm.ShowEntry.Should().BeTrue();
        vm.Title.Should().Be("שמשון");
        vm.IsDisambiguation.Should().BeFalse();
        vm.IsNotFound.Should().BeFalse();
    }

    [Fact]
    public async Task Load_AmbiguousName_ShowsDisambiguation()
    {
        _service.Setup(s => s.GetEntryDetailAsync("דתן", It.IsAny<CancellationToken>()))
            .ReturnsAsync((TanahpediaEntryDetail?)null);
        _service.Setup(s => s.GetSynonymTargetsAsync("דתן", It.IsAny<CancellationToken>()))
            .ReturnsAsync([
                new TanahpediaSynonymTarget { UniqueName = "דתן", Title = "דתן" },
                new TanahpediaSynonymTarget { UniqueName = "דתן-ואבירם", Title = "דתן ואבירם", Label = "בני קרח" },
            ]);

        var vm = Create();
        vm.UniqueName = "דתן";
        await vm.LoadAsync();

        vm.IsDisambiguation.Should().BeTrue();
        vm.IsNotFound.Should().BeFalse();
        vm.ShowEntry.Should().BeFalse();
        vm.SynonymTargets.Should().HaveCount(2);
    }

    [Fact]
    public async Task Load_UnknownName_ShowsNotFound()
    {
        _service.Setup(s => s.GetEntryDetailAsync(It.IsAny<string>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync((TanahpediaEntryDetail?)null);
        _service.Setup(s => s.GetSynonymTargetsAsync(It.IsAny<string>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync([]);

        var vm = Create();
        vm.UniqueName = "אין-כזה";
        await vm.LoadAsync();

        vm.IsNotFound.Should().BeTrue();
        vm.IsDisambiguation.Should().BeFalse();
        vm.IsLoaded.Should().BeTrue();
        vm.HasError.Should().BeFalse();
    }

    [Fact]
    public async Task Load_ShowsErrorOnFailure()
    {
        _service.Setup(s => s.GetEntryDetailAsync(It.IsAny<string>(), It.IsAny<CancellationToken>()))
            .ThrowsAsync(new InvalidOperationException("offline"));

        var vm = Create();
        vm.UniqueName = "שמשון";
        await vm.LoadAsync();

        vm.HasError.Should().BeTrue();
        vm.IsLoaded.Should().BeFalse();
    }

    [Fact]
    public async Task OpenEntityCategory_NavigatesToCategoryRoute()
    {
        var vm = Create();

        await vm.OpenEntityCategoryAsync(new TanahpediaLinkedEntity { EntityType = "PLACE", EntityName = "ירושלים" });

        _navigator.Verify(n => n.GoToAsync(
            It.Is<string>(r => r.StartsWith("tanahpediaCategory") && r.Contains("entityType=PLACE"))),
            Times.Once);
    }
}
