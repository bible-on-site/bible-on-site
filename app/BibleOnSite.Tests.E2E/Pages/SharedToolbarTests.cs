using BibleOnSite.Tests.E2E.Fixtures;

namespace BibleOnSite.Tests.E2E.Pages;

/// <summary>
/// Toolbar parity guard for #2061: the רבנים page must render the same shared
/// top bar as the על הפרק reader — identical band, hamburger and center pill
/// geometry in the same build, theme and viewport.
/// </summary>
[Collection(nameof(AppCollection))]
public class SharedToolbarTests(AppFixture fixture)
{
    [Fact]
    public async Task AuthorsToolbar_MatchesReaderToolbarGeometry()
    {
        var readerMenu = await fixture.WaitForElementAsync(window =>
            window.FindFirstDescendant(fixture.CF.ByAutomationId("ReaderNavigationButton")), TimeSpan.FromSeconds(30));
        readerMenu.Should().NotBeNull("the reader toolbar finishes loading");
        var readerPill = await fixture.WaitForElementAsync(window =>
            window.FindFirstDescendant(fixture.CF.ByAutomationId("PerekSource")));
        readerPill.Should().NotBeNull("the reader center pill is present");

        var menuBounds = readerMenu!.BoundingRectangle;
        var pillBounds = readerPill!.BoundingRectangle;

        fixture.Click(readerMenu);
        var authorsItem = await fixture.WaitForElementAsync(window =>
            window.FindAllDescendants(fixture.CF.ByName("רבנים"))
                .FirstOrDefault(item => !item.IsOffscreen), TimeSpan.FromSeconds(10));
        authorsItem.Should().NotBeNull("the flyout lists רבנים");
        fixture.Click(authorsItem!);

        var authorsMenu = await fixture.WaitForElementAsync(window =>
            window.FindFirstDescendant(fixture.CF.ByAutomationId("AuthorsNavigationButton")), TimeSpan.FromSeconds(15));
        authorsMenu.Should().NotBeNull("רבנים renders the shared hamburger, not a Back arrow");
        var authorsPill = await fixture.WaitForElementAsync(window =>
            window.FindFirstDescendant(fixture.CF.ByAutomationId("AuthorsSearchPill")));
        authorsPill.Should().NotBeNull("רבנים renders the shared pill-shaped control");
        var searchField = await fixture.WaitForElementAsync(window =>
            window.FindFirstDescendant(fixture.CF.ByAutomationId("AuthorsSearchInput")));
        searchField.Should().NotBeNull("the pill hosts the רבנים search field");

        authorsMenu!.BoundingRectangle.Top.Should().BeInRange(menuBounds.Top - 4, menuBounds.Top + 4,
            "the hamburger sits at the same height as on על הפרק");
        authorsMenu.BoundingRectangle.Right.Should().BeInRange(menuBounds.Right - 4, menuBounds.Right + 4,
            "the hamburger hugs the same edge as on על הפרק");
        authorsMenu.BoundingRectangle.Height.Should().BeInRange(menuBounds.Height - 4, menuBounds.Height + 4,
            "the shared bar keeps the reader's 56px height");
        authorsPill!.BoundingRectangle.Top.Should().BeInRange(pillBounds.Top - 4, pillBounds.Top + 4,
            "the search pill aligns with the reader's title pill");
        authorsPill.BoundingRectangle.Height.Should().BeInRange(pillBounds.Height - 4, pillBounds.Height + 4,
            "the search pill keeps the reader's pill height");
        authorsPill.BoundingRectangle.Right.Should().BeInRange(pillBounds.Right - 4, pillBounds.Right + 4,
            "the search pill spans the same width as the reader's pill");

        var fieldBounds = searchField!.BoundingRectangle;
        fieldBounds.Top.Should().BeGreaterThanOrEqualTo(authorsPill.BoundingRectangle.Top);
        fieldBounds.Bottom.Should().BeLessThanOrEqualTo(authorsPill.BoundingRectangle.Bottom,
            "the field stays inside the pill");
        fieldBounds.Left.Should().BeGreaterThanOrEqualTo(authorsPill.BoundingRectangle.Left);
        fieldBounds.Right.Should().BeLessThanOrEqualTo(authorsPill.BoundingRectangle.Right);
    }
}
