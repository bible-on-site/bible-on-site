using System.Globalization;
using BibleOnSite.Converters;
using FluentAssertions;

namespace BibleOnSite.Tests.Converters;

public class PerushEnabledConverterTests
{
    private static object Convert(params object[] values) =>
        new PerushEnabledConverter().Convert(
            values, typeof(object), null!, CultureInfo.InvariantCulture);

    [Fact]
    public void unchecked_perush_below_limit_stays_enabled()
    {
        Convert(3, new List<int> { 1, 2 }, 5).Should().Be(true);
    }

    [Fact]
    public void unchecked_perush_at_limit_is_disabled()
    {
        Convert(6, new List<int> { 1, 2, 3, 4, 5 }, 5).Should().Be(false);
    }

    [Fact]
    public void checked_perush_at_limit_stays_enabled()
    {
        Convert(3, new List<int> { 1, 2, 3, 4, 5 }, 5).Should().Be(true);
    }

    [Fact]
    public void unchecked_perush_above_limit_is_disabled()
    {
        Convert(9, new List<int> { 1, 2, 3, 4, 5, 6 }, 5).Should().Be(false);
    }

    [Fact]
    public void missing_values_default_to_enabled()
    {
        Convert(null!, null!).Should().Be(true);
        Convert().Should().Be(true);
    }

    [Fact]
    public void non_numeric_id_and_non_list_inputs_default_to_enabled()
    {
        Convert("x", new List<int> { 1 }, 5).Should().Be(true);
        Convert(3, new object(), 5).Should().Be(true);
    }

    [Fact]
    public void missing_limit_defaults_to_enabled()
    {
        Convert(6, new List<int> { 1, 2, 3, 4, 5 }, "x").Should().Be(true);
    }

    [Fact]
    public void long_ids_match_checked_list()
    {
        Convert(3L, new List<int> { 1, 2, 3, 4, 5 }, 5).Should().Be(true);
        Convert(6L, new List<int> { 1, 2, 3, 4, 5 }, 5).Should().Be(false);
        Convert(long.MaxValue, new List<int> { 1, 2, 3, 4, 5 }, 5).Should().Be(true);
        Convert(long.MinValue, new List<int> { 1, 2, 3, 4, 5 }, 5).Should().Be(true);
    }

    [Fact]
    public void single_value_and_null_array_default_to_enabled()
    {
        Convert(3).Should().Be(true);
        new PerushEnabledConverter().Convert(null, typeof(object), null!, CultureInfo.InvariantCulture)
            .Should().Be(true);
    }

    [Fact]
    public void convert_back_throws()
    {
        var act = () => new PerushEnabledConverter().ConvertBack(
            true, [], null!, CultureInfo.InvariantCulture);
        act.Should().Throw<NotImplementedException>();
    }
}
