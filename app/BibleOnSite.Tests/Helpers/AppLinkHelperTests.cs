using BibleOnSite.Helpers;

namespace BibleOnSite.Tests.Helpers;

[Collection("Process environment")]
public class AppLinkHelperTests
{
    [Theory]
    [InlineData("https://www.929.org.il/929/1", 1)]
    [InlineData("https://929.org.il/929/2", 2)]
    [InlineData("https://xn--febl3a.co.il/929/929", 929)]
    [InlineData("https://xn--febl3a.com/929/300", 300)]
    [InlineData("https://www.929.org.il/929/123/איוב-כג", 123)]
    [InlineData("https://www.929.org.il/929/123?pasuk=5", 123)]
    [InlineData("https://www.929.org.il/929/123#footer", 123)]
    [InlineData("https://www.929.org.il/929/123/0", 123)]
    [InlineData("https://www.929.org.il/929/123/-1", 123)]
    public void TryParse_ValidPerekUrl_ReturnsPerekId(string url, int expected)
    {
        AppLinkHelper.TryParse(url, out var target).Should().BeTrue();
        target.PerekId.Should().Be(expected);
        target.ArticleId.Should().BeNull();
    }

    [Theory]
    [InlineData("https://xn--febl3a.co.il/929/123/456", 123, 456)]
    [InlineData("https://xn--febl3a.co.il/929/123/456?pasuk=5", 123, 456)]
    public void TryParse_ArticleUrl_ReturnsPerekAndArticle(
        string url, int expectedPerek, int expectedArticle)
    {
        AppLinkHelper.TryParse(url, out var target).Should().BeTrue();
        target.PerekId.Should().Be(expectedPerek);
        target.ArticleId.Should().Be(expectedArticle);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData("not a url")]
    [InlineData("929/1")]
    [InlineData("https://www.929.org.il/")]
    [InlineData("https://www.929.org.il/929")]
    [InlineData("https://www.929.org.il/929/")]
    [InlineData("https://www.929.org.il/929/0")]
    [InlineData("https://www.929.org.il/929/930")]
    [InlineData("https://www.929.org.il/929/-1")]
    [InlineData("https://www.929.org.il/929/abc")]
    [InlineData("https://www.929.org.il/930/1")]
    [InlineData("https://www.929.org.il/pedia/929/5")]
    public void TryParse_NotAPerekUrl_ReturnsFalse(string? url)
    {
        AppLinkHelper.TryParse(url, out var target).Should().BeFalse();
        target.PerekId.Should().Be(0);
        target.ArticleId.Should().BeNull();
    }

    [Fact]
    public void Request_BeforeTheReaderSubscribes_PreservesThePendingTarget()
    {
        var previous = AppLinkHelper.PendingTarget;
        try
        {
            var target = new AppLinkHelper.AppLinkTarget(55, 7);
            AppLinkHelper.Request(target);
            AppLinkHelper.PendingTarget.Should().Be(target);
        }
        finally
        {
            AppLinkHelper.PendingTarget = previous;
        }
    }

    [Fact]
    public void Request_StoresPendingTargetAndRaisesEvent()
    {
        AppLinkHelper.AppLinkTarget? raised = null;
        EventHandler<AppLinkHelper.AppLinkTarget> handler = (_, target) => raised = target;
        AppLinkHelper.TargetRequested += handler;
        try
        {
            AppLinkHelper.Request(new AppLinkHelper.AppLinkTarget(55, 7));
            AppLinkHelper.PendingTarget.Should().Be(new AppLinkHelper.AppLinkTarget(55, 7));
            raised.Should().Be(new AppLinkHelper.AppLinkTarget(55, 7));
        }
        finally
        {
            AppLinkHelper.TargetRequested -= handler;
            AppLinkHelper.PendingTarget = null;
        }
    }
}
