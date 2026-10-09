using System.Globalization;
using BibleOnSite.Converters;
using BibleOnSite.Helpers;
using BibleOnSite.Models;
using FluentAssertions;

namespace BibleOnSite.Tests.Converters;

public class PasukDisplayItemsConverterTests
{
    private static Pasuk PasukOf(int num) => new()
    {
        PasukNum = num,
        Text = "x",
        Segments = [new PasukSegment { Type = SegmentType.Ktiv, Value = "x" }]
    };

    private static object Convert(params object[] values) =>
        new PasukDisplayItemsConverter().Convert(
            values, typeof(object), null!, CultureInfo.InvariantCulture);

    [Fact]
    public void empty_values_array_produces_no_items()
    {
        var items = Convert().Should().BeAssignableTo<IReadOnlyList<PasukDisplayItem>>().Subject;

        items.Should().BeEmpty();
    }

    [Fact]
    public void non_list_first_value_produces_no_items()
    {
        var items = Convert("not a list").Should().BeAssignableTo<IReadOnlyList<PasukDisplayItem>>().Subject;

        items.Should().BeEmpty();
    }

    [Fact]
    public void one_item_per_pasuk_without_the_repeat_flag()
    {
        var items = Convert(new List<Pasuk> { PasukOf(1), PasukOf(2) })
            .Should().BeAssignableTo<IReadOnlyList<PasukDisplayItem>>().Subject;

        items.Should().HaveCount(2);
        items.Select(i => i.Pasuk.PasukNum).Should().Equal(1, 2);
        items.Should().OnlyContain(i => !i.IsRepeatedCopy);
    }

    [Fact]
    public void each_pasuk_repeats_once_when_the_flag_is_true()
    {
        var items = Convert(new List<Pasuk> { PasukOf(1), PasukOf(2) }, true)
            .Should().BeAssignableTo<IReadOnlyList<PasukDisplayItem>>().Subject;

        items.Should().HaveCount(4);
        items.Select(i => i.Pasuk.PasukNum).Should().Equal(1, 1, 2, 2);
        items.Select(i => i.IsRepeatedCopy).Should().Equal(false, true, false, true);
    }

    [Fact]
    public void a_non_bool_second_value_does_not_repeat()
    {
        var items = Convert(new List<Pasuk> { PasukOf(1) }, "true")
            .Should().BeAssignableTo<IReadOnlyList<PasukDisplayItem>>().Subject;

        items.Should().HaveCount(1);
    }

    [Fact]
    public void the_font_factor_input_scales_the_carried_sizes()
    {
        var items = Convert(new List<Pasuk> { PasukOf(1) }, true, 1.5)
            .Should().BeAssignableTo<IReadOnlyList<PasukDisplayItem>>().Subject;

        // Repeated and original copies alike render at the configured size.
        items.Should().OnlyContain(i => i.FontSize == 27 && i.MarkerFontSize == 24);
    }

    [Fact]
    public void a_missing_font_factor_uses_the_base_sizes()
    {
        var items = Convert(new List<Pasuk> { PasukOf(1) })
            .Should().BeAssignableTo<IReadOnlyList<PasukDisplayItem>>().Subject;

        items[0].FontSize.Should().Be(PasukDisplayItems.PasukFontSizeBase);
    }

    [Fact]
    public void convert_back_is_not_supported()
    {
        var converter = new PasukDisplayItemsConverter();

        var act = () => converter.ConvertBack(
            new object(), [typeof(object)], null!, CultureInfo.InvariantCulture);

        act.Should().Throw<NotSupportedException>();
    }
}
