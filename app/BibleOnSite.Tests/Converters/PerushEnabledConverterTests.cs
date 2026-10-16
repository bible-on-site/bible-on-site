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
}
