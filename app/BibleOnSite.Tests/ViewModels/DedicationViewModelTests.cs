using BibleOnSite.Models;
using BibleOnSite.Services;
using BibleOnSite.Tests.Support;
using BibleOnSite.ViewModels;

namespace BibleOnSite.Tests.ViewModels;

/// <summary>
/// Dedication display behavior of the reader view models (#2731): each surface
/// sends its context identities to the API and renders the formatted lines —
/// failures and stale responses never leak lines from another context.
/// </summary>
public class DedicationViewModelTests
{
    private sealed class FakeDedicationService : IDedicationService
    {
        public List<DedicationContext> Contexts { get; } = [];
        public Func<DedicationContext, Task<List<Dedication>>>? Responder { get; set; }

        public Task<List<Dedication>> GetDedicationsAsync(DedicationContext context, CancellationToken cancellationToken)
        {
            Contexts.Add(context);
            cancellationToken.ThrowIfCancellationRequested();
            return Responder?.Invoke(context) ?? Task.FromResult(new List<Dedication>());
        }
    }

    #region PerekViewModel

    private static (PerekViewModel ViewModel, FakeDedicationService Dedications) CreatePerekViewModel(
        Func<int, Perek?> perekLoader, FakeDedicationService? dedications = null)
    {
        var storage = new InMemoryPreferencesStorage();
        var preferences = PreferencesService.CreateForTesting(storage);
        var fake = dedications ?? new FakeDedicationService();
        var viewModel = new PerekViewModel(preferences, perekLoader,
            null, null, null, null, null, null, null, fake);
        return (viewModel, fake);
    }

    [Fact]
    public void PerekViewModel_perek_with_dedication_shows_formatted_lines()
    {
        var perek = CreatePerek(17);
        var dedications = new FakeDedicationService
        {
            Responder = _ => Task.FromResult(new List<Dedication>
            {
                new() { Subject = "Fulano de Tal", Purposes = ["Falecimento"] },
            }),
        };
        var (viewModel, _) = CreatePerekViewModel(_ => perek, dedications);

        viewModel.LoadByPerekId(17);

        viewModel.DedicationLines.Should().Equal("מוקדש לFulano de Tal (Falecimento)");
        viewModel.HasDedications.Should().BeTrue();
        dedications.Contexts.Should().ContainSingle()
            .Which.PerekIds.Should().Equal(17);
    }

    [Fact]
    public void PerekViewModel_perek_without_dedication_hides_block()
    {
        var (viewModel, _) = CreatePerekViewModel(_ => CreatePerek(99));

        viewModel.LoadByPerekId(99);

        viewModel.DedicationLines.Should().BeEmpty();
        viewModel.HasDedications.Should().BeFalse();
    }

    [Fact]
    public void PerekViewModel_dedication_failure_keeps_perek_page_working()
    {
        var dedications = new FakeDedicationService
        {
            Responder = _ => Task.FromException<List<Dedication>>(new InvalidOperationException("api down")),
        };
        var (viewModel, _) = CreatePerekViewModel(_ => CreatePerek(5), dedications);

        viewModel.LoadByPerekId(5);

        viewModel.DedicationLines.Should().BeEmpty();
        viewModel.HasDedications.Should().BeFalse();
        viewModel.Perek.Should().NotBeNull();
        viewModel.PerekId.Should().Be(5);
    }

    [Fact]
    public async Task PerekViewModel_fast_swipe_discards_stale_perek_lines()
    {
        var gate = new TaskCompletionSource<List<Dedication>>();
        var dedications = new FakeDedicationService
        {
            Responder = ctx => ctx.PerekIds!.Contains(1)
                ? gate.Task
                : Task.FromResult(new List<Dedication> { new() { Subject = "Dois" } }),
        };
        var perakim = new Dictionary<int, Perek> { [1] = CreatePerek(1), [2] = CreatePerek(2) };
        var (viewModel, _) = CreatePerekViewModel(id => perakim.GetValueOrDefault(id), dedications);

        viewModel.LoadByPerekId(1); // dedication load stays pending on the gate
        viewModel.LoadByPerekId(2); // swiped: second load completes immediately

        viewModel.DedicationLines.Should().Equal("מוקדש לDois");

        // The first perek's response arriving late must not overwrite the second's lines.
        gate.SetResult([new Dedication { Subject = "Um" }]);
        await Task.Yield();

        viewModel.DedicationLines.Should().Equal("מוקדש לDois");
    }

    private static Perek CreatePerek(int perekId) => new()
    {
        PerekId = perekId,
        PerekNumber = 1,
        Additional = null,
        Date = "2026-01-20",
        HebDate = "תשרי",
        HasRecording = false,
        Header = "Header",
        SeferId = 1,
        SeferName = "בראשית",
        SeferTanahUsName = "Genesis",
        Tseit = "18:00",
    };

    #endregion

    #region ParashaViewModel

