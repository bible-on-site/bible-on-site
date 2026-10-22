using System.Collections;
using System.Globalization;
using System.Linq;

namespace BibleOnSite.Converters;

/// <summary>
/// Multi-value converter: returns false when a perush row may not be toggled —
/// perushId (values[0]) is unchecked and CheckedPerushim (values[1]) already
/// holds the inline commentary limit (values[2]). Greys out the extra rows.
/// </summary>
public class PerushEnabledConverter : IMultiValueConverter
{
    public object Convert(object[]? values, Type targetType, object? parameter, CultureInfo culture)
    {
        if (values is not { Length: >= 2 })
        {
            return true;
        }

        var id = values[0] is int i ? i : (values[0] is long l && l is >= int.MinValue and <= int.MaxValue ? (int)l : (int?)null);
        if (!id.HasValue || values[1] is not IEnumerable checkedEnum)
        {
            return true;
        }

        var checkedIds = checkedEnum.OfType<int>().ToList();
        var limit = values.Length >= 3 && values[2] is int n ? n : int.MaxValue;
        return checkedIds.Contains(id.Value) || checkedIds.Count < limit;
    }

    public object[] ConvertBack(object? value, Type[] targetTypes, object? parameter, CultureInfo culture)
    {
        throw new NotImplementedException();
    }
}
