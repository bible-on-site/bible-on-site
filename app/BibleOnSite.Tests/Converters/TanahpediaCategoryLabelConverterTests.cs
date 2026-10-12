using System.Globalization;
using BibleOnSite.Converters;
using FluentAssertions;

namespace BibleOnSite.Tests.Converters;

public class TanahpediaCategoryLabelConverterTests
{
    private static object? Convert(object? value) =>
        new TanahpediaCategoryLabelConverter().Convert(
            value, typeof(object), null!, CultureInfo.InvariantCulture);

    [Fact]
    public void person_key_maps_to_hebrew_label()
    {
        Convert("PERSON").Should().Be("אישים");
    }

    [Fact]
    public void null_and_empty_values_map_to_empty_string()
    {
        Convert(null).Should().Be(string.Empty);
        Convert(string.Empty).Should().Be(string.Empty);
    }

    [Fact]
    public void convert_back_throws()
    {
        var act = () => new TanahpediaCategoryLabelConverter().ConvertBack(
            "x", typeof(object), null!, CultureInfo.InvariantCulture);
        act.Should().Throw<NotImplementedException>();
    }
}
