using System.Globalization;
using BibleOnSite.Converters;
using FluentAssertions;

namespace BibleOnSite.Tests.Converters;

public class PasukMarkerTextConverterTests
{
    private static FormattedString PasukText(string text, params Span[] extraSpans)
    {
        var formatted = new FormattedString();
        formatted.Spans.Add(new Span { Text = text });
        foreach (var span in extraSpans)
        {
            formatted.Spans.Add(span);
        }
        return formatted;
    }

    private static object Convert(params object?[] values) =>
        new PasukMarkerTextConverter { MarkerColor = Colors.Red }.Convert(
            values!, typeof(object), null, CultureInfo.InvariantCulture);

    [Fact]
    public void an_empty_marker_returns_the_same_formatted_text()
    {
        var text = PasukText("פסוק");

        Convert(text, "", 16.0).Should().BeSameAs(text);
        Convert(text, (object?)null, 16.0).Should().BeSameAs(text);
    }

    [Fact]
    public void a_marker_prepends_a_styled_span_before_the_pasuk_spans()
    {
        var qriSpan = new Span { Text = "קרי", TextColor = Colors.Gray, FontSize = 14 };
        var text = PasukText("פסוק", qriSpan);

        var merged = Convert(text, "א", 16.0).Should().BeOfType<FormattedString>().Subject;

        merged.Spans.Should().HaveCount(3);
        merged.Spans[0].Text.Should().Be("א ");
        merged.Spans[0].FontAttributes.Should().Be(FontAttributes.Bold);
        merged.Spans[0].TextColor.Should().Be(Colors.Red);
        merged.Spans[0].FontSize.Should().Be(16.0);
        // The pasuk's own spans are copied, not shared between FormattedStrings.
        merged.Spans[1].Should().NotBeSameAs(text.Spans[0]);
        merged.Spans[1].Text.Should().Be("פסוק");
        merged.Spans[2].TextColor.Should().Be(Colors.Gray);
        merged.Spans[2].FontSize.Should().Be(14);
    }

    [Fact]
    public void the_source_formatted_text_is_not_mutated()
    {
        var text = PasukText("פסוק");

        Convert(text, "א", 16.0);

        text.Spans.Should().HaveCount(1);
    }

    [Fact]
    public void a_non_formatted_text_input_passes_through()
    {
        Convert("plain").Should().Be("plain");
        Convert((object?)null).Should().Be(string.Empty);
    }
}
