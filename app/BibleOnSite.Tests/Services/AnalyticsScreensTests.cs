using BibleOnSite.Services;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Maui;
using Microsoft.Maui.Controls;

namespace BibleOnSite.Tests.Services;

/// <summary>
/// #2119: Shell-level screen_view events must carry logical page names — never
/// Shell route URIs or the MainActivity/renderer classes Firebase's automatic
/// tracking produced — and self-reporting pages must not be double-counted.
/// #3378: the name alone is not enough — every content screen now resolves a
/// stable descriptor (readable screen_name, page-family screen_class, public
/// content-identity parameters) built from real article/perek/list data.
/// </summary>
[Collection("Application state")]
public class AnalyticsScreensTests
{
    private sealed class PlainPage : ContentPage { }

    private sealed class ScopedPage : ContentPage, IAnalyticsScreenName
    {
        public AnalyticsScreen? AnalyticsScreen =>
            AnalyticsScreens.ForArticle(42, "מאמר על הבריאה", 1, "בראשית א");
    }

    private sealed class SelfReportingPage : ContentPage, IAnalyticsScreenName
    {
        // The reader pattern: reports its own unit-scoped event, so the
        // Shell-level event is suppressed.
        public AnalyticsScreen? AnalyticsScreen => null;
    }

    // — Shell mapping ————————————————————————————————————————————————————

    [Fact]
    public void ScreenFor_NullPage_ReturnsNull()
    {
        AnalyticsScreens.ScreenFor(null).Should().BeNull();
    }

    [Fact]
    public void ScreenFor_PlainPage_UsesPageTypeNameForNameAndClass()
    {
        var screen = AnalyticsScreens.ScreenFor(new PlainPage());

        screen.Should().NotBeNull();
        screen!.Name.Should().Be("PlainPage");
        screen.Class.Should().Be("PlainPage",
            "a generic page keeps its stable family class even without content identity");
        screen.Parameters.Should().BeNull("a generic page has no content identity to report");
    }

    [Fact]
    public void ScreenFor_ScopedPage_ReturnsItsDescriptor()
    {
        var screen = AnalyticsScreens.ScreenFor(new ScopedPage());

        screen.Should().NotBeNull();
        screen!.Name.Should().Be("Article/42 מאמר על הבריאה");
        screen.Class.Should().Be("ArticleDetailPage");
    }

    [Fact]
    public void ScreenFor_SelfReportingPage_ReturnsNull()
    {
        AnalyticsScreens.ScreenFor(new SelfReportingPage()).Should().BeNull();
    }

    // — Reading units ————————————————————————————————————————————————————

    [Fact]
    public void ForPerek_WithSource_NamesIdAndCanonicalHebrewSource()
    {
        var screen = AnalyticsScreens.ForPerek(1, "בראשית א");

        screen.Name.Should().Be("AlHaperek/1 בראשית א");
        screen.Class.Should().Be("PerekPage",
            "screen_class stays the page family — content identity lives in the name and params");
        screen.Parameters.Should().Contain("perek_id", 1);
        screen.Parameters.Should().Contain("perek_source", "בראשית א");
    }

    [Fact]
    public void ForPerek_WithoutSource_KeepsStableIdName()
    {
        var screen = AnalyticsScreens.ForPerek(7, null);

        screen.Name.Should().Be("AlHaperek/7");
        screen.Parameters.Should().Contain("perek_id", 7);
        screen.Parameters.Should().NotContainKey("perek_source",
            "an unresolved label drops out instead of shipping an empty value");
    }

    [Fact]
    public void ForPerek_WhitespaceSource_DropsTheLabel()
    {
        var screen = AnalyticsScreens.ForPerek(7, "   ");

        screen.Name.Should().Be("AlHaperek/7");
        screen.Parameters.Should().NotContainKey("perek_source",
            "a whitespace-only label is no label — GA must not receive blank values");
    }

    [Fact]
    public void ForParasha_NamesUnitIdAndParashaTitle()
    {
        var screen = AnalyticsScreens.ForParasha(3, "פרשת וירא");

        screen.Name.Should().Be("ParashaAlHaperek/3 פרשת וירא");
        screen.Class.Should().Be("ParashaPage");
        screen.Parameters.Should().Contain("parasha_id", 3);
        screen.Parameters.Should().Contain("parasha_name", "פרשת וירא");
    }

    [Fact]
    public void ForMasora_NamesUnitIdAndHeading()
    {
        var screen = AnalyticsScreens.ForMasora(12, "בראשית פרשה ח");

        screen.Name.Should().Be("Masora/12 בראשית פרשה ח");
        screen.Class.Should().Be("MasoraPage");
        screen.Parameters.Should().Contain("masora_unit_id", 12);
        screen.Parameters.Should().Contain("masora_unit_name", "בראשית פרשה ח");
    }

