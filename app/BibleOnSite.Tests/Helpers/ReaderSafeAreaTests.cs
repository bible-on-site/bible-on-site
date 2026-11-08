using BibleOnSite.Controls;
using BibleOnSite.Helpers;
using Microsoft.Maui;
using Microsoft.Maui.Controls;
using Xunit;

namespace BibleOnSite.Tests.Helpers;

public class ReaderSafeAreaTests
{
    [Fact]
    public void ReaderKeepsVerticalInsetsAfterClearingTheInclusiveVisualTree()
    {
        var root = new Grid();
        var toolbar = new Grid();
        var content = new Grid();
        var verses = new VerticalStackLayout();
        root.Add(toolbar);
        root.Add(content);
        content.Add(verses);

        ReaderSafeArea.Configure(root);

        Assert.Equal(new SafeAreaEdges(SafeAreaRegions.None, SafeAreaRegions.Container,
            SafeAreaRegions.None, SafeAreaRegions.Container), root.SafeAreaEdges);
        Assert.Equal(SafeAreaEdges.None, toolbar.SafeAreaEdges);
        Assert.Equal(SafeAreaEdges.None, content.SafeAreaEdges);
        Assert.Equal(SafeAreaEdges.None, verses.SafeAreaEdges);
    }

    /// <summary>
    /// The bottom chrome inset geometry every reader used to carry as its own
    /// <c>ApplyBottomBarSafeArea</c> (#2573): the bar shifts down over the
    /// home-indicator inset and grows by it, the page pulls up underneath so
    /// no gap shows, and <c>BottomBarTotalHeight</c> publishes the total the
    /// pasuk-list footers bind to.
    /// </summary>
    [Fact]
    public void BottomBarInset_ShiftsBarAndFanOverTheHomeIndicator()
    {
        var page = new ContentPage();
        var bottomBar = new Grid();
        var fan = new ReaderFanMenu();

        ReaderSafeArea.ApplyBottomBarInset(page, bottomBar, fan, 21, 90);

        Assert.Equal(21, bottomBar.TranslationY);
        Assert.Equal(new Thickness(0, 0, 0, 21), bottomBar.Padding);
        Assert.Equal(111, bottomBar.HeightRequest);
        Assert.Equal(new Thickness(0, 0, 0, -21), page.Padding);
        Assert.Equal(111d, page.Resources["BottomBarTotalHeight"]);
    }

    /// <summary>
    /// A zero inset (iPad, landscape) restores the layout defaults — an inset
    /// that disappears must not leave stale shifts behind.
    /// </summary>
    [Fact]
    public void ZeroInset_RestoresLayoutDefaults()
    {
        var page = new ContentPage();
        var bottomBar = new Grid();
        var fan = new ReaderFanMenu();
        ReaderSafeArea.ApplyBottomBarInset(page, bottomBar, fan, 30, 90);

        ReaderSafeArea.ApplyBottomBarInset(page, bottomBar, fan, 0, 90);

        Assert.Equal(0, bottomBar.TranslationY);
        Assert.Equal(new Thickness(0), bottomBar.Padding);
        Assert.Equal(90, bottomBar.HeightRequest);
        Assert.Equal(new Thickness(0), page.Padding);
        Assert.Equal(90d, page.Resources["BottomBarTotalHeight"]);
    }
}
