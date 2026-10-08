using System.Globalization;
using BibleOnSite.Helpers;
using BibleOnSite.Models;

namespace BibleOnSite.Converters;

/// <summary>
/// MultiBinding converter producing the continuous תיקון קוראים FormattedString:
/// values[0] = the perek, values[1] = שניים מקרא enabled flag,
/// values[2] = hide-marks flag (toggled by tapping the text).
/// </summary>
public class TikkunTextConverter : IMultiValueConverter
{
    public object Convert(object[] values, Type targetType, object parameter, CultureInfo culture)
    {
        var perek = values.Length > 0 ? values[0] as Perek : null;
        var repeat = values.Length > 1 && values[1] is bool r && r;
        var hideMarks = values.Length > 2 && values[2] is bool h && h;
        return TikkunKorimTextBuilder.BuildFormattedText(perek?.Pasukim, repeat, hideMarks);
    }

    public object[] ConvertBack(object value, Type[] targetTypes, object parameter, CultureInfo culture)
        => throw new NotSupportedException();
}