    [Fact]
    public void ForMoed_NamesMoedIdAndOccasionName()
    {
        var screen = AnalyticsScreens.ForMoed(9, "תשעה באב");

        screen.Name.Should().Be("Moed/9 תשעה באב");
        screen.Class.Should().Be("MoedPage");
        screen.Parameters.Should().Contain("moed_id", 9);
        screen.Parameters.Should().Contain("moed_name", "תשעה באב");
    }

    // — Article detail ———————————————————————————————————————————————————

    [Fact]
    public void ForArticle_WithTitleAndPerekContext_NamesAllOfIt()
    {
        var screen = AnalyticsScreens.ForArticle(42, "משה רבנו וסוד האחדות", 1, "בראשית א");

        screen.Name.Should().Be("Article/42 משה רבנו וסוד האחדות");
        screen.Class.Should().Be("ArticleDetailPage");
        screen.Parameters.Should().Contain("article_id", 42);
        screen.Parameters.Should().Contain("article_title", "משה רבנו וסוד האחדות");
        screen.Parameters.Should().Contain("perek_id", 1);
        screen.Parameters.Should().Contain("perek_source", "בראשית א");
    }

    [Fact]
    public void ForArticle_UnresolvedMetadata_KeepsStableIdName()
    {
        var screen = AnalyticsScreens.ForArticle(42, null, null, null);

        screen.Name.Should().Be("Article/42");
        screen.Parameters.Should().Contain("article_id", 42);
        screen.Parameters.Should().NotContainKey("article_title");
        screen.Parameters.Should().NotContainKey("perek_id",
            "a zero/unknown perek id never ships as phantom identity");
    }

    [Fact]
    public void ForArticle_ZeroPerekId_DropsPerekParams()
    {
        var screen = AnalyticsScreens.ForArticle(7, "מאמר", 0, null);

        screen.Parameters.Should().NotContainKey("perek_id");
        screen.Parameters.Should().NotContainKey("perek_source");
    }

    [Fact]
    public void ForArticle_LongTitle_KeepsIdPrefixUnderValueLimit()
    {
        var longTitle = new string('א', 200);
        var screen = AnalyticsScreens.ForArticle(42, longTitle, 1, "בראשית א");

        screen.Name.Should().HaveLength(AnalyticsScreens.MaxValueLength);
        screen.Name.Should().StartWith("Article/42 ",
            "the stable id prefix survives truncation — the readable tail takes the cut");
        screen.Parameters!["article_title"].Should().Be(new string('א', AnalyticsScreens.MaxValueLength));
    }

    // — Articles catalogue/list scopes ———————————————————————————————————

    [Fact]
    public void ForArticlesList_PerekScope_IdentifiesThePerek()
    {
        var screen = AnalyticsScreens.ForArticlesList(
            "ArticlesPage", ArticlesListScope.Perek, 5, "בראשית ה");

        screen.Name.Should().Be("Articles/perek/5 בראשית ה");
        screen.Class.Should().Be("ArticlesPage");
        screen.Parameters.Should().Contain("list_scope", "perek");
        screen.Parameters.Should().Contain("perek_id", 5);
        screen.Parameters.Should().Contain("perek_source", "בראשית ה");
    }

    [Fact]
    public void ForArticlesList_AuthorScope_IdentifiesTheAuthor()
    {
        var screen = AnalyticsScreens.ForArticlesList(
            "ArticlesPage", ArticlesListScope.Author, 9, "הרב אבינר");

        screen.Name.Should().Be("Articles/author/9 הרב אבינר");
        screen.Parameters.Should().Contain("list_scope", "author");
        screen.Parameters.Should().Contain("author_id", 9);
        screen.Parameters.Should().Contain("author_name", "הרב אבינר");
    }

    [Fact]
    public void ForArticlesList_GlobalScope_IsExplicitlyGlobal()
    {
        var screen = AnalyticsScreens.ForArticlesList(
            "ArticlesPage", ArticlesListScope.All, 0, null);

        screen.Name.Should().Be("Articles/all",
            "a genuinely global list says so instead of borrowing a scope");
        screen.Class.Should().Be("ArticlesPage");
        screen.Parameters.Should().Contain("list_scope", "all");
        screen.Parameters.Should().NotContainKey("perek_id");
        screen.Parameters.Should().NotContainKey("author_id");
    }

    [Theory]
    [InlineData(ArticlesListScope.Parasha, "parasha", "parasha_id", "parasha_name")]
    [InlineData(ArticlesListScope.Masora, "masora", "masora_unit_id", "masora_unit_name")]
    [InlineData(ArticlesListScope.Moed, "moed", "moed_id", "moed_name")]
    public void ForArticlesList_DivisionScopes_CarryTheDivisionsOwnIdentity(
        ArticlesListScope scope, string scopeName, string idParam, string labelParam)
    {
        var screen = AnalyticsScreens.ForArticlesList(
            "ReaderArticles", scope, 4, "יחידה ד");

        screen.Name.Should().Be($"Articles/{scopeName}/4 יחידה ד");
        screen.Class.Should().Be("ReaderArticles",
            "the in-reader panel is its own stable family — distinct from the standalone catalogue");
        screen.Parameters.Should().Contain("list_scope", scopeName);
        screen.Parameters.Should().Contain(idParam, 4);
        screen.Parameters.Should().Contain(labelParam, "יחידה ד");
    }

