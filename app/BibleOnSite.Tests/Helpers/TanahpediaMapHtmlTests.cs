using BibleOnSite.Helpers;
using BibleOnSite.Models;

namespace BibleOnSite.Tests.Helpers;

public class TanahpediaMapHtmlTests
{
    [Fact]
    public void BuildHtml_EmbedsMarkersAsJson()
    {
        var html = TanahpediaMapHtml.BuildHtml(
        [
            new TanahpediaPlaceMarker
            {
                PlaceId = "pi-1",
                PlaceName = "ירושלים",
                ModernName = "Jerusalem",
                Lat = 31.778,
                Lng = 35.235,
                EntryUniqueName = "ירושלים",
            },
        ]);

        // System.Text.Json's encoder unicode-escapes Hebrew — the browser
        // decodes it back inside the script block.
        html.Should().Contain("\"placeName\":\"\\u05D9\\u05E8\\u05D5\\u05E9\\u05DC\\u05D9\\u05DD\"");
        html.Should().Contain("\"modernName\":\"Jerusalem\"");
        html.Should().Contain("\"lat\":31.778");
        html.Should().Contain("\"lng\":35.235");
        html.Should().Contain("\"entryUniqueName\":\"\\u05D9\\u05E8\\u05D5\\u05E9\\u05DC\\u05D9\\u05DD\"");
        html.Should().Contain("tile.openstreetmap.org");
        html.Should().Contain("leaflet@1.9.4");
    }

    [Fact]
    public void BuildHtml_EscapesMarkupInNames()
    {
        var html = TanahpediaMapHtml.BuildHtml(
        [
            new TanahpediaPlaceMarker
            {
                PlaceId = "pi-1",
                PlaceName = "</script><script>alert(1)</script>",
                Lat = 1,
                Lng = 1,
            },
        ]);

        html.Should().NotContain("</script><script>alert(1)</script>");
        html.Should().Contain("\\u003C");
    }

    [Fact]
    public void BuildHtml_NullEntry_RendersNullEntry()
    {
        var html = TanahpediaMapHtml.BuildHtml(
        [
            new TanahpediaPlaceMarker { PlaceId = "p", PlaceName = "מקום", Lat = 1, Lng = 1 },
        ]);

        html.Should().Contain("\"entryUniqueName\":null");
    }

    [Theory]
    [InlineData("tanahpedia://entry/%D7%99%D7%A8%D7%95%D7%A9%D7%9C%D7%99%D7%9D", "ירושלים")]
    [InlineData("tanahpedia://entry/plain-slug", "plain-slug")]
    public void TryGetEntryUniqueName_DecodesSchemeUrls(string url, string expected)
    {
        TanahpediaMapHtml.TryGetEntryUniqueName(url, out var uniqueName).Should().BeTrue();
        uniqueName.Should().Be(expected);
    }

    [Theory]
    [InlineData("https://www.openstreetmap.org/copyright")]
    [InlineData("tanahpedia://entry/")]
    [InlineData("")]
    public void TryGetEntryUniqueName_RejectsOtherUrls(string url)
    {
        TanahpediaMapHtml.TryGetEntryUniqueName(url, out _).Should().BeFalse();
    }
}
