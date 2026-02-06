using System.Globalization;

namespace BibleOnSite.Converters;

/// <summary>
/// Multi-value converter: returns true when values[0] equals values[1] (e.g. Article.Id == SelectedArticleId).
/// Used for selection highlight with rounded corners in dark mode.
/// </summary>
public class IntEqualityConverter : IMultiValueConverter
{
	public object Convert(object[]? values, Type targetType, object? parameter, CultureInfo culture)
	{
		if (values is not { Length: >= 2 })
			return false;
		var a = values[0] is int i ? i : (values[0] is long l ? (int)l : (int?)null);
		var b = values[1] is int j ? j : (values[1] is long m ? (int)m : (int?)null);
		return a.HasValue && b.HasValue && a.Value == b.Value;
	}

	public object[] ConvertBack(object? value, Type[] targetTypes, object? parameter, CultureInfo culture)
	{
		throw new NotImplementedException();
	}
}
