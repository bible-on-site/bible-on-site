using System.Globalization;

namespace BibleOnSite.Converters;

/// <summary>
/// Converts a string to a boolean indicating whether it is not null or empty.
/// </summary>
public class StringNotEmptyConverter : IValueConverter
{
    public object Convert(object? value, Type targetType, object? parameter, CultureInfo culture)
    {
        return !string.IsNullOrEmpty(value as string);
    }

    public object ConvertBack(object? value, Type targetType, object? parameter, CultureInfo culture)
    {
        throw new NotImplementedException();
    }
}
