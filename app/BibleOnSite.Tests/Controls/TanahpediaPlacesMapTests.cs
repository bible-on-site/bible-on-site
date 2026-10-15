using BibleOnSite.Controls;
using BibleOnSite.Models;

namespace BibleOnSite.Tests.Controls;

public class TanahpediaPlacesMapTests
{
    [Fact]
    public void Ctor_ContentIsWebView()
    {
        var map = new TanahpediaPlacesMap();

        map.Content.Should().BeOfType<WebView>();
        map.Markers.Should().BeNull();
        map.EntryTappedCommand.Should().BeNull();
    }

    [Fact]
    public void Markers_PropertyRoundTrips()
    {
        var map = new TanahpediaPlacesMap();
        var markers = new List<TanahpediaPlaceMarker>
        {
            new() { PlaceId = "p1", PlaceName = "ירושלים", Lat = 31.778, Lng = 35.235 },
        };

        map.Markers = markers;

        map.Markers.Should().BeSameAs(markers);
    }

    [Fact]
    public void OnNavigating_EntryLink_CancelsAndRoutesCommand()
    {
        var captured = new List<object?>();
        var map = new TanahpediaPlacesMap
        {
            EntryTappedCommand = new Command(parameter => captured.Add(parameter)),
        };
        var args = new WebNavigatingEventArgs(
            WebNavigationEvent.NewPage,
            new HtmlWebViewSource(),
            "tanahpedia://entry/%D7%99%D7%A8%D7%95%D7%A9%D7%9C%D7%99%D7%9D");

        map.OnNavigating(null, args);

        args.Cancel.Should().BeTrue();
        captured.Should().Equal("ירושלים");
    }

    [Fact]
    public void OnNavigating_EntryLinkWithoutCommand_StillCancels()
    {
        var map = new TanahpediaPlacesMap();
        var args = new WebNavigatingEventArgs(
            WebNavigationEvent.NewPage,
            new HtmlWebViewSource(),
            "tanahpedia://entry/foo");

        map.OnNavigating(null, args);

        args.Cancel.Should().BeTrue();
    }

    [Fact]
    public void OnNavigating_ExternalUrl_CancelsAndOpensExternally()
    {
        var map = new TanahpediaPlacesMap();
        var args = new WebNavigatingEventArgs(
            WebNavigationEvent.NewPage,
            new HtmlWebViewSource(),
            "https://www.openstreetmap.org/copyright");

        map.OnNavigating(null, args);

        args.Cancel.Should().BeTrue();
    }

    [Fact]
    public void Markers_Empty_ClearsWebViewSource()
    {
        var map = new TanahpediaPlacesMap();

        map.Markers = [];

        map.Content.Should().BeOfType<WebView>().Which.Source.Should().BeNull();
    }

    [Fact]
    public void OnNavigating_OtherScheme_LetsThrough()
    {
        var map = new TanahpediaPlacesMap();
        var args = new WebNavigatingEventArgs(
            WebNavigationEvent.NewPage,
            new HtmlWebViewSource(),
            "about:blank");

        map.OnNavigating(null, args);

        args.Cancel.Should().BeFalse();
    }
}
