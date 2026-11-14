using System.Globalization;
using BibleOnSite.Converters;
using BibleOnSite.Helpers;
using Microsoft.Maui.Controls;

namespace BibleOnSite.Tests.Converters;

public class SearchSnippetConverterTests
{
    private static FormattedString Render(string? html) =>
        (FormattedString)new SearchSnippetConverter().Convert(html, typeof(FormattedString), null, CultureInfo.InvariantCulture);

    [Fact]
    public void RendersDecodedTextAndBoldMatchesWithoutHtmlLabelImport()
    {
        var formatted = Render("פרק <b>א</b> &amp; &lt;פירוש&gt;");
        Assert.Equal("פרק א & <פירוש>", string.Concat(formatted.Spans.Select(span => span.Text)));
        Assert.Equal(FontAttributes.Bold, Assert.Single(formatted.Spans, span => span.Text.Trim() == "א").FontAttributes);
        var label = new Label { FontSize = 14, FormattedText = formatted };
        Assert.Equal(TextType.Text, label.TextType);
    }

    [Fact]
    public void PreservesPointedScriptureAndUnpointedSearchHighlights()
    {
        const string scripture = "וַיַּעַשׂ אֱלֹהִים";
        var formatted = Render(SearchText.Snippet(scripture, "ויעש אלהים"));
        Assert.Equal(scripture, string.Concat(formatted.Spans.Select(span => span.Text)));
        Assert.Contains(formatted.Spans, span => span.FontAttributes.HasFlag(FontAttributes.Bold) && span.Text.Contains('ֱ'));
    }

    [Fact]
    public void EachResultOwnsItsFormatting()
    {
        var first = Render("<b>בראשית</b>");
        var next = Render("<b>בראשית</b>");
        Assert.NotSame(first, next);
        Assert.NotSame(first.Spans[0], next.Spans[0]);
        next.Spans[0].Text = "שמות";
        Assert.Equal("בראשית", first.Spans[0].Text);
    }

    [Fact]
    public void EmptySnippetHasNoStaleTextOrHighlights()
    {
        Assert.Empty(Render(null).Spans);
        Assert.Empty(Render(string.Empty).Spans);
    }
}
