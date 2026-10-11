using BibleOnSite.Models;
using BibleOnSite.Services;
using BibleOnSite.Tests.Support;

namespace BibleOnSite.Tests.Services;

/// <summary>
/// פרשה על הפרק export consumption: units, ordered Haftarah auxiliaries,
/// and canonical range clipping against the shared contract tables.
/// </summary>
public class ParashaDataServiceTests
{
    private const string DbName = "sefaria-dump-5784-sivan-4.tanah_view.sqlite";

    internal static readonly string[] Schema =
    [
        "CREATE TABLE tanah_sefer (id INTEGER, name TEXT, tanach_us_name TEXT, perek_id_from INTEGER, perek_id_to INTEGER)",
        "CREATE TABLE tanah_perek (id INTEGER, perek INTEGER, header TEXT)",
        "CREATE TABLE tanah_additional (id INTEGER, sefer_id INTEGER, perek_from INTEGER, perek_to INTEGER, letter TEXT, tanach_us_name TEXT)",
        "CREATE TABLE tanah_perek_date (perek_id INTEGER, cycle INTEGER, date TEXT, hebdate TEXT, star_rise TEXT)",
        "CREATE TABLE tanah_pasuk_segment (id INTEGER, perek_id INTEGER, pasuk_id INTEGER, segment_type TEXT)",
        "CREATE TABLE tanah_pasuk_segment_value (id INTEGER, value TEXT)",
        "CREATE TABLE tanah_pasuk_segment_qri_ktiv_offset (id INTEGER, qri_ktiv_offset INTEGER)",
        "CREATE TABLE tanah_reading_division (id TEXT PRIMARY KEY, contract_version INTEGER, root_path TEXT, menu_label TEXT)",
        "CREATE TABLE tanah_reading_unit (division_id TEXT, unit_id INTEGER, slug TEXT, sefer_id INTEGER, unit_order INTEGER, heading TEXT, closing_break TEXT)",
        "CREATE TABLE tanah_reading_unit_range (id INTEGER PRIMARY KEY AUTOINCREMENT, division_id TEXT, unit_id INTEGER, range_index INTEGER, auxiliary_ordinal INTEGER, auxiliary_id TEXT, auxiliary_label TEXT, start_perek_id INTEGER, start_pasuk INTEGER, start_segment_index INTEGER, end_perek_id INTEGER, end_pasuk INTEGER, end_segment_index INTEGER)"
    ];

    /// <summary>
    /// Seeds two sefarim (בראשית perakim 1-3, ישעיהו perakim 4-5) with
    /// five pesukim each, plus two parasha units: unit 1 reads בראשית
    /// א ב - ג ד with an ordered אשכנזים two-range Haftarah (a perek
    /// jump) and a תימנים variant; unit 2 follows it.
    /// </summary>
    private static async Task<TestStorage> SeedAsync(TestStorage storage)
    {
        var db = await storage.CreateDatabaseAsync(DbName, Schema);
        await db.ExecuteAsync("INSERT INTO tanah_sefer VALUES (1,'בראשית','Genesis',1,3),(16,'ישעיהו','Isaiah',4,5)");
        await db.ExecuteAsync("INSERT INTO tanah_perek VALUES (1,1,'h1'),(2,2,'h2'),(3,3,'h3'),(4,40,'h40'),(5,41,'h41')");
        var segmentId = 0;
        for (var perekId = 1; perekId <= 5; perekId++)
        {
            for (var pasukId = 1; pasukId <= 5; pasukId++)
            {
                segmentId++;
                await db.ExecuteAsync("INSERT INTO tanah_pasuk_segment VALUES (?,?,?,'qri')", segmentId, perekId, pasukId);
                await db.ExecuteAsync("INSERT INTO tanah_pasuk_segment_value VALUES (?,?)", segmentId, $"word{perekId}-{pasukId}");
            }
        }

        await db.ExecuteAsync("INSERT INTO tanah_reading_division VALUES ('parasha',1,'/פרשה','פרשה על הפרק')");
        await db.ExecuteAsync("INSERT INTO tanah_reading_unit VALUES " +
            "('parasha',1,'1',1,1,'בראשית',NULL)," +
            "('parasha',2,'2',1,2,'נח',NULL)");
        // Unit 1: primary Torah range בראשית א ב - ג ד.
        await db.ExecuteAsync("INSERT INTO tanah_reading_unit_range " +
            "(division_id,unit_id,range_index,auxiliary_ordinal,auxiliary_id,auxiliary_label," +
            "start_perek_id,start_pasuk,start_segment_index,end_perek_id,end_pasuk,end_segment_index) VALUES " +
            "('parasha',1,0,NULL,NULL,NULL,1,2,NULL,3,4,NULL)");
        // Unit 1 auxiliaries in source order: אשכנזים (two ranges with a
        // perek jump), then תימנים (single range).
        await db.ExecuteAsync("INSERT INTO tanah_reading_unit_range " +
            "(division_id,unit_id,range_index,auxiliary_ordinal,auxiliary_id,auxiliary_label," +
            "start_perek_id,start_pasuk,start_segment_index,end_perek_id,end_pasuk,end_segment_index) VALUES " +
            "('parasha',1,0,0,'haftara-ashkenazi','אשכנזים',4,1,NULL,4,3,NULL)," +
            "('parasha',1,1,0,'haftara-ashkenazi','אשכנזים',5,1,NULL,5,1,NULL)," +
            "('parasha',1,0,1,'haftara-temani','תימנים',4,2,NULL,5,2,NULL)");
        // Unit 2: a plain unit with one variant.
        await db.ExecuteAsync("INSERT INTO tanah_reading_unit_range " +
            "(division_id,unit_id,range_index,auxiliary_ordinal,auxiliary_id,auxiliary_label," +
            "start_perek_id,start_pasuk,start_segment_index,end_perek_id,end_pasuk,end_segment_index) VALUES " +
            "('parasha',2,0,NULL,NULL,NULL,3,5,NULL,3,5,NULL)," +
            "('parasha',2,0,0,'haftara-sefaradi','ספרדים',4,1,NULL,4,1,NULL)");
        return storage;
    }

