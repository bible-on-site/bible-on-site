using BibleOnSite.Models;
using BibleOnSite.Services;
using BibleOnSite.Tests.Support;
using BibleOnSite.ViewModels;
using FluentAssertions;
using Moq;

namespace BibleOnSite.Tests.ViewModels;

/// <summary>
/// Navigation and share commands guard their transport calls with deliberate
/// failure boundaries (a thrown GoToAsync/RequestAsync must be logged, never
/// propagated). These tests drive each boundary so a transport outage can't
/// crash the command — and so the catch arms stay covered.
/// </summary>
[Collection(PreferencesServiceCollection.Name)]
public class NavigationFailureBoundaryTests
{
    private static Mock<IAppNavigator> ThrowingNavigator()
    {
        var navigator = new Mock<IAppNavigator>();
        navigator.Setup(n => n.GoToAsync(It.IsAny<string>()))
            .ThrowsAsync(new InvalidOperationException("navigation transport down"));
        navigator.Setup(n => n.GoToAsync(It.IsAny<string>(), It.IsAny<bool>(), It.IsAny<IDictionary<string, object>>()))
            .ThrowsAsync(new InvalidOperationException("navigation transport down"));
        return navigator;
    }

    private static PerushimNotesService CreateNotesService() =>
        PerushimNotesService.CreateForTesting(new Mock<IPadDeliveryService>().Object,
            Path.Join(Path.GetTempPath(), Path.GetRandomFileName()));

    private static RecitationService CreateRecitationService() =>
        new(new Mock<IFileSystem>().Object, new Mock<IPadDeliveryService>().Object);

    [Fact]
    public async Task PreferencesViewModel_CategoryCommands_SwallowNavigationFailure()
    {
        var preferences = PreferencesService.CreateForTesting(new InMemoryPreferencesStorage());
        var navigator = ThrowingNavigator();
        var viewModel = new PreferencesViewModel(preferences, CreateNotesService(), CreateRecitationService(), navigator.Object);
        try
        {
            var act = async () =>
            {
                await viewModel.OpenDisplayCommand.ExecuteAsync(null);
                await viewModel.OpenPerekCommand.ExecuteAsync(null);
                await viewModel.OpenExtensionPacksCommand.ExecuteAsync(null);
                await viewModel.OpenRecitationCommand.ExecuteAsync(null);
                await viewModel.OpenSoundCommand.ExecuteAsync(null);
                await viewModel.OpenSupportCommand.ExecuteAsync(null);
            };

            await act.Should().NotThrowAsync("navigation failure must not crash the command");
        }
        finally
        {
            PreferencesService.ResetForTesting();
        }
    }

    [Fact]
    public async Task RecitationPreferencesViewModel_ShortcutCommands_SwallowNavigationFailure()
    {
        var preferences = PreferencesService.CreateForTesting(new InMemoryPreferencesStorage());
        var viewModel = new RecitationPreferencesViewModel(
            CreateRecitationService(), preferences, ThrowingNavigator().Object);
        try
        {
            var act = async () =>
            {
                await viewModel.OpenSoundCommand.ExecuteAsync(null);
                await viewModel.OpenExtensionPacksCommand.ExecuteAsync(null);
            };

            await act.Should().NotThrowAsync();
        }
        finally
        {
            PreferencesService.ResetForTesting();
        }
    }

    [Fact]
    public async Task ArticleDetailViewModel_GoBackAndAuthorCommands_SwallowNavigationFailure()
    {
        var share = new Mock<IShare>();
        var viewModel = new ArticleDetailViewModel(ThrowingNavigator().Object, share.Object)
        {
            Article = new Article
            {
                Id = 7,
                Abstract = "abstract",
                Author = new Author { Id = 5, Name = "הרב משה", Details = "details" },
            },
        };

        var act = async () =>
        {
            await viewModel.GoBackCommand.ExecuteAsync(null);
            await viewModel.GoToAuthorCommand.ExecuteAsync(null);
        };

        await act.Should().NotThrowAsync();
    }

