using System.Globalization;
using BibleOnSite.Converters;
using FluentAssertions;

namespace BibleOnSite.Tests.Converters;

// The resolved marker color depends on Application.Current.RequestedTheme
// (#2601), so these tests serialize with the theme-mutating tests.
[Collection("Application state")]
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
    public void repeated_identical_inputs_reuse_the_merged_instance()
    {
        var converter = new PasukMarkerTextConverter { MarkerColor = Colors.Red };
        var text = PasukText("פסוק");

        var first = converter.Convert([text, "א", 16.0], typeof(object), null, CultureInfo.InvariantCulture);
        var second = converter.Convert([text, "א", 16.0], typeof(object), null, CultureInfo.InvariantCulture);

        second.Should().BeSameAs(first);
    }

    [Fact]
    public void a_replaced_source_instance_rebuilds_the_merge()
    {
        // Simulates RecitingSegment / masking-revision invalidation: the pasuk
        // hands out a new FormattedString instance, so the merge must rebuild.
        var converter = new PasukMarkerTextConverter { MarkerColor = Colors.Red };
        var initial = PasukText("פסוק");
        var rebuilt = PasukText("פסוק");

        var first = converter.Convert([initial, "א", 16.0], typeof(object), null, CultureInfo.InvariantCulture);
        var second = converter.Convert([rebuilt, "א", 16.0], typeof(object), null, CultureInfo.InvariantCulture);

        var merged = second.Should().BeOfType<FormattedString>().Subject;
        merged.Should().NotBeSameAs(first);
        merged.Spans[0].Text.Should().Be("א ");
        merged.Spans[1].Text.Should().Be("פסוק");
    }

    [Fact]
    public void a_different_marker_or_font_size_misses_the_cache()
    {
        var converter = new PasukMarkerTextConverter { MarkerColor = Colors.Red };
        var text = PasukText("פסוק");

        var merged = converter.Convert([text, "א", 16.0], typeof(object), null, CultureInfo.InvariantCulture);
        var otherMarker = (FormattedString)converter.Convert([text, "ב", 16.0], typeof(object), null, CultureInfo.InvariantCulture);
        var otherSize = (FormattedString)converter.Convert([text, "א", 20.0], typeof(object), null, CultureInfo.InvariantCulture);

        otherMarker.Should().NotBeSameAs(merged);
        otherMarker.Spans[0].Text.Should().Be("ב ");
        otherSize.Should().NotBeSameAs(merged);
        otherSize.Spans[0].FontSize.Should().Be(20.0);
        // A previously seen combination still resolves to its cached merge.
        converter.Convert([text, "א", 16.0], typeof(object), null, CultureInfo.InvariantCulture)
            .Should().BeSameAs(merged);
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

    [Fact]
    public void missing_values_return_string_empty()
    {
        Convert().Should().Be(string.Empty);
        new PasukMarkerTextConverter()
            .Convert(null!, typeof(object), null, CultureInfo.InvariantCulture)
            .Should().Be(string.Empty);
    }

    [Fact]
    public void a_missing_marker_returns_the_same_formatted_text()
    {
        var text = PasukText("פסוק");

        Convert(text).Should().BeSameAs(text);
        Convert(text, new object()).Should().BeSameAs(text);
    }

    [Fact]
    public void a_missing_or_invalid_font_size_keeps_the_default()
    {
        var text = PasukText("פסוק");

        MarkerFontSize(Convert(text, "א")).Should().BeNaN();
        MarkerFontSize(Convert(text, "א", "large")).Should().BeNaN();
        MarkerFontSize(Convert(text, "א", -1.0)).Should().BeNaN();
    }

    [Fact]
    public void convert_back_is_not_supported()
    {
        var converter = new PasukMarkerTextConverter();

        var act = () => converter.ConvertBack(
            new object(), [typeof(object), typeof(object)], null, CultureInfo.InvariantCulture);

        act.Should().Throw<NotSupportedException>();
    }

    [Fact]
    public void a_changed_marker_color_misses_the_cached_merge()
    {
        var converter = new PasukMarkerTextConverter { MarkerColor = Colors.Red };
        var text = PasukText("פסוק");

        var red = converter.Convert([text, "א", 16.0], typeof(object), null, CultureInfo.InvariantCulture);
        converter.MarkerColor = Colors.Blue;
        var blue = (FormattedString)converter.Convert([text, "א", 16.0], typeof(object), null, CultureInfo.InvariantCulture);

        blue.Should().NotBeSameAs(red);
        blue.Spans[0].TextColor.Should().Be(Colors.Blue);
    }

    [Fact]
    public void a_fifth_distinct_marker_tuple_evicts_the_oldest_merge()
    {
        var converter = new PasukMarkerTextConverter { MarkerColor = Colors.Red };
        var text = PasukText("פסוק");
        object MergeMarker(string marker) => converter.Convert(
            [text, marker, 16.0], typeof(object), null, CultureInfo.InvariantCulture);

        var first = MergeMarker("א");
        foreach (var marker in new[] { "ב", "ג", "ד", "ה" })
        {
            MergeMarker(marker);
        }

        MergeMarker("א").Should().NotBeSameAs(first,
            "the 4-entry cap evicts the oldest merge, so it is rebuilt");
    }

    private static double MarkerFontSize(object converted) =>
        ((FormattedString)converted).Spans[0].FontSize;
}
