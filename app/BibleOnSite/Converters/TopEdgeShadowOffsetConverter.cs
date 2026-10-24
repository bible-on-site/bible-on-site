using System.Globalization;

namespace BibleOnSite.Converters;

/// <summary>
/// Multi-value converter: positions a top-edge shadow strip relative to a bottom-anchored
/// sheet — returns TranslationY - HeightRequest so the strip's bottom edge rides on the
/// sheet's rounded top edge through slide and drag-resize animations.
/// Values: [0] = sheet TranslationY, [1] = sheet HeightRequest.
/// </summary>
public class TopEdgeShadowOffsetConverter : IMultiValueConverter
{
    public object Convert(object[]? values, Type targetType, object? parameter, CultureInfo culture)
    {
        if (values is [double translationY, double heightRequest] && heightRequest > 0)
        {
            return translationY - heightRequest;
        }

        return 0d;
    }

    public object[] ConvertBack(object? value, Type[] targetTypes, object? parameter, CultureInfo culture)
    {
        throw new NotImplementedException();
    }
}
