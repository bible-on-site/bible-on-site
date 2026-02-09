using System.Globalization;

namespace BibleOnSite.Converters;

/// <summary>
/// Converts FontFactor (0.5–2.0) to a display font size in points.
/// Base size 16; e.g. 1.0 → 16, 1.5 → 24.
/// </summary>
public class FontFactorToSizeConverter : IValueConverter
{
    private const double BaseSize = 16.0;

    public object? Convert(object? value, Type targetType, object? parameter, CultureInfo culture)
    {
        if (value is double factor)
            return factor * BaseSize;
        return BaseSize;
    }

    public object? ConvertBack(object? value, Type targetType, object? parameter, CultureInfo culture)
    {
        throw new NotImplementedException();
    }
}
