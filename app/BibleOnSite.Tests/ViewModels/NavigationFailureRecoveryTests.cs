using BibleOnSite.Helpers;
using BibleOnSite.Models;
using BibleOnSite.Services;
using BibleOnSite.Tests.Support;
using BibleOnSite.ViewModels;
using CommunityToolkit.Mvvm.Input;
using GraphQL.Client.Http;
using GraphQL.Client.Serializer.SystemTextJson;
using Moq.Protected;

namespace BibleOnSite.Tests.ViewModels;

/// <summary>A failed platform transition must leave the current page usable and allow a later attempt.</summary>
[Collection(PreferencesServiceCollection.Name)]
public sealed class NavigationFailureRecoveryTests : IDisposable
{
    public enum Destination
    {
        Display, Perek, ExtensionPacks, Recitation, Sound, Support,
        RecitationSound, RecitationPacks, ArticleBack, ArticleAuthor, Article,
        LandingCategory, LandingEntry, CategoryEntry, EntryCategory, EntryBack, Parasha, CalendarReader
    }

    public static IEnumerable<object[]> NavigationCases =>
        Enum.GetValues<Destination>().SelectMany(destination =>
            new[] { new object[] { destination, false }, new object[] { destination, true } });

    private readonly Mock<IFileSystem> _files = new(MockBehavior.Strict);
    private readonly Mock<IPadDeliveryService> _delivery = new(MockBehavior.Strict);
    private readonly Mock<ITanahpediaService> _pedia = new(MockBehavior.Strict);
    private readonly Mock<IDedicationService> _dedications = new(MockBehavior.Strict);
    private readonly GraphQLHttpClient _client = new(
        new GraphQLHttpClientOptions
        {
            EndPoint = new Uri("https://unused.invalid/graphql"),
            HttpMessageHandler = CreateHttpHandler()
        },
        new SystemTextJsonSerializer());

    private static HttpMessageHandler CreateHttpHandler()
    {
        var handler = new Mock<HttpMessageHandler>(MockBehavior.Strict);
        handler.Protected().Setup("Dispose", ItExpr.IsAny<bool>()).CallBase();
        return handler.Object;
    }

