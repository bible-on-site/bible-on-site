using BibleOnSite.Services;
using System.Reflection;

namespace BibleOnSite.Tests.Services;

public class AnalyticsServiceTests
{
    [Fact]
    public void IsAvailable_OnUnitTestHost_IsFalse()
    {
        // Firebase only exists on ANDROID/IOS builds; every other platform
        // compiles the `false` branch.
        typeof(AnalyticsService)
            .GetProperty("IsAvailable", BindingFlags.Static | BindingFlags.NonPublic)!
            .GetValue(null)
            .Should().Be(false);
    }

    [Fact]
    public void SetScreen_OnUnitTestHost_IsASafeNoOp()
    {
        var service = new AnalyticsService();

        FluentActions.Invoking(() =>
        {
            service.SetScreen("AlHaperek/1 בראשית א", "PerekPage");
            service.SetScreen("Article/42 מאמר", "ArticleDetailPage",
                new Dictionary<string, object> { ["article_id"] = 42 });
        }).Should().NotThrow(
            "analytics must never crash the reader — off Android/iOS both overloads no-op");
    }

    // — screen_view parameter merge (#3378) ——————————————————————————————

    [Fact]
    public void BuildScreenViewParams_WithoutExtras_KeepsLegacyPair()
    {
        var merged = AnalyticsService.BuildScreenViewParams("AlHaperek/1 בראשית א", "PerekPage", null);

        merged.Should().BeEquivalentTo(new Dictionary<string, object>
        {
            ["screen_name"] = "AlHaperek/1 בראשית א",
            ["screen_class"] = "PerekPage",
        });
    }

    [Fact]
    public void BuildScreenViewParams_NullClass_FallsBackToName()
    {
        var merged = AnalyticsService.BuildScreenViewParams("AuthorsPage", null, null);

        merged["screen_class"].Should().Be("AuthorsPage");
    }

    [Fact]
    public void BuildScreenViewParams_ContentParams_MergeUnderReservedFields()
    {
        var merged = AnalyticsService.BuildScreenViewParams(
            "Article/42 משה רבנו וסוד האחדות", "ArticleDetailPage",
            new Dictionary<string, object>
            {
                ["article_id"] = 42,
                ["article_title"] = "משה רבנו וסוד האחדות",
                ["perek_id"] = 1,
                ["perek_source"] = "בראשית א",
            });

        merged["article_id"].Should().Be(42);
        merged["article_title"].Should().Be("משה רבנו וסוד האחדות");
        merged["perek_id"].Should().Be(1);
        merged["perek_source"].Should().Be("בראשית א");
        merged["screen_name"].Should().Be("Article/42 משה רבנו וסוד האחדות");
        merged["screen_class"].Should().Be("ArticleDetailPage");
    }

    [Fact]
    public void BuildScreenViewParams_ContentParams_CannotSpoofReservedFields()
    {
        var merged = AnalyticsService.BuildScreenViewParams(
            "AlHaperek/1 בראשית א", "PerekPage",
            new Dictionary<string, object>
            {
                ["screen_name"] = "forged",
                ["screen_class"] = "forged",
                ["perek_id"] = 1,
            });

        merged["screen_name"].Should().Be("AlHaperek/1 בראשית א",
            "the descriptor owns the GA fields — content params cannot relabel them");
        merged["screen_class"].Should().Be("PerekPage");
        merged["perek_id"].Should().Be(1);
    }
}
