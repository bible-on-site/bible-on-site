using System.Globalization;
using BibleOnSite.Helpers;
using BibleOnSite.Models;

namespace BibleOnSite.Converters;

/// <summary>
/// MultiBinding converter producing the pasukim CollectionView items:
/// values[0] = pasukim list, values[1] = שניים מקרא enabled flag,
/// values[2] = font factor (kept as an input so changing the configured text
/// size rebuilds rows at the new size, and so recycled rows always rebind to
/// the configured size — #2070).
/// </summary>
public class PasukDisplayItemsConverter : IMultiValueConverter
{
    public object Convert(object[] values, Type targetType, object parameter, CultureInfo culture)
    {
        var pesukim = values.Length > 0 ? values[0] as IReadOnlyList<Pasuk> : null;
        var repeat = values.Length > 1 && values[1] is bool flag && flag;
        var fontFactor = values.Length > 2 && values[2] is double factor ? factor : 1.0;
        return PasukDisplayItems.Create(pesukim, repeat, fontFactor);
    }

    public object[] ConvertBack(object value, Type[] targetTypes, object parameter, CultureInfo culture)
        => throw new NotSupportedException();
}