    [Theory]
    [MemberData(nameof(NavigationCases))]
    public async Task NavigationCommand_ContainsFailure_AndAllowsTheNextAttempt(
        Destination destination, bool asynchronousFailure)
    {
        var navigator = new Mock<IAppNavigator>(MockBehavior.Strict);
        var (command, parameter, route, assertState) = CreateCommand(destination, navigator.Object);
        var failure = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var sequence = navigator.SetupSequence(n => n.GoToAsync(route));
        if (asynchronousFailure)
        {
            sequence.Returns(failure.Task);
        }
        else
        {
            sequence.Throws(new InvalidOperationException("Navigation unavailable"));
        }
        sequence.Returns(Task.CompletedTask);

        var firstAttempt = command.ExecuteAsync(parameter);
        if (asynchronousFailure)
        {
            firstAttempt.IsCompleted.Should().BeFalse();
            command.IsRunning.Should().BeTrue();
            failure.SetException(new InvalidOperationException("Navigation unavailable"));
        }
        await firstAttempt;

        firstAttempt.IsCompletedSuccessfully.Should().BeTrue("bound command failures must be contained");
        command.IsRunning.Should().BeFalse();
        command.CanExecute(parameter).Should().BeTrue();
        assertState();
        navigator.Verify(n => n.GoToAsync(route), Times.Once);

        await command.ExecuteAsync(parameter);

        command.IsRunning.Should().BeFalse();
        assertState();
        navigator.Verify(n => n.GoToAsync(route), Times.Exactly(2),
            "a failed attempt must release the command and any view-model navigation gate");
        navigator.VerifyNoOtherCalls();
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task ShareCommand_ContainsFailure_AndAllowsTheNextAttempt(bool asynchronousFailure)
    {
        var share = new Mock<IShare>(MockBehavior.Strict);
        var navigator = new Mock<IAppNavigator>(MockBehavior.Strict);
        var model = new ArticleDetailViewModel(navigator.Object, share.Object);
        var article = CreateArticle();
        model.SetArticle(article);
        var requests = new List<ShareTextRequest>();
        var failure = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        share.Setup(s => s.RequestAsync(It.IsAny<ShareTextRequest>()))
            .Returns((ShareTextRequest request) =>
            {
                requests.Add(request);
                if (requests.Count > 1) { return Task.CompletedTask; }
                if (asynchronousFailure) { return failure.Task; }
                throw new InvalidOperationException("Share unavailable");
            });

        var firstAttempt = model.ShareCommand.ExecuteAsync(null);
        if (asynchronousFailure)
        {
            firstAttempt.IsCompleted.Should().BeFalse();
            failure.SetException(new InvalidOperationException("Share unavailable"));
        }
        await firstAttempt;
        firstAttempt.IsCompletedSuccessfully.Should().BeTrue();
        requests.Should().ContainSingle();
        model.ShareCommand.IsRunning.Should().BeFalse();
        model.ShareCommand.CanExecute(null).Should().BeTrue();
        AssertArticleState(model, article);

        await model.ShareCommand.ExecuteAsync(null);

        model.ShareCommand.IsRunning.Should().BeFalse();
        AssertArticleState(model, article);

        requests.Should().HaveCount(2);
        foreach (var request in requests)
        {
            request.Uri.Should().Be("https://תנך.co.il/929/42/7");
            request.Text.Should().Be("Test article - Test Author");
            request.Title.Should().Be("שתף מאמר");
        }
        share.Verify(s => s.RequestAsync(It.IsAny<ShareTextRequest>()), Times.Exactly(2));
        share.VerifyNoOtherCalls();
        navigator.VerifyNoOtherCalls();
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
        var original = CreateArticle();
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
        var preferences = PreferencesService.CreateForTesting(new InMemoryPreferencesStorage());
        var model = new PreferencesViewModel(preferences,
            PerushimNotesService.CreateForTesting(_delivery.Object,
                Path.Join(Path.GetTempPath(), Path.GetRandomFileName())),
            new RecitationService(_files.Object, _delivery.Object),
            new Mock<IAppNavigator>(MockBehavior.Strict).Object);
        preferences.DivineNameMaskElohim = DivineNameMaskOption.Custom;
        preferences.DivineNameMaskYhwh = DivineNameMaskOption.Custom;
        preferences.DivineNameMaskEl = DivineNameMaskOption.Hyphen;
        preferences.DivineNameMaskShaddai = DivineNameMaskOption.Custom;
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

        preferences.DivineNameMaskElohim.Should().Be(DivineNameMaskOption.Custom);
        preferences.DivineNameMaskYhwh.Should().Be(DivineNameMaskOption.Custom);
        preferences.DivineNameMaskEl.Should().Be(DivineNameMaskOption.Hyphen);
        preferences.DivineNameMaskShaddai.Should().Be(DivineNameMaskOption.Custom);
        notifications.Should().BeEmpty("radio deselection is a no-op, including preference notifications");
    }

    private (IAsyncRelayCommand Command, object? Parameter, string Route, Action AssertState) CreateCommand(
        Destination destination, IAppNavigator navigator)
    {
        var preferences = PreferencesService.CreateForTesting(new InMemoryPreferencesStorage());
        preferences.FontFactor = 1.25;
        preferences.RecitationVolume = 0.35;
        var recitation = new RecitationService(_files.Object, _delivery.Object);
        var database = new LocalDatabaseService(_files.Object);
        var perekData = new PerekDataService(database);

        if (destination <= Destination.Support)
        {
            var notes = PerushimNotesService.CreateForTesting(_delivery.Object,
                Path.Join(Path.GetTempPath(), Path.GetRandomFileName()));
            var settings = new PreferencesViewModel(preferences, notes, recitation, navigator);
            (IAsyncRelayCommand Command, object? Parameter, string Route) selected = destination switch
            {
                Destination.Display => (settings.OpenDisplayCommand, null, "DisplayPreferencesPage"),
                Destination.Perek => (settings.OpenPerekCommand, null, "PerekPreferencesPage"),
                Destination.ExtensionPacks => (settings.OpenExtensionPacksCommand, null, "ExtensionPacksPage"),
                Destination.Recitation => (settings.OpenRecitationCommand, null, "RecitationPreferencesPage"),
                Destination.Sound => (settings.OpenSoundCommand, null, "SoundPreferencesPage"),
                _ => (settings.OpenSupportCommand, null, "SupportPreferencesPage")
            };
            return (selected.Command, selected.Parameter, selected.Route, () =>
            {
                settings.FontFactor.Should().Be(1.25);
                preferences.FontFactor.Should().Be(1.25);
            });
        }

        if (destination is Destination.RecitationSound or Destination.RecitationPacks)
        {
            var settings = new RecitationPreferencesViewModel(recitation, preferences, navigator);
            IAsyncRelayCommand command = destination == Destination.RecitationSound
                ? settings.OpenSoundCommand : settings.OpenExtensionPacksCommand;
            var route = destination == Destination.RecitationSound
                ? "SoundPreferencesPage?focus=recitation" : "ExtensionPacksPage";
            return (command, null, route, () =>
            {
                settings.Volume.Should().Be(0.35);
                preferences.RecitationVolume.Should().Be(0.35);
            });
        }

        if (destination is Destination.ArticleBack or Destination.ArticleAuthor)
        {
            var detail = new ArticleDetailViewModel(navigator, new Mock<IShare>(MockBehavior.Strict).Object);
            var article = CreateArticle();
            detail.SetArticle(article);
            IAsyncRelayCommand command = destination == Destination.ArticleBack
                ? detail.GoBackCommand : detail.GoToAuthorCommand;
            var route = destination == Destination.ArticleBack
                ? ".." : "ArticlesPage?authorId=3&authorName=Test%20Author";
            return (command, null, route, () => AssertArticleState(detail, article));
        }

        if (destination == Destination.Article)
        {
            var listing = new ArticlesViewModel(new StarterService(_client, _files.Object),
                perekData, navigator, new ArticleService(_client));
            var article = CreateArticle();
            listing.Articles.Add(article);
            return (listing.OpenArticleCommand, article, "articleDetail?articleId=7&perekId=42", () =>
            {
                listing.Articles.Should().ContainSingle().Which.Should().BeSameAs(article);
                listing.IsLoading.Should().BeFalse();
            });
        }

        if (destination == Destination.Parasha)
        {
            var listing = new ParashaListViewModel(new ParashaDataService(database), perekData, navigator);
            var unit = new ParashaUnit
            {
                UnitId = 12, Slug = "test", SeferName = "Test", Heading = "Test", TorahRange = new ScriptureRange()
            };
            var group = new ParashaSeferGroup("Test") { unit };
            listing.Groups.Add(group);
            return (listing.OpenParashaCommand, unit, "ParashaPage?unitId=12", () =>
            {
                listing.Groups.Should().ContainSingle().Which.Should().BeSameAs(group);
                group.Should().ContainSingle().Which.Should().BeSameAs(unit);
                listing.IsLoading.Should().BeFalse();
            });
        }

        var landing = new TanahpediaViewModel(_pedia.Object, navigator);
        var recent = new TanahpediaEntry { UniqueName = "Current", Title = "Current entry" };
        landing.RecentEntries.Add(recent);
        Action assertLandingState = () =>
        {
            landing.RecentEntries.Should().ContainSingle().Which.Should().BeSameAs(recent);
            landing.HasError.Should().BeFalse();
        };
        var category = new TanahpediaEntityTypeViewModel(_pedia.Object, navigator)
        {
            CategoryKey = "PERSON", EntityType = "PERSON"
        };
        var title = category.Title;
        var entry = new TanahpediaEntryViewModel(_pedia.Object, navigator, perekData, _dedications.Object)
        {
            UniqueName = "Current", Title = "Current entry", Content = "<p>Current content</p>"
        };
        Action assertEntryState = () =>
        {
            entry.UniqueName.Should().Be("Current");
            entry.Title.Should().Be("Current entry");
            entry.Content.Should().Be("<p>Current content</p>");
            entry.HasEntryHistory.Should().BeFalse();
        };
        return destination switch
        {
            Destination.LandingCategory => (landing.OpenCategoryCommand,
                new TanahpediaCategoryItem { Category = TanahpediaTaxonomy.Find("KING")! },
                "tanahpediaCategory?key=KING&entityType=PERSON&sub=KING", assertLandingState),
            Destination.LandingEntry => (landing.OpenEntryCommand, "entry / name",
                "tanahpediaEntry?uniqueName=entry%20%2F%20name", assertLandingState),
            Destination.CategoryEntry => (category.OpenEntryCommand, "entry / name",
                "tanahpediaEntry?uniqueName=entry%20%2F%20name", () =>
                {
                    category.CategoryKey.Should().Be("PERSON");
                    category.EntityType.Should().Be("PERSON");
                    category.Title.Should().Be(title);
                }),
            Destination.EntryCategory => (entry.OpenEntityCategoryCommand,
                new TanahpediaLinkedEntity { EntityType = "PERSON", EntityName = "Current person" },
                "tanahpediaCategory?key=PERSON&entityType=PERSON", assertEntryState),
            Destination.EntryBack => (entry.GoBackCommand, null, "..", assertEntryState),
            Destination.CalendarReader => CreateCalendarReaderCommand(database, perekData, navigator),
            _ => throw new ArgumentOutOfRangeException(nameof(destination))
        };
    }

    private static (IAsyncRelayCommand Command, object? Parameter, string Route, Action AssertState)
        CreateCalendarReaderCommand(LocalDatabaseService database, PerekDataService perekData, IAppNavigator navigator)
    {
        var calendar = new LearningCalendarViewModel(new PerekScheduleService(database), perekData, navigator);
        var cell = new CalendarCellViewModel { PerekId = 305 };
        calendar.Cells.Add(cell);
        return (calendar.OpenPerekCommand, cell, AppRoutes.CalendarReader + "?perekId=305", () =>
        {
            calendar.Cells.Should().ContainSingle().Which.Should().BeSameAs(cell);
            cell.PerekId.Should().Be(305);
            calendar.IsLoading.Should().BeFalse();
        });
    }

    private static void AssertArticleState(ArticleDetailViewModel model, Article article)
    {
        model.Article.Should().BeSameAs(article);
        model.HasContent.Should().BeTrue();
        model.IsLoading.Should().BeFalse();
    }

    private static Article CreateArticle() => new()
    {
        Id = 7, PerekId = 42, AuthorId = 3, Abstract = "Test article", Name = "Test article",
        ArticleContent = "<p>Current article content</p>",
        Author = new Author { Id = 3, Name = "Test Author", Details = "Test biography" }
    };

    public void Dispose()
    {
        _client.Dispose();
        PreferencesService.ResetForTesting();
        DivineNameMasking.Apply(DivineNameMaskingOptions.Disabled);
    }
}
