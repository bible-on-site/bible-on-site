using BibleOnSite.Controls;
using Microsoft.Maui;
using Microsoft.Maui.Controls;

namespace BibleOnSite.Tests.Controls;

public class SearchEntryTests
{
    private sealed class TestEntryHandler : Microsoft.Maui.Handlers.EntryHandler
    {
        protected override object CreatePlatformView() => new();
    }

    [Theory]
    [InlineData(true)]
    [InlineData(false)]
    public void SharedEntryHandlerSupportsSearchAndOrdinaryFields(bool search)
    {
        var searchField = new SearchEntry();
        var field = search ? searchField : new Entry();
        var handler = new TestEntryHandler();
        handler.SetVirtualView(field);
        field.Text = "בראשית";
        field.HorizontalTextAlignment = TextAlignment.End;
        Assert.Equal("בראשית", field.Text);
        Assert.Equal(search ? FlowDirection.RightToLeft : FlowDirection.MatchParent, field.FlowDirection);
        ((IElementHandler)handler).DisconnectHandler();
    }

    [Fact]
    public void SearchFieldUsesRtlAndTheExternalClearControl()
    {
        var field = new SearchEntry();
        Assert.Equal(FlowDirection.RightToLeft, field.FlowDirection);
        Assert.Equal(TextAlignment.Start, field.HorizontalTextAlignment);
        Assert.Equal(ClearButtonVisibility.Never, field.ClearButtonVisibility);
        Assert.Equal(ReturnType.Search, field.ReturnType);
        Assert.False(field.IsSpellCheckEnabled);
        Assert.Equal(Microsoft.Maui.Graphics.Colors.Transparent, field.BackgroundColor);
        Assert.Equal(FlowDirection.MatchParent, new Entry().FlowDirection);
    }
}
