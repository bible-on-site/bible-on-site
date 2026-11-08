using BibleOnSite.Models;
using BibleOnSite.Services;
using BibleOnSite.ViewModels;
using Moq;

namespace BibleOnSite.Tests.ViewModels;

public class TanahpediaSearchViewModelTests
{
    private readonly Mock<ITanahpediaService> _service = new();

    private TanahpediaSearchViewModel Create() => new(_service.Object);

    private void SetupHits() =>
        _service.Setup(s => s.SearchEntriesAsync(
                It.IsAny<string>(), It.IsAny<int>(), It.IsAny<IReadOnlyCollection<string>?>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync([new TanahpediaSearchHit { Id = "e1", UniqueName = "משה-רבנו", Title = "משה רבנו", Excerpt = "", Score = 220 }]);

    [Fact]
    public void Landing_Default_SelectsTheWholeTaxonomy_AndSendsNoScope()
    {
        var vm = Create();

        vm.AllSelected.Should().BeTrue();
        vm.EffectiveCategories().Should().BeNull("a full selection is the unscoped query");
        vm.CategorySummary.Should().Be("הכל");
    }

    [Fact]
    public void CategoryPreset_NarrowsToTheCategory_Once()
    {
        var vm = Create();
        vm.ApplyCategoryPreset("PROPHET");

        vm.IsCategoryEnabled("PROPHET").Should().BeTrue();
        vm.IsCategoryEnabled("PERSON").Should().BeFalse("the subcategory preset must not widen to all people");
        vm.EffectiveCategories().Should().BeEquivalentTo(["PROPHET"]);

        // A second preset — e.g. the page re-appearing — must not reset the
        // deliberate selection.
        vm.SetCategoryEnabled("KING", true);
        vm.ApplyCategoryPreset("PLACE");
        vm.IsCategoryEnabled("PROPHET").Should().BeTrue();
        vm.IsCategoryEnabled("KING").Should().BeTrue();
        vm.IsCategoryEnabled("PLACE").Should().BeFalse();
    }

    [Fact]
    public void ParentToggle_CascadesToChildren_AndChildOffUnchecksParent()
    {
        var vm = Create();

        vm.SetCategoryEnabled("PERSON", false);
        vm.IsCategoryEnabled("PROPHET").Should().BeFalse();
        vm.IsCategoryEnabled("KING").Should().BeFalse();

        vm.SetCategoryEnabled("PERSON", true);
        vm.IsCategoryEnabled("PROPHET").Should().BeTrue();

        vm.SetCategoryEnabled("KING", false);
        vm.IsCategoryEnabled("PERSON").Should().BeFalse("a partial parent is not the whole-type predicate");
        vm.IsCategoryEnabled("PROPHET").Should().BeTrue();
    }

    [Fact]
    public void SelectAll_RestoresTheWholeTaxonomy()
    {
        var vm = Create();
        vm.SetCategoryEnabled("PERSON", false);
        vm.SetCategoryEnabled("PLACE", false);

        vm.SelectAllCategories();

        vm.AllSelected.Should().BeTrue();
        vm.EffectiveCategories().Should().BeNull();
    }

    [Fact]
    public async Task Search_PassesSelectedCategories_ToTheScopedQuery()
    {
        SetupHits();
        var vm = Create();
        vm.ApplyCategoryPreset("PERSON");
        vm.SearchPhrase = "משה";

        await vm.SearchAsync(TestContext.Current.CancellationToken);

        vm.Results.Should().ContainSingle().Which.UniqueName.Should().Be("משה-רבנו");
        _service.Verify(s => s.SearchEntriesAsync(
            "משה", 50,
            It.Is<IReadOnlyCollection<string>?>(keys => keys != null && keys.Contains("PERSON") && keys.Contains("PROPHET") && keys.Contains("KING")),
            It.IsAny<CancellationToken>()));
    }

    [Fact]
    public async Task Search_NoSelection_ReturnsEmptyWithoutCallingTheApi()
    {
        var vm = Create();
        vm.SearchPhrase = "משה";
        foreach (var key in TanahpediaSearchViewModel.AllCategoryKeys())
        {
            vm.SetCategoryEnabled(key, false);
        }

        await vm.SearchAsync(TestContext.Current.CancellationToken);

        vm.NoneSelected.Should().BeTrue();
        vm.Results.Should().BeEmpty();
        _service.Verify(s => s.SearchEntriesAsync(
            It.IsAny<string>(), It.IsAny<int>(), It.IsAny<IReadOnlyCollection<string>?>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    [Fact]
    public async Task Search_BlankPhrase_ClearsResultsWithoutCallingTheApi()
    {
        var vm = Create();
        vm.SearchPhrase = "   ";

        await vm.SearchAsync(TestContext.Current.CancellationToken);

        vm.Results.Should().BeEmpty();
        _service.Verify(s => s.SearchEntriesAsync(
            It.IsAny<string>(), It.IsAny<int>(), It.IsAny<IReadOnlyCollection<string>?>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    [Fact]
    public async Task Search_ServiceFailure_SurfacesAvailabilityNote()
    {
        _service.Setup(s => s.SearchEntriesAsync(
                It.IsAny<string>(), It.IsAny<int>(), It.IsAny<IReadOnlyCollection<string>?>(), It.IsAny<CancellationToken>()))
            .ThrowsAsync(new TimeoutException("offline"));

        var vm = Create();
        vm.SearchPhrase = "משה";

        await vm.SearchAsync(TestContext.Current.CancellationToken);

        vm.HasError.Should().BeTrue();
        vm.ErrorMessage.Should().Contain("אינו זמין");
        vm.IsLoading.Should().BeFalse();
    }

    [Fact]
    public void Toggle_UnknownKey_IsIgnored()
    {
        var vm = Create();

        vm.SetCategoryEnabled("WIZARD", false);
        vm.SetCategoryEnabled("WIZARD", true);

        vm.AllSelected.Should().BeTrue("an unknown key cannot touch the selection");
        vm.CategorySummary.Should().Be("הכל");
    }

    [Fact]
    public void CategoryPreset_EmptyOrUnknown_KeepsTheFullTaxonomy()
    {
        var vm = Create();

        vm.ApplyCategoryPreset(null);
        vm.AllSelected.Should().BeTrue();

        // The preset flag is consumed even by a no-op call — deliberate
        // choices stay authoritative afterwards either way.
        var unknown = Create();
        unknown.ApplyCategoryPreset("WIZARD");
        unknown.AllSelected.Should().BeTrue();
    }

    [Fact]
    public async Task Search_ObsoleteResponse_IsDiscarded()
    {
        var gate = new TaskCompletionSource<List<TanahpediaSearchHit>>();
        _service.Setup(s => s.SearchEntriesAsync(
                It.IsAny<string>(), It.IsAny<int>(), It.IsAny<IReadOnlyCollection<string>?>(), It.IsAny<CancellationToken>()))
            .Returns(gate.Task);

        var vm = Create();
        vm.SearchPhrase = "משה";
        var pending = vm.SearchAsync(TestContext.Current.CancellationToken);

        // A newer version (CancelSearch) must discard the late response.
        vm.CancelSearch();
        gate.SetResult([new TanahpediaSearchHit { Id = "e1", UniqueName = "משה-רבנו", Title = "משה רבנו", Excerpt = "", Score = 220 }]);
        await pending;

        vm.Results.Should().BeEmpty();
        vm.IsLoading.Should().BeFalse();
    }

    [Fact]
    public async Task Search_Cancellation_IsSwallowed()
    {
        using var cts = new CancellationTokenSource();
        _service.Setup(s => s.SearchEntriesAsync(
                It.IsAny<string>(), It.IsAny<int>(), It.IsAny<IReadOnlyCollection<string>?>(), It.IsAny<CancellationToken>()))
            .Returns<string, int, IReadOnlyCollection<string>?, CancellationToken>((_, _, _, ct) =>
                Task.FromException<List<TanahpediaSearchHit>>(new OperationCanceledException(ct)));

        var vm = Create();
        vm.SearchPhrase = "משה";
        await cts.CancelAsync();

        await vm.SearchAsync(cts.Token);

        vm.HasError.Should().BeFalse("a cancelled request is not an availability failure");
        vm.Results.Should().BeEmpty();
    }

    [Fact]
    public async Task Search_CancelledToken_DiscardsLateHits()
    {
        SetupHits();
        using var cts = new CancellationTokenSource();
        var vm = Create();
        vm.SearchPhrase = "משה";
        await cts.CancelAsync();

        // The request still returns hits, but a cancelled token means the
        // panel is gone — the response must be dropped, not rendered.
        await vm.SearchAsync(cts.Token);

        vm.Results.Should().BeEmpty();
        vm.HasResults.Should().BeFalse();
    }

    [Fact]
    public async Task Search_StaleFailure_DoesNotSurfaceAnError()
    {
        var gate = new TaskCompletionSource<List<TanahpediaSearchHit>>();
        _service.Setup(s => s.SearchEntriesAsync(
                It.IsAny<string>(), It.IsAny<int>(), It.IsAny<IReadOnlyCollection<string>?>(), It.IsAny<CancellationToken>()))
            .Returns(gate.Task);

        var vm = Create();
        vm.SearchPhrase = "משה";
        var pending = vm.SearchAsync(TestContext.Current.CancellationToken);

        // A failure that belongs to an obsolete search must not surface.
        vm.CancelSearch();
        gate.SetException(new TimeoutException("offline"));
        await pending;

        vm.HasError.Should().BeFalse();
        vm.Results.Should().BeEmpty();
    }

    [Fact]
    public void Setters_SameValue_DoNotNotify()
    {
        var vm = Create();
        var propertyChangedCount = 0;
        vm.PropertyChanged += (_, _) => propertyChangedCount++;

        // Assigning the current values is a no-op — no change notifications.
        var currentResults = vm.Results;
        vm.SearchPhrase = string.Empty;
        vm.Results = currentResults;
        vm.ErrorMessage = string.Empty;
        vm.IsLoading = false;
        vm.CategorySummary = "הכל";

        propertyChangedCount.Should().Be(0);
        vm.HasError.Should().BeFalse();
    }

    [Fact]
    public void ParameterlessCtor_UsesTheSharedService()
    {
        var vm = new TanahpediaSearchViewModel();
        vm.AllSelected.Should().BeTrue();
        vm.CategorySummary.Should().Be("הכל");
    }

    [Fact]
    public void Toggle_LeafChild_UnchecksItsParent()
    {
        var vm = Create();
        // KING is PERSON's second child — toggling it makes the parent
        // lookup evaluate a non-matching sibling before the match.
        const string leaf = "KING";

        vm.SetCategoryEnabled(leaf, false);

        vm.IsCategoryEnabled(leaf).Should().BeFalse();
        vm.IsCategoryEnabled("PERSON").Should().BeFalse("a child leaving unchecks its parent");
        vm.AllSelected.Should().BeFalse();
    }
}