    [Fact]
    public async Task ArticleDetailViewModel_ShareCommand_SwallowsShareFailure()
    {
        var share = new Mock<IShare>();
        share.Setup(s => s.RequestAsync(It.IsAny<ShareTextRequest>()))
            .ThrowsAsync(new InvalidOperationException("share sheet unavailable"));
        var viewModel = new ArticleDetailViewModel(ThrowingNavigator().Object, share.Object)
        {
            Article = new Article { Id = 7, Abstract = "abstract" },
        };

        var act = () => viewModel.ShareCommand.ExecuteAsync(null);

        await act.Should().NotThrowAsync();
    }

    [Fact]
    public async Task ArticlesViewModel_OpenArticleCommand_SwallowsNavigationFailure()
    {
        var storage = new TestStorage();
        var starter = new StarterService(new GraphQLTransport("{}").Client, storage.FileSystem.Object);
        var data = new PerekDataService(new LocalDatabaseService(storage.FileSystem.Object));
        var viewModel = new ArticlesViewModel(starter, data, ThrowingNavigator().Object);

        var act = () => viewModel.OpenArticleCommand.ExecuteAsync(new Article { Id = 1, PerekId = 2, Abstract = "a" });

        await act.Should().NotThrowAsync();
    }

    [Fact]
    public async Task ParashaListViewModel_OpenParashaCommand_SwallowsNavigationFailure()
    {
        var storage = new TestStorage();
        var localDb = new LocalDatabaseService(storage.FileSystem.Object);
        var viewModel = new ParashaListViewModel(
            new ParashaDataService(localDb), new PerekDataService(localDb), ThrowingNavigator().Object);

        var unit = new ParashaUnit
        {
            UnitId = 7,
            Slug = "בראשית",
            SeferName = "בראשית",
            Heading = "בראשית",
            TorahRange = new ScriptureRange(),
        };
        var act = () => viewModel.OpenParashaCommand.ExecuteAsync(unit);

        await act.Should().NotThrowAsync();
    }

    [Fact]
    public async Task TanahpediaEntityTypeViewModel_OpenEntryCommand_SwallowsNavigationFailure()
    {
        var viewModel = new TanahpediaEntityTypeViewModel(new Mock<ITanahpediaService>().Object, ThrowingNavigator().Object);

        var act = () => viewModel.OpenEntryCommand.ExecuteAsync("משה");

        await act.Should().NotThrowAsync();
    }

    [Fact]
    public async Task TanahpediaViewModel_CategoryAndEntryCommands_SwallowNavigationFailure()
    {
        var viewModel = new TanahpediaViewModel(new Mock<ITanahpediaService>().Object, ThrowingNavigator().Object);
        var item = new TanahpediaCategoryItem
        {
            Category = new TanahpediaCategory { Key = "PERSON", Label = "אישים", EntityType = "PERSON" },
        };

        var act = async () =>
        {
            await viewModel.OpenCategoryCommand.ExecuteAsync(item);
            await viewModel.OpenEntryCommand.ExecuteAsync("משה");
        };

        await act.Should().NotThrowAsync();
    }

    [Fact]
    public async Task TanahpediaEntryViewModel_CategoryAndBackCommands_SwallowNavigationFailure()
    {
        var storage = new TestStorage();
        var perekData = new PerekDataService(new LocalDatabaseService(storage.FileSystem.Object));
        var viewModel = new TanahpediaEntryViewModel(
            new Mock<ITanahpediaService>().Object, ThrowingNavigator().Object, perekData);
        var entity = new TanahpediaLinkedEntity { EntityType = "PERSON", EntityName = "משה" };

        var act = async () =>
        {
            await viewModel.OpenEntityCategoryCommand.ExecuteAsync(entity);
            await viewModel.GoBackCommand.ExecuteAsync(null);
        };

        await act.Should().NotThrowAsync();
    }

    [Fact]
    public async Task LearningCalendarViewModel_OpenPerekCommand_SwallowsNavigationFailure()
    {
        var storage = new TestStorage();
        var localDb = new LocalDatabaseService(storage.FileSystem.Object);
        var schedule = new PerekScheduleService(localDb);
        var perekData = new PerekDataService(localDb, schedule);
        var viewModel = new LearningCalendarViewModel(schedule, perekData, ThrowingNavigator().Object);
        var cell = new CalendarCellViewModel { PerekId = 5 };

        var act = () => viewModel.OpenPerekCommand.ExecuteAsync(cell);

        await act.Should().NotThrowAsync();
    }
}