    [Fact]
    public void ForArticlesList_ScopedWithoutLabel_KeepsIdName()
    {
        var screen = AnalyticsScreens.ForArticlesList(
            "ArticlesPage", ArticlesListScope.Author, 9, null);

        screen.Name.Should().Be("Articles/author/9");
        screen.Parameters.Should().Contain("author_id", 9);
        screen.Parameters.Should().NotContainKey("author_name");
    }

    [Fact]
    public void ForArticlesList_ScopedWithoutValidId_DropsEntityParams()
    {
        var screen = AnalyticsScreens.ForArticlesList(
            "ArticlesPage", ArticlesListScope.Perek, 0, "בראשית ה");

        screen.Name.Should().Be("Articles/perek",
            "an unresolved scope id cannot fabricate an entity the report never visited");
        screen.Parameters.Should().Contain("list_scope", "perek");
        screen.Parameters.Should().NotContainKey("perek_id");
        screen.Parameters.Should().NotContainKey("perek_source",
            "a label without its entity id would attach a name to nothing");
    }

    // — Report delivery —————————————————————————————————————————————————

    [Fact]
    public void Report_WithoutAnAnalyticsService_DoesNotThrow()
    {
        var screen = AnalyticsScreens.ForPerek(1, "בראשית א");

        var act = () => AnalyticsScreens.Report(screen);

        act.Should().NotThrow("a missing analytics service must never reach the caller");
    }

    [Fact]
    public void Report_ApplicationWithoutHandler_DoesNotThrow()
    {
        var previous = Application.Current;
        try
        {
            Application.Current = new Application();

            var act = () => AnalyticsScreens.Report(AnalyticsScreens.ForPerek(1, "בראשית א"));

            act.Should().NotThrow(
                "an app with no platform handler has no services — the lookup must stay safe");
        }
        finally
        {
            Application.Current = previous;
        }
    }

    [Fact]
    public void Report_HandlerWithoutMauiContext_DoesNotThrow()
    {
        var previous = Application.Current;
        try
        {
            var application = new Application
            {
                Handler = new Mock<IElementHandler>().Object,
            };
            Application.Current = application;

            var act = () => AnalyticsScreens.Report(AnalyticsScreens.ForPerek(1, "בראשית א"));

            act.Should().NotThrow(
                "a detached handler carries no MauiContext — the lookup must stay safe");
        }
        finally
        {
            Application.Current = previous;
        }
    }

    [Fact]
    public void Report_ContextWithoutService_DoesNotThrow()
    {
        var previous = Application.Current;
        try
        {
            using var services = new ServiceCollection().BuildServiceProvider();
            var context = new Mock<IMauiContext>();
            context.SetupGet(c => c.Services).Returns(services);
            var handler = new Mock<IElementHandler>();
            handler.SetupGet(h => h.MauiContext).Returns(context.Object);
            var application = new Application { Handler = handler.Object };
            Application.Current = application;

            var act = () => AnalyticsScreens.Report(AnalyticsScreens.ForPerek(1, "בראשית א"));

            act.Should().NotThrow(
                "a MauiContext without a registered analytics service resolves to null, not a crash");
        }
        finally
        {
            Application.Current = previous;
        }
    }

    [Fact]
    public void Report_ResolvedService_ReceivesTheDescriptor()
    {
        var previous = Application.Current;
        try
        {
            var analytics = new Mock<IAnalyticsService>();
            using var services = new ServiceCollection()
                .AddSingleton(analytics.Object)
                .BuildServiceProvider();
            var context = new Mock<IMauiContext>();
            context.SetupGet(c => c.Services).Returns(services);
            var handler = new Mock<IElementHandler>();
            handler.SetupGet(h => h.MauiContext).Returns(context.Object);
            var application = new Application { Handler = handler.Object };
            Application.Current = application;

            var screen = AnalyticsScreens.ForPerek(1, "בראשית א");
            AnalyticsScreens.Report(screen);

            analytics.Verify(s => s.SetScreen(
                "AlHaperek/1 בראשית א", "PerekPage",
                It.Is<IReadOnlyDictionary<string, object>?>(p =>
                    p != null && p["perek_id"].Equals(1) && (string)p["perek_source"] == "בראשית א")),
                Times.Once,
                "the shared lookup must deliver the descriptor's name, family class and params");
        }
        finally
        {
            Application.Current = previous;
        }
    }
}
