using BibleOnSite.Controls;
using Microsoft.Maui;
using Microsoft.Maui.Controls;

namespace BibleOnSite.Tests.Controls;

public class RtlSearchBarTests
{
    private sealed class TestSearchBarHandler : Microsoft.Maui.Handlers.SearchBarHandler
    {
        protected override object CreatePlatformView() => new();
    }

    [Fact]
    public void RtlSearchBar_AlignsInputToTheRtlStartEdge()
    {
        var searchBar = new RtlSearchBar();

        searchBar.FlowDirection.Should().Be(FlowDirection.RightToLeft);
        searchBar.HorizontalTextAlignment.Should().Be(TextAlignment.Start);
        // A stock SearchBar defers to its parent — the perush selector's LTR
        // symptom only appears because nothing forces RTL on the native input.
        new SearchBar().FlowDirection.Should().Be(FlowDirection.MatchParent);
    }

    [Fact]
    public void RtlSearchBar_HandlerMappingKeepsControlProperties()
    {
        var searchBar = new RtlSearchBar { Placeholder = "חיפוש פירוש" };
        var handler = new TestSearchBarHandler();
        handler.SetVirtualView(searchBar);

        searchBar.Placeholder.Should().Be("חיפוש פירוש");
        searchBar.FlowDirection.Should().Be(FlowDirection.RightToLeft);
        ((IElementHandler)handler).DisconnectHandler();
    }
}
