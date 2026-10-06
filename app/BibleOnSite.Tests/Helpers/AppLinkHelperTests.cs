using BibleOnSite.Helpers;

namespace BibleOnSite.Tests.Helpers;

public class AppLinkHelperTests
{
    [Theory]
    [InlineData("https://www.929.org.il/929/1", 1)]
    [InlineData("https://929.org.il/929/2", 2)]
    [InlineData("https://xn--febl3a.co.il/929/929", 929)]
    [InlineData("https://www.929.org.il/929/123/איוב-כג", 123)]
    [InlineData("https://www.929.org.il/929/123?pasuk=5", 123)]
    [InlineData("https://www.929.org.il/929/123#footer", 123)]
    public void TryParsePerekId_ValidPerekUrl_ReturnsPerekId(string url, int expected)
    {
        AppLinkHelper.TryParsePerekId(url, out var perekId).Should().BeTrue();
        perekId.Should().Be(expected);
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
    public void TryParsePerekId_NotAPerekUrl_ReturnsFalse(string? url)
    {
        AppLinkHelper.TryParsePerekId(url, out var perekId).Should().BeFalse();
        perekId.Should().Be(0);
    }

    [Fact]
    public void RequestPerek_StoresPendingIdAndRaisesEvent()
    {
        int? raised = null;
        EventHandler<int> handler = (_, id) => raised = id;
        AppLinkHelper.PerekRequested += handler;
        try
        {
            AppLinkHelper.RequestPerek(55);
            AppLinkHelper.PendingPerekId.Should().Be(55);
            raised.Should().Be(55);
        }
        finally
        {
            AppLinkHelper.PerekRequested -= handler;
            AppLinkHelper.PendingPerekId = null;
        }
    }
}
