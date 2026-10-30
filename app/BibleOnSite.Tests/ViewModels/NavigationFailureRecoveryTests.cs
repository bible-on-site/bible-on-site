using BibleOnSite.Helpers;
using BibleOnSite.Models;
using BibleOnSite.Services;
using BibleOnSite.Tests.Support;
using BibleOnSite.ViewModels;
using CommunityToolkit.Mvvm.Input;
using Microsoft.Maui.ApplicationModel.DataTransfer;

namespace BibleOnSite.Tests.ViewModels;

/// <summary>A failed platform transition must leave the current page usable and allow a later attempt.</summary>
[Collection(PreferencesServiceCollection.Name)]
public sealed class NavigationFailureRecoveryTests : IDisposable
{
    public void Dispose()
    {
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
    public async Task SettingsNavigation_WhenTransitionFails_PreservesPreferencesAndAllowsAnotherAttempt(
        string destination, string route)
    {
        await using var storage = new TestStorage();
        var preferences = PreferencesService.CreateForTesting(new InMemoryPreferencesStorage());
        preferences.FontFactor = 1.25;
        var delivery = new Mock<IPadDeliveryService>();
        var navigator = TransientNavigator(route);
        var viewModel = new PreferencesViewModel(preferences,
            PerushimNotesService.CreateForTesting(delivery.Object, storage.Root),
            new RecitationService(storage.FileSystem.Object, delivery.Object), navigator.Object);
        IAsyncRelayCommand command = destination switch
        {
            "display" => viewModel.OpenDisplayCommand,
            "perek" => viewModel.OpenPerekCommand,
            "packs" => viewModel.OpenExtensionPacksCommand,
            "recitation" => viewModel.OpenRecitationCommand,
            "sound" => viewModel.OpenSoundCommand,
            "support" => viewModel.OpenSupportCommand,
            _ => throw new ArgumentOutOfRangeException(nameof(destination))
        };

        await AssertNavigationRecoversAsync(command, null, navigator, route, () =>
        {
            viewModel.FontFactor.Should().Be(1.25);
            preferences.FontFactor.Should().Be(1.25);
        });
    }

    [Theory]
    [InlineData("sound", "SoundPreferencesPage?focus=recitation")]
    [InlineData("packs", "ExtensionPacksPage")]
    public async Task RecitationNavigation_WhenTransitionFails_PreservesPlaybackSettingsAndAllowsAnotherAttempt(
        string destination, string route)
    {
        await using var storage = new TestStorage();
        var preferences = PreferencesService.CreateForTesting(new InMemoryPreferencesStorage());
        preferences.RecitationVolume = 0.35;
        var navigator = TransientNavigator(route);
        var viewModel = new RecitationPreferencesViewModel(
            new RecitationService(storage.FileSystem.Object, new Mock<IPadDeliveryService>().Object),
            preferences, navigator.Object);
        IAsyncRelayCommand command = destination == "sound"
            ? viewModel.OpenSoundCommand
            : viewModel.OpenExtensionPacksCommand;

        await AssertNavigationRecoversAsync(command, null, navigator, route, () =>
        {
            viewModel.Volume.Should().Be(0.35);
            preferences.RecitationVolume.Should().Be(0.35);
        });
    }

    [Theory]
    [InlineData("back", "..")]
    [InlineData("author", "ArticlesPage?authorId=7&authorName=Aharon")]
    public async Task ArticleNavigation_WhenTransitionFails_KeepsTheArticleAndAllowsAnotherAttempt(
        string destination, string route)
    {
        var navigator = TransientNavigator(route);
        var viewModel = new ArticleDetailViewModel(navigator.Object, new Mock<IShare>(MockBehavior.Strict).Object);
        var article = Article();
        viewModel.SetArticle(article);
        IAsyncRelayCommand command = destination == "back"
            ? viewModel.GoBackCommand
            : viewModel.GoToAuthorCommand;

        await AssertNavigationRecoversAsync(command, null, navigator, route, () =>
        {
            viewModel.Article.Should().BeSameAs(article);
            viewModel.HasContent.Should().BeTrue();
            viewModel.IsLoading.Should().BeFalse();
        });
    }

    [Fact]
    public async Task ArticleShare_WhenPlatformFails_KeepsTheArticleAndAllowsSharingAgain()
    {
        var share = new Mock<IShare>(MockBehavior.Strict);
        share.SetupSequence(s => s.RequestAsync(It.IsAny<ShareTextRequest>()))
            .ThrowsAsync(new InvalidOperationException("Share sheet unavailable"))
            .Returns(Task.CompletedTask);
        var viewModel = new ArticleDetailViewModel(new Mock<IAppNavigator>(MockBehavior.Strict).Object, share.Object);
        var article = Article();
        viewModel.SetArticle(article);
        var attempt = () => viewModel.ShareCommand.ExecuteAsync(null);

        await attempt.Should().NotThrowAsync("a platform share failure must not escape an async UI command");
        viewModel.ShareCommand.IsRunning.Should().BeFalse();
        viewModel.Article.Should().BeSameAs(article);
        viewModel.HasContent.Should().BeTrue();
        await attempt.Should().NotThrowAsync();

        share.Verify(s => s.RequestAsync(It.Is<ShareTextRequest>(r =>
            r.Uri == "https://תנך.co.il/929/123/42" && r.Title == "שתף מאמר")), Times.Exactly(2));
        share.VerifyNoOtherCalls();
        viewModel.HasContent.Should().BeTrue();
    }

    [Theory]
    [InlineData("category", "tanahpediaCategory?key=PERSON&entityType=PERSON")]
    [InlineData("entry", "tanahpediaEntry?uniqueName=Samson")]
    public async Task TanahpediaLandingNavigation_WhenTransitionFails_KeepsContentAndReleasesItsGate(
        string destination, string route)
    {
        var navigator = TransientNavigator(route);
        var viewModel = new TanahpediaViewModel(new Mock<ITanahpediaService>(MockBehavior.Strict).Object,
            navigator.Object);
        var entry = new TanahpediaEntry { UniqueName = "Current", Title = "Current entry" };
        viewModel.RecentEntries.Add(entry);
        IAsyncRelayCommand command = destination == "category"
            ? viewModel.OpenCategoryCommand
            : viewModel.OpenEntryCommand;
        object parameter = destination == "category"
            ? new TanahpediaCategoryItem { Category = TanahpediaTaxonomy.Find("PERSON")! }
            : "Samson";

        await AssertNavigationRecoversAsync(command, parameter, navigator, route, () =>
        {
            viewModel.RecentEntries.Should().ContainSingle().Which.Should().BeSameAs(entry);
            viewModel.HasError.Should().BeFalse();
        });
    }

    [Fact]
    public async Task TanahpediaCategoryNavigation_WhenTransitionFails_KeepsTheCategoryAndReleasesItsGate()
    {
        const string route = "tanahpediaEntry?uniqueName=Samson";
        var navigator = TransientNavigator(route);
        var viewModel = new TanahpediaEntityTypeViewModel(
            new Mock<ITanahpediaService>(MockBehavior.Strict).Object, navigator.Object)
        {
            CategoryKey = "PERSON",
            EntityType = "PERSON"
        };
        var title = viewModel.Title;

        await AssertNavigationRecoversAsync(viewModel.OpenEntryCommand, "Samson", navigator, route, () =>
        {
            viewModel.CategoryKey.Should().Be("PERSON");
            viewModel.EntityType.Should().Be("PERSON");
            viewModel.Title.Should().Be(title);
        });
    }

    [Theory]
    [InlineData("category", "tanahpediaCategory?key=PERSON&entityType=PERSON")]
    [InlineData("back", "..")]
    public async Task TanahpediaEntryNavigation_WhenTransitionFails_KeepsTheEntryAndReleasesItsGate(
        string destination, string route)
    {
        await using var storage = new TestStorage();
        var navigator = TransientNavigator(route);
        var viewModel = new TanahpediaEntryViewModel(new Mock<ITanahpediaService>(MockBehavior.Strict).Object,
            navigator.Object, new PerekDataService(new LocalDatabaseService(storage.FileSystem.Object)),
            StubDedicationService.Instance)
        {
            UniqueName = "Current",
            Title = "Current entry",
            Content = "<p>Current content</p>"
        };
        IAsyncRelayCommand command = destination == "category"
            ? viewModel.OpenEntityCategoryCommand
            : viewModel.GoBackCommand;
        object? parameter = destination == "category"
            ? new TanahpediaLinkedEntity { EntityType = "PERSON", EntityName = "Current person" }
            : null;

        await AssertNavigationRecoversAsync(command, parameter, navigator, route, () =>
        {
            viewModel.UniqueName.Should().Be("Current");
            viewModel.Title.Should().Be("Current entry");
            viewModel.Content.Should().Be("<p>Current content</p>");
            viewModel.HasEntryHistory.Should().BeFalse();
        });
    }

    private static Mock<IAppNavigator> TransientNavigator(string route)
    {
        var navigator = new Mock<IAppNavigator>(MockBehavior.Strict);
        navigator.SetupSequence(n => n.GoToAsync(route))
            .ThrowsAsync(new InvalidOperationException("Transition unavailable"))
            .Returns(Task.CompletedTask);
        return navigator;
    }

    private static async Task AssertNavigationRecoversAsync(IAsyncRelayCommand command, object? parameter,
        Mock<IAppNavigator> navigator, string route, Action assertState)
    {
        var attempt = () => command.ExecuteAsync(parameter);
        await attempt.Should().NotThrowAsync("a failed native transition must not crash the current page");
        command.IsRunning.Should().BeFalse();
        command.CanExecute(parameter).Should().BeTrue();
        assertState();

        await attempt.Should().NotThrowAsync("the failed transition must release its navigation gate");
        assertState();

        navigator.Verify(n => n.GoToAsync(route), Times.Exactly(2));
        navigator.VerifyNoOtherCalls();
    }

    private static Article Article() => new()
    {
        Id = 42,
        PerekId = 123,
        Name = "Article",
        Abstract = "<h1>Article</h1>",
        ArticleContent = "<p>Current article content</p>",
        AuthorId = 7,
        Author = new Author { Id = 7, Name = "Aharon", Details = "Author" }
    };
}
