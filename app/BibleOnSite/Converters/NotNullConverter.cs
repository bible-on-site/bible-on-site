using System.Globalization;

namespace BibleOnSite.Converters;

/// <summary>
/// Converts any value to a boolean indicating whether it is not null.
/// </summary>
public class NotNullConverter : IValueConverter
{
    public object Convert(object? value, Type targetType, object? parameter, CultureInfo culture)
    {
        return value != null;
    }

    public object ConvertBack(object? value, Type targetType, object? parameter, CultureInfo culture)
    {
        throw new NotImplementedException();
    }
}
