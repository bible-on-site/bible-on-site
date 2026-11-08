using System.Globalization;
using BibleOnSite.Helpers;

namespace BibleOnSite.Converters;

/// <summary>
/// Renders SearchText.Snippet's escaped text and highlighted matches as native
/// spans, avoiding the WebKit import used by HTML labels on iOS.
/// </summary>
public sealed class SearchSnippetConverter : IValueConverter
{
    public object Convert(object? value, Type targetType, object? parameter, CultureInfo culture)
    {
        var formatted = new FormattedString();
        foreach (var run in HtmlRuns.FromHtml(value as string))
        {
            formatted.Spans.Add(new Span
            {
                Text = run.Text,
                FontAttributes = (run.Bold ? FontAttributes.Bold : FontAttributes.None)
                    | (run.Italic ? FontAttributes.Italic : FontAttributes.None),
                TextDecorations = (run.Underline ? TextDecorations.Underline : TextDecorations.None)
                    | (run.Strikethrough ? TextDecorations.Strikethrough : TextDecorations.None),
            });
        }
        return formatted;
    }

    public object ConvertBack(object? value, Type targetType, object? parameter, CultureInfo culture) =>
        throw new NotSupportedException();
}
