using BibleOnSite.Helpers;
using BibleOnSite.Models;
using BibleOnSite.Services;
using BibleOnSite.Tests.Support;
using BibleOnSite.ViewModels;
using CommunityToolkit.Mvvm.Input;
using FluentAssertions;
using Microsoft.Maui.ApplicationModel.DataTransfer;
using Microsoft.Maui.Storage;
using Moq;

namespace BibleOnSite.Tests.ViewModels;

[Collection(PreferencesServiceCollection.Name)]
public sealed class NavigationFailureRecoveryTests : IDisposable
{
    private readonly GraphQLTransport _transport = new();
    private readonly PreferencesService _preferences =
        PreferencesService.CreateForTesting(new InMemoryPreferencesStorage());

    public void Dispose()
    {
        _transport.Dispose();
        PreferencesService.ResetForTesting();
        DivineNameMasking.Apply(DivineNameMaskingOptions.Disabled);
    }

    [Theory]
    [InlineData("display", "DisplayPreferencesPage")]
    [InlineData("perek", "PerekPreferencesPage")]
    [InlineData("packs", "ExtensionPacksPage")]
    [InlineData("recitation", "RecitationPreferencesPage")]
    [InlineData("sound", "SoundPreferencesPage")]
    [InlineData("support", "SupportPreferencesPage")]
    [InlineData("recitation-sound", "SoundPreferencesPage?focus=recitation")]
    [InlineData("recitation-packs", "ExtensionPacksPage")]
    [InlineData("article-back", "..")]
    [InlineData("article-author", "ArticlesPage?authorId=42&authorName=Test%20Author")]
    [InlineData("landing-category", "tanahpediaCategory?")]
    [InlineData("landing-entry", "tanahpediaEntry?uniqueName=david")]
    [InlineData("entity-category", "tanahpediaCategory?")]
    [InlineData("entity-back", "..")]
    [InlineData("calendar-reader", null)]
    [InlineData("category-entry", "tanahpediaEntry?uniqueName=david")]
    [InlineData("list-article", "articleDetail?articleId=17&perekId=305")]
    [InlineData("parasha-list", "ParashaPage?unitId=1")]
    public async Task RejectedNavigation_DoesNotCrashOrPreventTheNextAttempt(
        string action, string? expectedRoute)
    {
        var navigator = new Mock<IAppNavigator>();
        navigator.SetupSequence(n => n.GoToAsync(It.IsAny<string>()))
            .ThrowsAsync(new InvalidOperationException("Route temporarily unavailable"))
            .Returns(Task.CompletedTask);
        var (command, parameter) = CreateCommand(action, navigator.Object);

        await command.ExecuteAsync(parameter);

        command.IsRunning.Should().BeFalse();
        command.ExecutionTask!.IsCompletedSuccessfully.Should().BeTrue();
        command.CanExecute(parameter).Should().BeTrue();

        await command.ExecuteAsync(parameter);

        command.ExecutionTask!.IsCompletedSuccessfully.Should().BeTrue();
        var routes = navigator.Invocations.Select(i => Assert.IsType<string>(i.Arguments[0])).ToArray();
        routes.Should().HaveCount(2, "the failed attempt must release the command and navigation gate");
        routes[0].Should().StartWith(expectedRoute ?? AppRoutes.CalendarReader + "?perekId=305");
        routes[1].Should().Be(routes[0]);
    }

    [Fact]
    public async Task RejectedArticleShare_KeepsTheArticleAndAllowsAnotherAttempt()
    {
        var share = new Mock<IShare>();
        share.SetupSequence(s => s.RequestAsync(It.IsAny<ShareTextRequest>()))
            .ThrowsAsync(new InvalidOperationException("Share sheet unavailable"))
            .Returns(Task.CompletedTask);
        var model = new ArticleDetailViewModel(new Mock<IAppNavigator>().Object, share.Object);
        var article = new Article { Id = 17, PerekId = 305, Name = "Test article", Abstract = "" };
        model.SetArticle(article);

        await model.ShareCommand.ExecuteAsync(null);

        model.Article.Should().BeSameAs(article);
        model.ShareCommand.IsRunning.Should().BeFalse();
        await model.ShareCommand.ExecuteAsync(null);
        share.Verify(s => s.RequestAsync(It.Is<ShareTextRequest>(r =>
            r.Uri == model.ShareUrl)), Times.Exactly(2));
    }

