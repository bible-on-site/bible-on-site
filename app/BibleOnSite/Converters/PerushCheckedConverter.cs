using System.Collections;
using System.Globalization;
using System.Linq;

namespace BibleOnSite.Converters;

/// <summary>
/// Multi-value converter: returns true when perushId (values[0]) is in CheckedPerushim list (values[1]).
/// Used for perush checkbox state in the perushim panel.
/// </summary>
public class PerushCheckedConverter : IMultiValueConverter
{
    public object Convert(object[]? values, Type targetType, object? parameter, CultureInfo culture)
    {
        if (values is not { Length: >= 2 })
            return false;
        var id = values[0] is int i ? i : (values[0] is long l ? (int)l : (int?)null);
        if (!id.HasValue)
            return false;
        if (values[1] is IList<int> intList)
            return intList.Contains(id.Value);
        if (values[1] is IEnumerable<int> intEnum)
            return intEnum.Contains(id.Value);
        if (values[1] is IEnumerable en)
            return en.Cast<object>().Any(x => x is int k && k == id.Value);
        return false;
    }

    public object[] ConvertBack(object? value, Type[] targetTypes, object? parameter, CultureInfo culture)
    {
        throw new NotImplementedException();
    }
}
