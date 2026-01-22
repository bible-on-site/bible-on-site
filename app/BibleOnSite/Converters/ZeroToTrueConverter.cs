namespace BibleOnSite.Converters;

/// <summary>
/// Converts zero or null values to true, non-zero to false.
/// Useful for showing empty states.
/// </summary>
public class ZeroToTrueConverter : IValueConverter
{
    public object? Convert(object? value, Type targetType, object? parameter, System.Globalization.CultureInfo culture)
    {
        if (value is int intValue)
            return intValue == 0;
        if (value is long longValue)
            return longValue == 0;
        if (value is double doubleValue)
            return doubleValue == 0;

        return value == null;
    }

    public object? ConvertBack(object? value, Type targetType, object? parameter, System.Globalization.CultureInfo culture)
    {
        throw new NotImplementedException();
    }
}