    [Theory]
    [InlineData(false, false)]
    [InlineData(true, false)]
    [InlineData(true, true)]
    public async Task ArticleChangedDuringPendingOperation_HandlesFailureAndCanRunAgain(
        bool authorNavigation, bool retainArticle)
    {
        var operation = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var navigator = new Mock<IAppNavigator>();
        navigator.Setup(n => n.GoToAsync(It.IsAny<string>())).Returns(operation.Task);
        var share = new Mock<IShare>();
        share.Setup(s => s.RequestAsync(It.IsAny<ShareTextRequest>())).Returns(operation.Task);
        var model = new ArticleDetailViewModel(navigator.Object, share.Object);
        var original = ArticleWithAuthor();
        model.SetArticle(original);
        var command = authorNavigation ? model.GoToAuthorCommand : model.ShareCommand;
        var pending = command.ExecuteAsync(null);
        pending.IsCompleted.Should().BeFalse();

        model.Article = retainArticle
            ? new Article { Id = 18, PerekId = 305, Name = "Replacement", Abstract = "" }
            : null;
        operation.SetException(new InvalidOperationException("Platform operation interrupted"));
        await pending;

        command.IsRunning.Should().BeFalse();
        command.ExecutionTask!.IsCompletedSuccessfully.Should().BeTrue();
        model.SetArticle(original);
        navigator.Setup(n => n.GoToAsync(It.IsAny<string>())).Returns(Task.CompletedTask);
        share.Setup(s => s.RequestAsync(It.IsAny<ShareTextRequest>())).Returns(Task.CompletedTask);
        await command.ExecuteAsync(null);
        model.Article.Should().BeSameAs(original);
        command.ExecutionTask!.IsCompletedSuccessfully.Should().BeTrue();
        if (authorNavigation)
        {
            navigator.Verify(n => n.GoToAsync(It.IsAny<string>()), Times.Exactly(2));
        }
        else
        {
            share.Verify(s => s.RequestAsync(It.IsAny<ShareTextRequest>()), Times.Exactly(2));
        }
    }

    [Fact]
    public void UncheckingMaskingRadioOptions_DoesNotOverwriteTheSelectedOptions()
    {
        var model = CreatePreferences(new Mock<IAppNavigator>().Object);
        _preferences.DivineNameMaskElohim = DivineNameMaskOption.Custom;
        _preferences.DivineNameMaskYhwh = DivineNameMaskOption.Custom;
        _preferences.DivineNameMaskEl = DivineNameMaskOption.Hyphen;
        _preferences.DivineNameMaskShaddai = DivineNameMaskOption.Custom;
        var notifications = new List<string?>();
        model.PropertyChanged += (_, e) => notifications.Add(e.PropertyName);

        model.IsMaskElohimAsIs = false;
        model.IsMaskElohimElokim = false;
        model.IsMaskElohimHyphen = false;
        model.IsMaskElohimCustom = false;
        model.IsMaskYhwhHeh = false;
        model.IsMaskYhwhDalet = false;
        model.IsMaskYhwhCustom = false;
        model.IsMaskElAsIs = false;
        model.IsMaskElHyphen = false;
        model.IsMaskShaddaiAsIs = false;
        model.IsMaskShaddaiHyphen = false;
        model.IsMaskShaddaiCustom = false;

        _preferences.DivineNameMaskElohim.Should().Be(DivineNameMaskOption.Custom);
        _preferences.DivineNameMaskYhwh.Should().Be(DivineNameMaskOption.Custom);
        _preferences.DivineNameMaskEl.Should().Be(DivineNameMaskOption.Hyphen);
        _preferences.DivineNameMaskShaddai.Should().Be(DivineNameMaskOption.Custom);
        notifications.Should().BeEmpty("radio deselection is a no-op, including preference notifications");
    }

