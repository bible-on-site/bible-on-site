using System.Globalization;
using BibleOnSite.Helpers;
using BibleOnSite.Models;

namespace BibleOnSite.Converters;

/// <summary>
/// MultiBinding converter producing the pasukim CollectionView items:
/// values[0] = pasukim list, values[1] = שניים מקרא enabled flag.
/// </summary>
public class PasukDisplayItemsConverter : IMultiValueConverter
{
    public object Convert(object[] values, Type targetType, object parameter, CultureInfo culture)
    {
        var pesukim = values.Length > 0 ? values[0] as IReadOnlyList<Pasuk> : null;
        var repeat = values.Length > 1 && values[1] is bool flag && flag;
        return PasukDisplayItems.Create(pesukim, repeat);
    }

    public object[] ConvertBack(object value, Type[] targetTypes, object parameter, CultureInfo culture)
        => throw new NotSupportedException();
}
