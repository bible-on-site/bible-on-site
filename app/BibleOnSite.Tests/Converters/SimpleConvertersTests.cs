using System.Globalization;
using BibleOnSite.Converters;
using FluentAssertions;

namespace BibleOnSite.Tests.Converters;

public class SimpleConvertersTests
{
    private static readonly CultureInfo Culture = CultureInfo.InvariantCulture;

    [Fact]
    public void IntEquality_MatchesAcrossIntAndLong()
    {
        var converter = new IntEqualityConverter();
        converter.Convert([3, 3L], typeof(bool), null, Culture).Should().Be(true);
        converter.Convert([3, 4], typeof(bool), null, Culture).Should().Be(false);
    }

    [Fact]
    public void IntEquality_ShortOrNonNumericValues_AreFalse()
    {
        var converter = new IntEqualityConverter();
        converter.Convert(null, typeof(bool), null, Culture).Should().Be(false);
        converter.Convert([1], typeof(bool), null, Culture).Should().Be(false);
        converter.Convert(["x", 1L], typeof(bool), null, Culture).Should().Be(false);
        converter.Convert([1, "y"], typeof(bool), null, Culture).Should().Be(false);
    }

    [Fact]
    public void InvertedBool_BoolsFlip_NonBoolsAreFalse()
    {
        var converter = new InvertedBoolConverter();
        converter.Convert(true, typeof(bool), null, Culture).Should().Be(false);
        converter.Convert(false, typeof(bool), null, Culture).Should().Be(true);
        converter.Convert("x", typeof(bool), null, Culture).Should().Be(false);
        converter.ConvertBack(true, typeof(bool), null, Culture).Should().Be(false);
        converter.ConvertBack("x", typeof(bool), null, Culture).Should().Be(false);
    }

    [Fact]
    public void NotNull_AndStringNotEmpty_Converters()
    {
        var notNull = new NotNullConverter();
        notNull.Convert(null, typeof(bool), null, Culture).Should().Be(false);
        notNull.Convert(0, typeof(bool), null, Culture).Should().Be(true);
        var act = () => notNull.ConvertBack(null, typeof(bool), null, Culture);
        act.Should().Throw<NotImplementedException>();

        var notEmpty = new StringNotEmptyConverter();
        notEmpty.Convert(null, typeof(bool), null, Culture).Should().Be(false);
        notEmpty.Convert("", typeof(bool), null, Culture).Should().Be(false);
        notEmpty.Convert("א", typeof(bool), null, Culture).Should().Be(true);
    }

    [Fact]
    public void ZeroToTrue_ZeroAcrossNumericTypes_NullIsTrue()
    {
        var converter = new ZeroToTrueConverter();
        converter.Convert(0, typeof(bool), null, Culture).Should().Be(true);
        converter.Convert(2, typeof(bool), null, Culture).Should().Be(false);
        converter.Convert(0L, typeof(bool), null, Culture).Should().Be(true);
        converter.Convert(5L, typeof(bool), null, Culture).Should().Be(false);
        converter.Convert(0.0, typeof(bool), null, Culture).Should().Be(true);
        converter.Convert(1.5, typeof(bool), null, Culture).Should().Be(false);
        converter.Convert(null, typeof(bool), null, Culture).Should().Be(true);
        converter.Convert("x", typeof(bool), null, Culture).Should().Be(false);
    }

    [Fact]
    public void FontFactorToSize_ParameterAndValueShapes()
    {
        var converter = new FontFactorToSizeConverter();
        converter.Convert(1.5, typeof(double), null, Culture).Should().Be(24.0);
        converter.Convert(1.5, typeof(double), 20.0, Culture).Should().Be(30.0);
        converter.Convert(1.5, typeof(double), "18", Culture).Should().Be(27.0);
        // A non-numeric parameter falls back to the 16pt base; a non-double
        // value returns the base untouched.
        converter.Convert(1.5, typeof(double), "x", Culture).Should().Be(24.0);
        converter.Convert("big", typeof(double), null, Culture).Should().Be(16.0);
    }
}
