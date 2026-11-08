using BibleOnSite.Helpers;
using BibleOnSite.Services;
using Microsoft.Maui.ApplicationModel;
using Moq;

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
    [InlineData("https://xn--febl3a.co.il/929/123?pasuk=5", 5)]
    [InlineData("https://xn--febl3a.co.il/929/123?pasuk=5&note=2", 5)]
    [InlineData("https://xn--febl3a.co.il/929/123?note=2&pasuk=9", 9)]
    [InlineData("https://xn--febl3a.co.il/929/123#pasuk-7", 7)]
    [InlineData("https://xn--febl3a.co.il/929/123/%D7%90%D7%99%D7%95%D7%91-%D7%9B%D7%92?pasuk=4", 4)]
    [InlineData("https://xn--febl3a.co.il/929/123?pasuk=3#pasuk-9", 3)] // query wins over the fragment
    public void TryParse_PasukMarkedUrl_ReturnsPasukNumber(string url, int expectedPasuk)
    {
        AppLinkHelper.TryParse(url, out var target).Should().BeTrue();
        target.PasukNumber.Should().Be(expectedPasuk);
    }

    [Theory]
    [InlineData("https://xn--febl3a.co.il/929/123/456?pasuk=3")]
    [InlineData("https://xn--febl3a.co.il/929/123/456#pasuk-3")]
    public void TryParse_ArticleUrl_DropsThePasukAnchor(string url)
    {
        // The website's article route ignores ?pasuk — it scrolls to
        // article-view and only ?q marks an in-article landing — so an
        // article target must not carry a reader pasuk landing.
        AppLinkHelper.TryParse(url, out var target).Should().BeTrue();
        target.ArticleId.Should().Be(456);
        target.PasukNumber.Should().BeNull();
    }

    [Theory]
    [InlineData("https://xn--febl3a.co.il/929/123?pasuk=0")]
    [InlineData("https://xn--febl3a.co.il/929/123?pasuk=-1")]
    [InlineData("https://xn--febl3a.co.il/929/123?pasuk=abc")]
    [InlineData("https://xn--febl3a.co.il/929/123?pasuk=")]
    [InlineData("https://xn--febl3a.co.il/929/123?pasuk")]
    [InlineData("https://xn--febl3a.co.il/929/123#pasuk-0")]
    [InlineData("https://xn--febl3a.co.il/929/123#pasuk-")]
    [InlineData("https://xn--febl3a.co.il/929/123#pasuk-abc")]
    [InlineData("https://xn--febl3a.co.il/929/123#pasuk-5-2")] // ranged unit anchor, not a perek pasuk
    [InlineData("https://xn--febl3a.co.il/929/123#footer")]
    public void TryParse_InvalidPasukMarker_ReturnsNoPasuk(string url)
    {
        AppLinkHelper.TryParse(url, out var target).Should().BeTrue();
        target.PasukNumber.Should().BeNull();
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

    [Theory]
    [InlineData("/929/125/337", "https://xn--febl3a.co.il/929/125/337")]
    [InlineData(" /929/125 ", "https://xn--febl3a.co.il/929/125")]
    [InlineData("/pedia/דתן", "https://xn--febl3a.co.il/pedia/%D7%93%D7%AA%D7%9F")]
    [InlineData("https://xn--febl3a.com/929/3", "https://xn--febl3a.com/929/3")]
    [InlineData("https://www.xn--febl3a.co.il/929/3", "https://www.xn--febl3a.co.il/929/3")]
    [InlineData("https://תנך.co.il/929/4/5", "https://תנך.co.il/929/4/5")]
    public void TryResolveSiteUrl_WebsiteLink_ReturnsAbsoluteSiteUrl(string href, string expected)
    {
        AppLinkHelper.TryResolveSiteUrl(href, out var siteUrl).Should().BeTrue();
        siteUrl.AbsoluteUri.Should().Be(new Uri(expected).AbsoluteUri);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("#note-1")]
    [InlineData("929/1")]
    [InlineData("//example.com/929/1")]
    [InlineData("https://example.com/929/1")]
    [InlineData("https://www.929.org.il/929/1")]
    [InlineData("mailto:info@example.com")]
    public void TryResolveSiteUrl_NonSiteLink_ReturnsFalse(string? href)
    {
        AppLinkHelper.TryResolveSiteUrl(href, out _).Should().BeFalse();
    }

    [Theory]
    [InlineData("/929/125/337", 125, 337)]
    [InlineData("/929/125", 125, null)]
    [InlineData("https://xn--febl3a.co.il/929/7/8", 7, 8)]
    public async Task FollowContentLinkAsync_PerekLink_RequestsNativeNavigation(
        string href, int expectedPerek, int? expectedArticle)
    {
        var opened = new List<Uri>();
        try
        {
            await AppLinkHelper.FollowContentLinkAsync(href, uri => { opened.Add(uri); return Task.CompletedTask; });
            AppLinkHelper.PendingTarget.Should().Be(new AppLinkHelper.AppLinkTarget(expectedPerek, expectedArticle));
            opened.Should().BeEmpty();
        }
        finally
        {
            AppLinkHelper.PendingTarget = null;
        }
    }

    [Theory]
    [InlineData("/pedia/דתן", "https://xn--febl3a.co.il/pedia/%D7%93%D7%AA%D7%9F")]
    [InlineData("/929/930", "https://xn--febl3a.co.il/929/930")]
    [InlineData("https://example.com/929/1", "https://example.com/929/1")]
    [InlineData("mailto:info@example.com", "mailto:info@example.com")]
    public async Task FollowContentLinkAsync_OtherLink_OpensInBrowser(string href, string expected)
    {
        AppLinkHelper.PendingTarget = null;
        var opened = new List<Uri>();
        await AppLinkHelper.FollowContentLinkAsync(href, uri => { opened.Add(uri); return Task.CompletedTask; });
        opened.Select(u => u.AbsoluteUri).Should().Equal(new Uri(expected).AbsoluteUri);
        AppLinkHelper.PendingTarget.Should().BeNull();
    }

    [Theory]
    [InlineData(null)]
    [InlineData("#note-1")]
    [InlineData("929/1")]
    public async Task FollowContentLinkAsync_UnresolvableLink_DoesNothing(string? href)
    {
        AppLinkHelper.PendingTarget = null;
        var opened = new List<Uri>();
        await AppLinkHelper.FollowContentLinkAsync(href, uri => { opened.Add(uri); return Task.CompletedTask; });
        opened.Should().BeEmpty();
        AppLinkHelper.PendingTarget.Should().BeNull();
    }

    [Fact]
    public async Task FollowContentLinkAsync_PediaLink_UsesEntryHandlerWhenGiven()
    {
        AppLinkHelper.PendingTarget = null;
        var opened = new List<Uri>();
        var entries = new List<string>();
        await AppLinkHelper.FollowContentLinkAsync("/pedia/%D7%93%D7%AA%D7%9F",
            uri => { opened.Add(uri); return Task.CompletedTask; },
            uniqueName => { entries.Add(uniqueName); return Task.CompletedTask; });
        entries.Should().Equal("דתן");
        opened.Should().BeEmpty();
        AppLinkHelper.PendingTarget.Should().BeNull();
    }

    [Theory]
    [InlineData("/929/125/337", 125, 337, null)]
    [InlineData("/929/125", 125, null, null)]
    [InlineData("/929/125#pasuk-4", 125, null, 4)]
    [InlineData("/929/125/337?pasuk=4", 125, 337, null)] // article route ignores the anchor
    [InlineData("https://xn--febl3a.co.il/929/7/8", 7, 8, null)]
    public void ClassifyContentLink_PerekLink_ReturnsPerekTarget(
        string href, int expectedPerek, int? expectedArticle, int? expectedPasuk)
    {
        var link = AppLinkHelper.ClassifyContentLink(href);
        link.Kind.Should().Be(AppLinkHelper.ContentLinkKind.Perek);
        link.Target.Should().Be(new AppLinkHelper.AppLinkTarget(expectedPerek, expectedArticle, expectedPasuk));
    }

    [Theory]
    [InlineData("/pedia/דתן", "דתן")]
    [InlineData("https://xn--febl3a.co.il/pedia/%D7%93%D7%AA%D7%9F", "דתן")]
    [InlineData("https://xn--febl3a.com/pedia/אברהם?x=1#y", "אברהם")]
    public void ClassifyContentLink_PediaLink_ReturnsEntry(string href, string expected)
    {
        var link = AppLinkHelper.ClassifyContentLink(href);
        link.Kind.Should().Be(AppLinkHelper.ContentLinkKind.PediaEntry);
        link.EntryUniqueName.Should().Be(expected);
        // The resolved site URL rides along as the browser fallback for
        // callers that do not handle entries natively.
        AppLinkHelper.TryResolveSiteUrl(href, out var siteUrl).Should().BeTrue();
        link.BrowserUri.Should().Be(siteUrl);
    }

    [Theory]
    [InlineData("/929/930", "https://xn--febl3a.co.il/929/930")] // out-of-range perek
    [InlineData("/accessibility", "https://xn--febl3a.co.il/accessibility")]
    [InlineData("/pedia/", "https://xn--febl3a.co.il/pedia/")] // no slug — not an entry
    public void ClassifyContentLink_OtherSitePage_ReturnsSitePage(string href, string expected)
    {
        var link = AppLinkHelper.ClassifyContentLink(href);
        link.Kind.Should().Be(AppLinkHelper.ContentLinkKind.SitePage);
        link.BrowserUri!.AbsoluteUri.Should().Be(new Uri(expected).AbsoluteUri);
    }

    [Theory]
    [InlineData("https://example.com/929/1")]
    [InlineData("mailto:info@example.com")]
    public void ClassifyContentLink_OffSiteLink_ReturnsExternal(string href)
    {
        var link = AppLinkHelper.ClassifyContentLink(href);
        link.Kind.Should().Be(AppLinkHelper.ContentLinkKind.External);
        link.BrowserUri.Should().Be(new Uri(href));
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("#note-1")]
    [InlineData("929/1")]
    [InlineData("//example.com/929/1")]
    [InlineData("not a url")]
    public void ClassifyContentLink_UnresolvableLink_ReturnsIgnored(string? href)
    {
        var link = AppLinkHelper.ClassifyContentLink(href);
        link.Kind.Should().Be(AppLinkHelper.ContentLinkKind.Ignored);
        link.BrowserUri.Should().BeNull();
    }

    [Fact]
    public async Task FollowHtmlLinkAsync_PerekLink_RequestsNativeNavigationOnly()
    {
        var launcher = new Mock<ILauncher>();
        var navigator = new Mock<IAppNavigator>();
        try
        {
            await AppLinkHelper.FollowHtmlLinkAsync("/929/125/337", launcher.Object, navigator.Object);
            AppLinkHelper.PendingTarget.Should().Be(new AppLinkHelper.AppLinkTarget(125, 337));
            launcher.Verify(l => l.OpenAsync(It.IsAny<Uri>()), Times.Never);
            navigator.Verify(n => n.GoToAsync(It.IsAny<string>()), Times.Never);
        }
        finally
        {
            AppLinkHelper.PendingTarget = null;
        }
    }

    [Fact]
    public async Task FollowHtmlLinkAsync_PediaLink_PushesEntryRouteOnly()
    {
        var launcher = new Mock<ILauncher>();
        var navigator = new Mock<IAppNavigator>();
        navigator.Setup(n => n.GoToAsync(It.IsAny<string>())).Returns(Task.CompletedTask);
        AppLinkHelper.PendingTarget = null;

        await AppLinkHelper.FollowHtmlLinkAsync("/pedia/דתן", launcher.Object, navigator.Object);

        navigator.Verify(n => n.GoToAsync(
            $"tanahpediaEntry?uniqueName={Uri.EscapeDataString("דתן")}"), Times.Once);
        launcher.Verify(l => l.OpenAsync(It.IsAny<Uri>()), Times.Never);
        AppLinkHelper.PendingTarget.Should().BeNull();
    }

    [Fact]
    public async Task FollowHtmlLinkAsync_ExternalLink_OpensBrowserOnly()
    {
        var launcher = new Mock<ILauncher>();
        launcher.Setup(l => l.OpenAsync(It.IsAny<Uri>())).ReturnsAsync(true);
        var navigator = new Mock<IAppNavigator>();
        AppLinkHelper.PendingTarget = null;

        await AppLinkHelper.FollowHtmlLinkAsync("https://example.com/x",
            launcher.Object, navigator.Object);

        launcher.Verify(l => l.OpenAsync(new Uri("https://example.com/x")), Times.Once);
        navigator.Verify(n => n.GoToAsync(It.IsAny<string>()), Times.Never);
        AppLinkHelper.PendingTarget.Should().BeNull();
    }

    [Fact]
    public async Task FollowHtmlLinkAsync_UnresolvableLink_DoesNothing()
    {
        var launcher = new Mock<ILauncher>();
        var navigator = new Mock<IAppNavigator>();
        AppLinkHelper.PendingTarget = null;

        await AppLinkHelper.FollowHtmlLinkAsync("#note-1", launcher.Object, navigator.Object);

        launcher.Verify(l => l.OpenAsync(It.IsAny<Uri>()), Times.Never);
        navigator.Verify(n => n.GoToAsync(It.IsAny<string>()), Times.Never);
        AppLinkHelper.PendingTarget.Should().BeNull();
    }
}