    private static (ParashaDataService Parasha, PerekDataService Perakim) Services(TestStorage storage)
    {
        var localDb = new LocalDatabaseService(storage.FileSystem.Object);
        return (new ParashaDataService(localDb), new PerekDataService(localDb));
    }

    [Fact]
    public async Task Load_MapsUnits_PrimaryRange_AndOrderedAuxiliaries()
    {
        await using var storage = new TestStorage();
        await SeedAsync(storage);
        var (parasha, _) = Services(storage);

        parasha.IsLoaded.Should().BeFalse();
        await parasha.LoadAsync();

        parasha.IsLoaded.Should().BeTrue();
        parasha.Parashiot.Should().HaveCount(2);

        var first = parasha.GetParasha(1)!;
        first.Heading.Should().Be("בראשית");
        first.SeferId.Should().Be(1);
        first.Order.Should().Be(1);
        first.Slug.Should().Be("1");
        first.TorahRange.StartPerekId.Should().Be(1);
        first.TorahRange.StartPasuk.Should().Be(2);
        first.TorahRange.EndPerekId.Should().Be(3);
        first.TorahRange.EndPasuk.Should().Be(4);

        // Both variants kept, in source order, with their own ordered
        // ranges — never flattened into one default reading.
        first.Haftarot.Should().HaveCount(2);
        first.Haftarot[0].Id.Should().Be("haftara-ashkenazi");
        first.Haftarot[0].Label.Should().Be("אשכנזים");
        first.Haftarot[0].Ranges.Should().HaveCount(2);
        first.Haftarot[0].Ranges[0].EndPerekId.Should().Be(4);
        first.Haftarot[0].Ranges[0].EndPasuk.Should().Be(3);
        first.Haftarot[0].Ranges[1].StartPerekId.Should().Be(5);
        first.Haftarot[1].Id.Should().Be("haftara-temani");
        first.Haftarot[1].Ranges.Should().ContainSingle();
        first.Haftarot[1].Ranges[0].EndPerekId.Should().Be(5);
        first.Haftarot[1].Ranges[0].EndPasuk.Should().Be(2);

        var second = parasha.GetParasha(2)!;
        second.Heading.Should().Be("נח");
        second.Haftarot.Should().ContainSingle();
        parasha.GetParasha(99).Should().BeNull();
    }

