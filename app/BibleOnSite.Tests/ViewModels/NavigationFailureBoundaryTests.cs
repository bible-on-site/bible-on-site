using BibleOnSite.Models;
using BibleOnSite.Services;
using BibleOnSite.Tests.Support;
using BibleOnSite.ViewModels;
using Microsoft.Maui.ApplicationModel.DataTransfer;

namespace BibleOnSite.Tests.ViewModels;

/// <summary>
/// Failure boundaries added when navigation was serialized (#2810): a throwing
/// collaborator must surface as a logged error and never reach the caller.
/// </summary>
[Collection(PreferencesServiceCollection.Name)]
public sealed class NavigationFailureBoundaryTests : IDisposable
{
    private readonly PreferencesService _preferences;
    private readonly Mock<IAppNavigator> _navigator = new();

    public NavigationFailureBoundaryTests()
    {
        _preferences = PreferencesService.CreateForTesting(new InMemoryPreferencesStorage());
        _navigator.Setup(n => n.GoToAsync(It.IsAny<string>()))
            .ThrowsAsync(new InvalidOperationException("navigation fault"));
    }

    public void Dispose() => PreferencesService.ResetForTesting();

    [Fact]
    public async Task PreferencesOpenCommands_WhenNavigationThrows_DoNotPropagate()
    {
        var viewModel = new PreferencesViewModel(_preferences, PerushimNotesService.Instance,
            RecitationService.Instance, _navigator.Object);

        await viewModel.OpenDisplayAsync();
        await viewModel.OpenPerekAsync();
        await viewModel.OpenExtensionPacksAsync();
        await viewModel.OpenRecitationAsync();
        await viewModel.OpenSoundAsync();
        await viewModel.OpenSupportAsync();

        _navigator.Verify(n => n.GoToAsync(It.IsAny<string>()), Times.Exactly(6));
    }

    [Fact]
    public async Task RecitationPreferencesCommands_WhenNavigationThrows_DoNotPropagate()
    {
        var viewModel = new RecitationPreferencesViewModel(RecitationService.Instance,
            _preferences, _navigator.Object);

        await viewModel.OpenSoundAsync();
        await viewModel.OpenExtensionPacksAsync();

        _navigator.Verify(n => n.GoToAsync(It.IsAny<string>()), Times.Exactly(2));
    }

    [Fact]
    public async Task TanahpediaCommands_WhenNavigationThrows_DoNotPropagate()
    {
        var service = new Mock<ITanahpediaService>();
        var viewModel = new TanahpediaViewModel(service.Object, _navigator.Object);
        var item = new TanahpediaCategoryItem { Category = TanahpediaTaxonomy.Find("KING")! };

        await viewModel.OpenCategoryAsync(item);
        await viewModel.OpenEntryAsync("משה-רבנו");

        _navigator.Verify(n => n.GoToAsync(It.IsAny<string>()), Times.Exactly(2));
    }

    [Fact]
    public async Task TanahpediaEntityTypeOpenEntry_WhenNavigationThrows_DoesNotPropagate()
    {
        var viewModel = new TanahpediaEntityTypeViewModel(
            new Mock<ITanahpediaService>().Object, _navigator.Object);

        await viewModel.OpenEntryAsync("משה-רבנו");

        _navigator.Verify(n => n.GoToAsync(It.IsAny<string>()), Times.Once);
    }

    [Fact]
    public async Task TanahpediaEntryCommands_WhenNavigationThrows_DoNotPropagate()
    {
        var viewModel = new TanahpediaEntryViewModel(new Mock<ITanahpediaService>().Object,
            _navigator.Object, PerekDataService.Instance);

        await viewModel.OpenEntityCategoryAsync(new TanahpediaLinkedEntity { EntityType = "PERSON" });
        await viewModel.GoBackAsync();

        _navigator.Verify(n => n.GoToAsync(It.IsAny<string>()), Times.Exactly(2));
    }

    [Fact]
    public async Task ArticleDetailCommands_WhenCollaboratorsThrow_DoNotPropagate()
    {
        var share = new Mock<IShare>();
        share.Setup(s => s.RequestAsync(It.IsAny<ShareTextRequest>()))
            .ThrowsAsync(new InvalidOperationException("share fault"));
        var viewModel = new ArticleDetailViewModel(_navigator.Object, share.Object);
        viewModel.SetArticle(new Article
        {
            Abstract = "abstract",
            Author = new Author { Name = "author", Details = "details" }
        });

        await viewModel.ShareAsync();
        await viewModel.GoBackAsync();
        await viewModel.GoToAuthorAsync();

        _navigator.Verify(n => n.GoToAsync(It.IsAny<string>()), Times.Exactly(2));
    }

    [Fact]
    public async Task ArticlesOpenArticle_WhenNavigationThrows_DoesNotPropagate()
    {
        var viewModel = new ArticlesViewModel(StarterService.Instance,
            PerekDataService.Instance, _navigator.Object);

        await viewModel.OpenArticleAsync(new Article { Abstract = "abstract" });

        _navigator.Verify(n => n.GoToAsync(It.IsAny<string>()), Times.Once);
    }

    [Fact]
    public async Task ParashaListOpenParasha_WhenNavigationThrows_DoesNotPropagate()
    {
        var viewModel = new ParashaListViewModel(ParashaDataService.Instance,
            PerekDataService.Instance, _navigator.Object);

        await viewModel.OpenParashaCommand.ExecuteAsync(new ParashaUnit
        {
            UnitId = 1,
            Slug = "בראשית",
            SeferName = "בראשית",
            Heading = "בראשית",
            TorahRange = new ScriptureRange { StartPerekId = 1, StartPasuk = 1, EndPerekId = 1, EndPasuk = 1 }
        });

        _navigator.Verify(n => n.GoToAsync(It.IsAny<string>()), Times.Once);
    }
}