    private static (ParashaViewModel ViewModel, FakeDedicationService Dedications) CreateParashaViewModel(
        FakeDedicationService? dedications = null)
    {
        var storage = new TestStorage();
        var localDb = new LocalDatabaseService(storage.FileSystem.Object);
        var fake = dedications ?? new FakeDedicationService();
        var viewModel = new ParashaViewModel(
            new ParashaDataService(localDb),
            new PerekDataService(localDb),
            PreferencesService.CreateForTesting(new InMemoryPreferencesStorage()),
            null, null, null, null, null, null, null, null, fake);
        return (viewModel, fake);
    }

    [Fact]
    public void ParashaViewModel_unit_with_dedication_shows_formatted_lines()
    {
        var dedications = new FakeDedicationService
        {
            Responder = _ => Task.FromResult(new List<Dedication>
            {
                new() { Subject = "Fulano de Tal" },
            }),
        };
        var (viewModel, _) = CreateParashaViewModel(dedications);

        viewModel.Unit = CreateUnit(30);

        viewModel.DedicationLines.Should().Equal("מוקדש לFulano de Tal");
        viewModel.HasDedications.Should().BeTrue();
        dedications.Contexts.Should().ContainSingle()
            .Which.ParashaIds.Should().Equal(30);
    }

    [Fact]
    public void ParashaViewModel_unit_cleared_when_unit_becomes_null()
    {
        var dedications = new FakeDedicationService
        {
            Responder = _ => Task.FromResult(new List<Dedication>
            {
                new() { Subject = "Fulano de Tal" },
            }),
        };
        var (viewModel, _) = CreateParashaViewModel(dedications);
        viewModel.Unit = CreateUnit(30);

        viewModel.Unit = null;

        viewModel.DedicationLines.Should().BeEmpty();
        viewModel.HasDedications.Should().BeFalse();
    }

    private static ParashaUnit CreateUnit(int unitId) => new()
    {
        UnitId = unitId,
        Slug = unitId.ToString(),
        SeferId = 1,
        SeferName = "בראשית",
        Order = unitId,
        Heading = "בראשית",
        TorahRange = new ScriptureRange { StartPerekId = 1, StartPasuk = 1, EndPerekId = 1, EndPasuk = 10 },
    };

    #endregion

    #region TanahpediaEntryViewModel

    private readonly Mock<ITanahpediaService> _tanahpedia = new();
    private readonly Mock<IAppNavigator> _navigator = new();

    private (TanahpediaEntryViewModel ViewModel, FakeDedicationService Dedications) CreateEntryViewModel(
        FakeDedicationService? dedications = null)
    {
        var storage = new TestStorage();
        var perekData = new PerekDataService(new LocalDatabaseService(storage.FileSystem.Object));
        var fake = dedications ?? new FakeDedicationService();
        var viewModel = new TanahpediaEntryViewModel(
            _tanahpedia.Object, _navigator.Object, perekData, fake);
        return (viewModel, fake);
    }

    [Fact]
    public async Task TanahpediaEntryViewModel_entry_with_dedication_shows_formatted_lines()
    {
        _tanahpedia.Setup(s => s.GetEntryDetailAsync("משה", It.IsAny<CancellationToken>()))
            .ReturnsAsync(new TanahpediaEntryDetail { Id = "e7", UniqueName = "משה", Title = "משה רבנו" });
        var dedications = new FakeDedicationService
        {
            Responder = _ => Task.FromResult(new List<Dedication>
            {
                new() { Subject = "Fulano de Tal", Purposes = ["Falecimento"] },
            }),
        };
        var (viewModel, _) = CreateEntryViewModel(dedications);
        viewModel.UniqueName = "משה";

        await viewModel.LoadAsync();

        viewModel.ShowEntry.Should().BeTrue();
        viewModel.DedicationLines.Should().Equal("מוקדש לFulano de Tal (Falecimento)");
        viewModel.HasDedications.Should().BeTrue();
        dedications.Contexts.Should().ContainSingle()
            .Which.EntryIds.Should().Equal("e7");
    }

    [Fact]
    public async Task TanahpediaEntryViewModel_dedication_failure_keeps_entry_working()
    {
        _tanahpedia.Setup(s => s.GetEntryDetailAsync("משה", It.IsAny<CancellationToken>()))
            .ReturnsAsync(new TanahpediaEntryDetail { Id = "e7", UniqueName = "משה", Title = "משה רבנו" });
        var dedications = new FakeDedicationService
        {
            Responder = _ => Task.FromException<List<Dedication>>(new InvalidOperationException("api down")),
        };
        var (viewModel, _) = CreateEntryViewModel(dedications);
        viewModel.UniqueName = "משה";

        await viewModel.LoadAsync();

        viewModel.ShowEntry.Should().BeTrue();
        viewModel.DedicationLines.Should().BeEmpty();
        viewModel.HasDedications.Should().BeFalse();
    }

    #endregion
}