    private PreferencesViewModel CreatePreferences(IAppNavigator navigator) => new(
        _preferences,
        PerushimNotesService.CreateForTesting(new Mock<IPadDeliveryService>().Object,
            Path.Join(Path.GetTempPath(), Path.GetRandomFileName())),
        CreateRecitation(), navigator);

    private static RecitationService CreateRecitation() => new(
        new Mock<IFileSystem>().Object, new Mock<IPadDeliveryService>().Object);

    private static Article ArticleWithAuthor() => new()
    {
        Id = 17, PerekId = 305, Name = "Test article", Abstract = "",
        Author = new Author { Id = 42, Name = "Test Author", Details = "" }
    };

    private (IAsyncRelayCommand Command, object? Parameter) CreateCommand(
        string action, IAppNavigator navigator)
    {
        if (action.StartsWith("recitation-", StringComparison.Ordinal))
        {
            var model = new RecitationPreferencesViewModel(CreateRecitation(), _preferences, navigator);
            return (action == "recitation-sound" ? model.OpenSoundCommand : model.OpenExtensionPacksCommand, null);
        }
        if (action.StartsWith("article-", StringComparison.Ordinal))
        {
            var model = new ArticleDetailViewModel(navigator, new Mock<IShare>().Object);
            model.SetArticle(ArticleWithAuthor());
            return (action == "article-back" ? model.GoBackCommand : model.GoToAuthorCommand, null);
        }
        if (action.StartsWith("landing-", StringComparison.Ordinal))
        {
            var model = new TanahpediaViewModel(new Mock<ITanahpediaService>().Object, navigator);
            return action == "landing-entry"
                ? (model.OpenEntryCommand, "david")
                : (model.OpenCategoryCommand,
                    new TanahpediaCategoryItem { Category = TanahpediaTaxonomy.Find("KING")! });
        }
        if (action.StartsWith("entity-", StringComparison.Ordinal))
        {
            var model = new TanahpediaEntryViewModel(new Mock<ITanahpediaService>().Object,
                navigator, new PerekDataService(new LocalDatabaseService(new Mock<IFileSystem>().Object)),
                StubDedicationService.Instance);
            return action == "entity-back"
                ? (model.GoBackCommand, null)
                : (model.OpenEntityCategoryCommand, new TanahpediaLinkedEntity { EntityType = "KING" });
        }
        if (action == "calendar-reader")
        {
            var database = new LocalDatabaseService(new Mock<IFileSystem>().Object);
            var schedule = new PerekScheduleService(database);
            var model = new LearningCalendarViewModel(schedule, new PerekDataService(database, schedule), navigator);
            return (model.OpenPerekCommand, new CalendarCellViewModel { PerekId = 305 });
        }
        if (action == "category-entry")
        {
            var model = new TanahpediaEntityTypeViewModel(new Mock<ITanahpediaService>().Object, navigator);
            return (model.OpenEntryCommand, "david");
        }
        if (action == "list-article")
        {
            var fileSystem = new Mock<IFileSystem>().Object;
            var model = new ArticlesViewModel(new StarterService(_transport.Client, fileSystem),
                new PerekDataService(new LocalDatabaseService(fileSystem)), navigator);
            return (model.OpenArticleCommand, ArticleWithAuthor());
        }
        if (action == "parasha-list")
        {
            var database = new LocalDatabaseService(new Mock<IFileSystem>().Object);
            var model = new ParashaListViewModel(new ParashaDataService(database),
                new PerekDataService(database), navigator);
            return (model.OpenParashaCommand, new ParashaUnit
            {
                UnitId = 1, Slug = "test", SeferName = "test", Heading = "test",
                TorahRange = new ScriptureRange { StartPerekId = 1, StartPasuk = 1, EndPerekId = 5, EndPasuk = 32 }
            });
        }
        var preferences = CreatePreferences(navigator);
        return (action switch
        {
            "display" => preferences.OpenDisplayCommand,
            "perek" => preferences.OpenPerekCommand,
            "packs" => preferences.OpenExtensionPacksCommand,
            "recitation" => preferences.OpenRecitationCommand,
            "sound" => preferences.OpenSoundCommand,
            "support" => preferences.OpenSupportCommand,
            _ => throw new ArgumentOutOfRangeException(nameof(action))
        }, null);
    }
}
