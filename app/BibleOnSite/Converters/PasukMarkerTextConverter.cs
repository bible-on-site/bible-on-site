using System.Globalization;

namespace BibleOnSite.Converters;

/// <summary>
/// MultiBinding converter that prepends the pasuk-number marker to the pasuk's
/// <see cref="FormattedString"/> so the marker flows inline with the text instead
/// of occupying a dedicated column: values[0] = pasuk FormattedString,
/// values[1] = marker text (empty on שניים מקרא second copies → passthrough),
/// values[2] = resolved marker font size. Re-runs when the pasuk's FormattedText
/// changes, so recitation segment highlighting keeps working.
/// </summary>
public class PasukMarkerTextConverter : IMultiValueConverter
{
    /// <summary>Marker color — set in XAML to {StaticResource Primary}.</summary>
    public Color MarkerColor { get; set; } = Colors.Blue;

    public object Convert(object[]? values, Type targetType, object? parameter, CultureInfo culture)
    {
        if (values is null || values.Length < 1 || values[0] is not FormattedString text)
        {
            return values is { Length: > 0 } ? values[0] ?? string.Empty : string.Empty;
        }

        var marker = values.Length > 1 ? values[1] as string : null;
        if (string.IsNullOrEmpty(marker))
        {
            return text;
        }

        var merged = new FormattedString();
        var markerSpan = new Span
        {
            Text = marker + " ",
            FontAttributes = FontAttributes.Bold,
            TextColor = MarkerColor
        };
        if (values.Length > 2 && values[2] is double markerFontSize && markerFontSize > 0)
        {
            markerSpan.FontSize = markerFontSize;
        }
        merged.Spans.Add(markerSpan);

        // A Span cannot live in two FormattedStrings, so the pasuk's spans are copied.
        foreach (var span in text.Spans)
        {
            merged.Spans.Add(CloneSpan(span));
        }
        return merged;
    }

    public object[] ConvertBack(object value, Type[] targetTypes, object? parameter, CultureInfo culture)
        => throw new NotSupportedException();

    private static Span CloneSpan(Span span) => new()
    {
        Text = span.Text,
        TextColor = span.TextColor,
        BackgroundColor = span.BackgroundColor,
        FontAttributes = span.FontAttributes,
        FontFamily = span.FontFamily,
        FontSize = span.FontSize,
        CharacterSpacing = span.CharacterSpacing,
        TextDecorations = span.TextDecorations,
        LineHeight = span.LineHeight,
        TextTransform = span.TextTransform
    };
}
