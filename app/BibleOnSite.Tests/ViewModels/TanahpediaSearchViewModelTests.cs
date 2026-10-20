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
}
