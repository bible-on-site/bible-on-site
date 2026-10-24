using System.Globalization;
using BibleOnSite.Converters;

namespace BibleOnSite.Tests.Converters;

/// <summary>
/// #2574: the perushim top-edge shadow strip must sit exactly on the sheet's
/// rounded top edge through every transform — slide animations move it by the
/// sheet's TranslationY, and height changes (drag-expand) move it by -HeightRequest.
/// </summary>
public class TopEdgeShadowOffsetConverterTests
{
    private static readonly CultureInfo Culture = CultureInfo.InvariantCulture;

    [Theory]
    [InlineData(0.0, 600.0, -600.0)]
    [InlineData(600.0, 600.0, 0.0)]
    [InlineData(120.0, 600.0, -480.0)]
    [InlineData(0.0, 850.0, -850.0)]
    public void Convert_positions_strip_at_sheet_top(double translationY, double height, double expected)
    {
        new TopEdgeShadowOffsetConverter()
            .Convert([translationY, height], typeof(double), null, Culture)
            .Should().Be(expected);
    }

    [Fact]
    public void Convert_returns_zero_when_sheet_has_no_height()
    {
        var converter = new TopEdgeShadowOffsetConverter();

        converter.Convert([0.0, -1.0], typeof(double), null, Culture).Should().Be(0.0);
        converter.Convert([0.0, 0.0], typeof(double), null, Culture).Should().Be(0.0);
    }

    [Fact]
    public void Convert_returns_zero_for_missing_or_wrong_values()
    {
        var converter = new TopEdgeShadowOffsetConverter();

        converter.Convert(null, typeof(double), null, Culture).Should().Be(0.0);
        converter.Convert([0.0], typeof(double), null, Culture).Should().Be(0.0);
        converter.Convert(["x", 600.0], typeof(double), null, Culture).Should().Be(0.0);
    }

    [Fact]
    public void ConvertBack_is_not_supported()
    {
        FluentActions.Invoking(() => new TopEdgeShadowOffsetConverter().ConvertBack(null, [], null, Culture))
            .Should().Throw<NotImplementedException>();
    }
}
