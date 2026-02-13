using System.Globalization;

namespace BibleOnSite.Converters;

/// <summary>
/// Converts FontFactor (0.5–2.0) to a display font size in points.
/// Default base size is 16; pass a different base via ConverterParameter (e.g. "18").
/// Examples: factor 1.0 with base 16 → 16, factor 1.5 with base 18 → 27.
/// </summary>
public class FontFactorToSizeConverter : IValueConverter
{
    private const double DefaultBaseSize = 16.0;

    public object? Convert(object? value, Type targetType, object? parameter, CultureInfo culture)
    {
        var baseSize = DefaultBaseSize;
        if (parameter is double d)
            baseSize = d;
        else if (parameter is string s && double.TryParse(s, NumberStyles.Any, CultureInfo.InvariantCulture, out var parsed))
            baseSize = parsed;

        if (value is double factor)
            return factor * baseSize;
        return baseSize;
    }

    public object? ConvertBack(object? value, Type targetType, object? parameter, CultureInfo culture)
    {
        throw new NotImplementedException();
    }
}
