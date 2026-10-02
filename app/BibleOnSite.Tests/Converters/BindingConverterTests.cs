using System.Collections;
using System.Globalization;
using BibleOnSite.Converters;

namespace BibleOnSite.Tests.Converters;

public class BindingConverterTests
{
    private static readonly CultureInfo Culture = CultureInfo.GetCultureInfo("he-IL");

    [Theory]
    [InlineData(1.5, null, 24.0)]
    [InlineData(2.0, 18.0, 36.0)]
    [InlineData(0.5, "18.5", 9.25)]
    [InlineData(1.0, "invalid", 16.0)]
    [InlineData(null, null, 16.0)]
    [InlineData("1.5", "20", 20.0)]
    public void FontFactor_UsesInvariantBaseSize_AndFallsBackForNonNumericFactors(object? factor, object? basis, double expected)
    {
        new FontFactorToSizeConverter().Convert(factor, typeof(double), basis, Culture).Should().Be(expected);
    }

    [Theory]
    [InlineData(true, false)]
    [InlineData(false, true)]
    [InlineData(null, false)]
    [InlineData("true", false)]
    public void InvertedBool_InvertsBooleanValues_InBothDirections(object? value, bool expected)
    {
        var converter = new InvertedBoolConverter();
        converter.Convert(value, typeof(bool), null, Culture).Should().Be(expected);
        converter.ConvertBack(value, typeof(bool), null, Culture).Should().Be(expected);
    }

    [Theory]
    [InlineData(null, false)]
    [InlineData("", true)]
    [InlineData(0, true)]
    public void NotNull_DistinguishesNullFromEmptyOrZero(object? value, bool expected)
    {
        new NotNullConverter().Convert(value, typeof(bool), null, Culture).Should().Be(expected);
    }

    [Theory]
    [InlineData(null, false)]
    [InlineData("", false)]
    [InlineData(" ", true)]
    [InlineData("text", true)]
    [InlineData(42, false)]
    public void StringNotEmpty_RejectsEmptyAndNonStrings(object? value, bool expected)
    {
        new StringNotEmptyConverter().Convert(value, typeof(bool), null, Culture).Should().Be(expected);
    }

    [Theory]
    [InlineData(0, true)]
    [InlineData(1, false)]
    [InlineData(0L, true)]
    [InlineData(-1L, false)]
    [InlineData(0.0, true)]
    [InlineData(0.1, false)]
    [InlineData(null, true)]
    [InlineData("0", false)]
    public void ZeroToTrue_HandlesSupportedNumericTypesAndNull(object? value, bool expected)
    {
        new ZeroToTrueConverter().Convert(value, typeof(bool), null, Culture).Should().Be(expected);
    }

    [Fact]
    public void IntEquality_RequiresTwoIntegralValues_AndSupportsMixedIntAndLong()
    {
        var converter = new IntEqualityConverter();
        object[][] invalid = [[], [1], [null!, 1], [1, null!], [1.0, 1], [1, 2], [4294967297L, 1], [1, 4294967297L]];
        converter.Convert(null, typeof(bool), null, Culture).Should().Be(false);
        foreach (var values in invalid) converter.Convert(values, typeof(bool), null, Culture).Should().Be(false);
        foreach (var values in new object[][] { [1, 1], [1L, 1], [1, 1L], [1L, 1L], [long.MaxValue, long.MaxValue] })
            converter.Convert(values, typeof(bool), null, Culture).Should().Be(true);
    }

    [Fact]
    public void PerushChecked_HandlesListsEnumerablesAndUntypedCollections()
    {
        var converter = new PerushCheckedConverter();
        object[] collections = { new List<int> { 1, 2 }, new HashSet<int> { 1, 2 }, new ArrayList { "2", 2, null } };
        foreach (var collection in collections)
        {
            converter.Convert([2L, collection], typeof(bool), null, Culture).Should().Be(true);
            converter.Convert([3, collection], typeof(bool), null, Culture).Should().Be(false);
        }
        converter.Convert(null, typeof(bool), null, Culture).Should().Be(false);
        converter.Convert([1], typeof(bool), null, Culture).Should().Be(false);
        converter.Convert(["2", collections[0]], typeof(bool), null, Culture).Should().Be(false);
        converter.Convert([2, "unsupported"], typeof(bool), null, Culture).Should().Be(false);
        converter.Convert([2, new object()], typeof(bool), null, Culture).Should().Be(false);
        converter.Convert([4294967298L, collections[0]], typeof(bool), null, Culture).Should().Be(false);
        converter.Convert([long.MinValue, collections[0]], typeof(bool), null, Culture).Should().Be(false);
        converter.Convert([2, new List<object> { "unrelated", 2 }], typeof(bool), null, Culture).Should().Be(true);
    }

    [Fact]
    public void OneWayConverters_RejectConvertBack()
    {
        Microsoft.Maui.Controls.IValueConverter[] converters =
        [new FontFactorToSizeConverter(), new NotNullConverter(), new StringNotEmptyConverter(), new ZeroToTrueConverter()];
        foreach (var converter in converters)
            FluentActions.Invoking(() => converter.ConvertBack(null, typeof(object), null, Culture))
                .Should().Throw<NotImplementedException>();
        FluentActions.Invoking(() => new IntEqualityConverter().ConvertBack(null, [], null, Culture))
            .Should().Throw<NotImplementedException>();
        FluentActions.Invoking(() => new PerushCheckedConverter().ConvertBack(null, [], null, Culture))
            .Should().Throw<NotImplementedException>();
    }
}
