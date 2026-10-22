using BibleOnSite.Services;
using Microsoft.Maui.Controls;

namespace BibleOnSite.Tests.Services;

/// <summary>
/// #2119: Shell-level screen_view events must carry logical page names — never
/// Shell route URIs or the MainActivity/renderer classes Firebase's automatic
/// tracking produced — and self-reporting pages must not be double-counted.
/// </summary>
public class AnalyticsScreensTests
{
    private sealed class PlainPage : ContentPage { }

    private sealed class NamedPage : ContentPage, IAnalyticsScreenName
    {
        public string? AnalyticsScreenName => "Article/42";
    }

    private sealed class SkippedPage : ContentPage, IAnalyticsScreenName
    {
        // The reader pattern: reports AlHaperek/{perekId} itself, so the
        // Shell-level event is suppressed.
        public string? AnalyticsScreenName => null;
    }

    [Fact]
    public void ScreenNameFor_NullPage_ReturnsNull()
    {
        Assert.Null(AnalyticsScreens.ScreenNameFor(null));
    }

    [Fact]
    public void ScreenNameFor_PlainPage_UsesPageTypeName()
    {
        Assert.Equal("PlainPage", AnalyticsScreens.ScreenNameFor(new PlainPage()));
    }

    [Fact]
    public void ScreenNameFor_NamedPage_UsesLogicalName()
    {
        Assert.Equal("Article/42", AnalyticsScreens.ScreenNameFor(new NamedPage()));
    }

    [Fact]
    public void ScreenNameFor_SelfReportingPage_ReturnsNull()
    {
        Assert.Null(AnalyticsScreens.ScreenNameFor(new SkippedPage()));
    }
}
