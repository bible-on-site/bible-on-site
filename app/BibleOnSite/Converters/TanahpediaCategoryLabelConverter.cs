using BibleOnSite.Models;

namespace BibleOnSite.Converters;

/// <summary>
/// Maps a Tanahpedia category/entity-type key (PERSON, PROPHET, …) to its
/// Hebrew display label for badges and titles.
/// </summary>
public class TanahpediaCategoryLabelConverter : IValueConverter
{
    public object? Convert(object? value, Type targetType, object? parameter, System.Globalization.CultureInfo culture)
    {
        return value is string key && key.Length > 0
            ? TanahpediaTaxonomy.LabelFor(key)
            : string.Empty;
    }

    public object? ConvertBack(object? value, Type targetType, object? parameter, System.Globalization.CultureInfo culture)
    {
        throw new NotImplementedException();
    }
}