    [Fact]
    public async Task ViewModel_BuildsTorahAndHaftarahSections_WithClippedPesukim()
    {
        await using var storage = new TestStorage();
        await SeedAsync(storage);
        var (parasha, perakim) = Services(storage);
        var viewModel = new BibleOnSite.ViewModels.ParashaViewModel(parasha, perakim);

        await viewModel.LoadAsync(1);

        viewModel.Title.Should().Be("פרשת בראשית");
        viewModel.Source.Should().Be("בראשית א ב - ג ד"); // same-sefer span: end keeps perek letters only
        viewModel.CanGoToNext.Should().BeTrue();
        viewModel.CanGoToPrevious.Should().BeFalse();

        var items = viewModel.Items.ToList();
        items[0].IsSectionHeader.Should().BeTrue();
        items[0].Text.Should().Be("תורה");

        // Perek subheaders carry the canonical source labels.
        items[1].IsPerekHeader.Should().BeTrue();
        items[1].Text.Should().Be("בראשית א");

        // The Torah range is clipped: בראשית א contributes pesukim 2-5,
        // בראשית ב all five, בראשית ג pesukim 1-4.
        var torahPesukim = items
            .TakeWhile(item => !item.IsSectionHeader || item == items[0])
            .Where(item => item.Pasuk is not null)
            .Select(item => item.Pasuk!.PasukNum)
            .ToList();
        torahPesukim.Should().Equal(2, 3, 4, 5, 1, 2, 3, 4, 5, 1, 2, 3, 4);

        // Haftarah variants appear after the Torah section, each labeled
        // and rendering its own ordered ranges — the אשכנזים jump from
        // perek 4 to perek 5 keeps range order without filling gaps.
        var ashkenaziHeaderIndex = items.FindIndex(item => item.Text == "הפטרה - אשכנזים");
        ashkenaziHeaderIndex.Should().BeGreaterThan(0);
        var temaniHeaderIndex = items.FindIndex(item => item.Text == "הפטרה - תימנים");
        temaniHeaderIndex.Should().BeGreaterThan(ashkenaziHeaderIndex);

        var ashkenaziSection = items.Skip(ashkenaziHeaderIndex + 1).Take(temaniHeaderIndex - ashkenaziHeaderIndex - 1).ToList();
        ashkenaziSection.Where(i => i.IsPerekHeader).Select(i => i.Text)
            .Should().Equal("ישעיהו א", "ישעיהו ב");
        ashkenaziSection.Where(i => i.Pasuk is not null).Select(i => i.Pasuk!.PasukNum)
            .Should().Equal(1, 2, 3, 1);

        var temaniSection = items.Skip(temaniHeaderIndex + 1).ToList();
        temaniSection.Where(i => i.Pasuk is not null).Select(i => i.Pasuk!.PasukNum)
            .Should().Equal(2, 3, 4, 5, 1, 2);
    }

    [Fact]
    public async Task ViewModel_NextAndPrevious_NavigateUnitIdentities()
    {
        await using var storage = new TestStorage();
        await SeedAsync(storage);
        var (parasha, perakim) = Services(storage);
        var viewModel = new BibleOnSite.ViewModels.ParashaViewModel(parasha, perakim);

        await viewModel.LoadAsync(1);
        await viewModel.NextCommand.ExecuteAsync(null);

        viewModel.Title.Should().Be("פרשת נח");
        viewModel.UnitId.Should().Be(2);
        viewModel.CanGoToNext.Should().BeFalse();
        viewModel.CanGoToPrevious.Should().BeTrue();

        await viewModel.PreviousCommand.ExecuteAsync(null);
        viewModel.Title.Should().Be("פרשת בראשית");
        viewModel.UnitId.Should().Be(1);
    }

    [Fact]
    public async Task ListViewModel_GroupsUnitsByTorahSefer()
    {
        await using var storage = new TestStorage();
        await SeedAsync(storage);
        var (parasha, perakim) = Services(storage);
        var navigator = new Moq.Mock<IAppNavigator>();
        var viewModel = new BibleOnSite.ViewModels.ParashaListViewModel(parasha, perakim, navigator.Object);

        await viewModel.LoadAsync();

        viewModel.Groups.Should().ContainSingle();
        viewModel.Groups[0].SeferName.Should().Be("בראשית");
        viewModel.Groups[0].Select(unit => unit.Heading).Should().Equal("בראשית", "נח");

        await viewModel.OpenParashaCommand.ExecuteAsync(viewModel.Groups[0][1]);
        navigator.Verify(n => n.GoToAsync("ParashaPage?unitId=2"), Moq.Times.Once);
    }

    [Fact]
    public void PasukBoundsForPerek_ClipsOnlyBoundaryPerakim()
    {
        var range = new ScriptureRange { StartPerekId = 1, StartPasuk = 2, EndPerekId = 3, EndPasuk = 4 };

        ParashaDataService.PasukBoundsForPerek(range, 0).Should().BeNull();
        ParashaDataService.PasukBoundsForPerek(range, 4).Should().BeNull();
        ParashaDataService.PasukBoundsForPerek(range, 1).Should().Be((2, int.MaxValue));
        ParashaDataService.PasukBoundsForPerek(range, 2).Should().Be((1, int.MaxValue));
        ParashaDataService.PasukBoundsForPerek(range, 3).Should().Be((1, 4));
    }
}
