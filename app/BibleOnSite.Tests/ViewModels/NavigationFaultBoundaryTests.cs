using BibleOnSite.Models;
using BibleOnSite.Services;
using BibleOnSite.Tests.Support;
using BibleOnSite.ViewModels;
using CommunityToolkit.Mvvm.Input;
using Moq;
using Xunit;

namespace BibleOnSite.Tests.ViewModels;

/// <summary>
/// Navigation and share commands catch transport failures instead of crashing
/// the caller; a failing <see cref="IAppNavigator"/> drives each fault boundary.
/// </summary>
public class NavigationFaultBoundaryTests
{
    private static Mock<IAppNavigator> ThrowingNavigator()
    {
        var navigator = new Mock<IAppNavigator>();
        navigator.Setup(n => n.GoToAsync(It.IsAny<string>()))
            .ThrowsAsync(new InvalidOperationException("navigation failed"));
        return navigator;
    }

    private static async Task ExecuteAll(params IAsyncRelayCommand[] commands)
    {
        foreach (var command in commands)
        {
            await command.ExecuteAsync(null);
        }
    }

    [Fact]
    public async Task PreferencesCommands_SwallowNavigationFailures()
    {
        await using var storage = new TestStorage();
        var preferences = PreferencesService.CreateForTesting(new InMemoryPreferencesStorage());
        var notes = PerushimNotesService.CreateForTesting(
            new Mock<IPadDeliveryService>().Object,
            Path.Join(Path.GetTempPath(), Path.GetRandomFileName()));
        var recitation = new RecitationService(
            new Mock<IFileSystem>().Object, new Mock<IPadDeliveryService>().Object);
        var viewModel = new PreferencesViewModel(preferences, notes, recitation, ThrowingNavigator().Object);

        await ExecuteAll(
            viewModel.OpenDisplayCommand,
            viewModel.OpenPerekCommand,
            viewModel.OpenExtensionPacksCommand,
            viewModel.OpenRecitationCommand,
            viewModel.OpenSoundCommand,
            viewModel.OpenSupportCommand);
    }

    [Fact]
    public async Task RecitationPreferencesCommands_SwallowNavigationFailures()
    {
        await using var storage = new TestStorage();
        var preferences = PreferencesService.CreateForTesting(new InMemoryPreferencesStorage());
        var recitation = new RecitationService(
            new Mock<IFileSystem>().Object, new Mock<IPadDeliveryService>().Object);
        var viewModel = new RecitationPreferencesViewModel(
            recitation, preferences, ThrowingNavigator().Object);

        await ExecuteAll(viewModel.OpenExtensionPacksCommand, viewModel.OpenSoundCommand);
    }

    [Fact]
    public async Task TanahpediaCommands_SwallowNavigationFailures()
    {
        var viewModel = new TanahpediaViewModel(
            new Mock<ITanahpediaService>().Object, ThrowingNavigator().Object);

        await viewModel.OpenCategoryCommand.ExecuteAsync(new TanahpediaCategoryItem
        {
            Category = new TanahpediaCategory { Key = "PERSON", Label = "אישים", EntityType = "person" },
        });
        await viewModel.OpenEntryCommand.ExecuteAsync("משה");
    }

    [Fact]
    public async Task TanahpediaEntityTypeCommands_SwallowNavigationFailures()
    {
        var viewModel = new TanahpediaEntityTypeViewModel(
            new Mock<ITanahpediaService>().Object, ThrowingNavigator().Object);

        await viewModel.OpenEntryCommand.ExecuteAsync("משה");
    }

    [Fact]
    public async Task ParashaListCommand_SwallowsNavigationFailure()
    {
        await using var storage = new TestStorage();
        var localDb = new LocalDatabaseService(storage.FileSystem.Object);
        var viewModel = new ParashaListViewModel(
            new ParashaDataService(localDb), new PerekDataService(localDb), ThrowingNavigator().Object);

        await viewModel.OpenParashaCommand.ExecuteAsync(new ParashaUnit
        {
            UnitId = 1, Slug = "1", SeferId = 1, SeferName = "בראשית",
            Order = 1, Heading = "x",
            TorahRange = new ScriptureRange { StartPerekId = 1, StartPasuk = 1, EndPerekId = 1, EndPasuk = 5 },
        });
    }

    [Fact]
    public async Task ArticlesCommand_SwallowsNavigationFailure()
    {
        await using var storage = new TestStorage();
        var data = new PerekDataService(new LocalDatabaseService(storage.FileSystem.Object));
        var viewModel = new ArticlesViewModel(
            StarterService.Instance, data, ThrowingNavigator().Object);

        await viewModel.OpenArticleCommand.ExecuteAsync(new Article { Id = 7, PerekId = 2, Abstract = "x" });
    }

    [Fact]
    public async Task LearningCalendarCommand_SwallowsNavigationFailure()
    {
        await using var storage = new TestStorage();
        var localDb = new LocalDatabaseService(storage.FileSystem.Object);
        var schedule = new PerekScheduleService(localDb);
        var perekData = new PerekDataService(localDb, schedule);
        var viewModel = new LearningCalendarViewModel(schedule, perekData, ThrowingNavigator().Object);

        await viewModel.OpenPerekCommand.ExecuteAsync(new CalendarCellViewModel { PerekId = 5 });
    }

    [Fact]
    public async Task ArticleDetailCommands_SwallowNavigationAndShareFailures()
    {
        var share = new Mock<IShare>();
        share.Setup(s => s.RequestAsync(It.IsAny<ShareTextRequest>()))
            .ThrowsAsync(new InvalidOperationException("share failed"));
        var viewModel = new ArticleDetailViewModel(ThrowingNavigator().Object, share.Object)
        {
            Article = new Article
            {
                Id = 1, Abstract = "x",
                Author = new Author { Id = 5, Name = "author", Details = string.Empty },
            },
        };

        await ExecuteAll(viewModel.GoBackCommand, viewModel.GoToAuthorCommand, viewModel.ShareCommand);
    }

    [Fact]
    public async Task ParashaViewModelCtor_Composes()
    {
        await using var storage = new TestStorage();
        var localDb = new LocalDatabaseService(storage.FileSystem.Object);
        var viewModel = new ParashaViewModel(
            new ParashaDataService(localDb), new PerekDataService(localDb),
            PreferencesService.CreateForTesting(new InMemoryPreferencesStorage()), null, null, null);

        viewModel.Should().NotBeNull();
    }

    [Fact]
    public async Task TanahpediaEntryLoad_SurfacesFailureAsErrorMessage()
    {
        await using var storage = new TestStorage();
        var tanahpedia = new Mock<ITanahpediaService>();
        tanahpedia.Setup(s => s.GetEntryDetailAsync(It.IsAny<string>(), It.IsAny<CancellationToken>()))
            .ThrowsAsync(new InvalidOperationException("load failed"));
        var perekData = new PerekDataService(new LocalDatabaseService(storage.FileSystem.Object));
        var viewModel = new TanahpediaEntryViewModel(
            tanahpedia.Object, ThrowingNavigator().Object, perekData, new Mock<IDedicationService>().Object)
        {
            UniqueName = "משה",
        };

        await viewModel.LoadCommand.ExecuteAsync(null);

        viewModel.ErrorMessage.Should().NotBeNullOrEmpty();
    }
}
