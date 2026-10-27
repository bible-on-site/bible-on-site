using System.Globalization;
using System.Runtime.CompilerServices;

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
    private const int MaxCachedMergesPerSource = 4;

    // The pasuk-number marker is reader chrome, not scripture: it keeps the
    // app's main face (the implicit Label style's OpenSansRegular alias) while
    // the pasuk text it precedes renders in Taamey D (#2623). Left unset it
    // would inherit the label's scripture face — which is exactly the
    // wrong-glyph result the review called out.
    internal const string MarkerFontFamily = "OpenSansRegular";

    // Keyed on the source FormattedString instance: Pasuk.FormattedText keeps
    // returning the same instance while its weak-ref cache lives and hands out
    // a new instance only when the content genuinely changed (recitation
    // segment, הסתר שם השם revision), so instance identity is a complete merge
    // key — recycled rows and repeat binds reuse the merge instead of cloning
    // every span again. Entries die with their source FormattedString, so the
    // table stays bounded on its own as rows and perakim recycle.
    private readonly ConditionalWeakTable<FormattedString, List<CachedMerge>> _mergedCache = new();
    private readonly object _mergedCacheGate = new();

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

        // Missing or non-positive sizes leave the marker span at the label
        // default; they share the 0 ("unset") slot rather than keying on the
        // raw input value. Sizes key on their bit pattern — an exact match
        // without tripping the float-equality analyzer.
        var markerFontSize = values.Length > 2 && values[2] is double size && size > 0 ? size : 0;
        var markerFontSizeBits = BitConverter.DoubleToInt64Bits(markerFontSize);
        lock (_mergedCacheGate)
        {
            var merges = _mergedCache.GetValue(text, static _ => new List<CachedMerge>(1));
            foreach (var merge in merges)
            {
                if (merge.Marker == marker &&
                    merge.MarkerFontSizeBits == markerFontSizeBits &&
                    merge.MarkerColor.Equals(MarkerColor))
                {
                    return merge.Merged;
                }
            }

            var merged = Merge(text, marker, markerFontSize);
            if (merges.Count == MaxCachedMergesPerSource)
            {
                merges.RemoveAt(0);
            }
            merges.Add(new CachedMerge(marker, markerFontSizeBits, MarkerColor, merged));
            return merged;
        }
    }

    public object[] ConvertBack(object value, Type[] targetTypes, object? parameter, CultureInfo culture)
        => throw new NotSupportedException();

    private FormattedString Merge(FormattedString text, string marker, double markerFontSize)
    {
        var merged = new FormattedString();
        var markerSpan = new Span
        {
            Text = marker + " ",
            FontFamily = MarkerFontFamily,
            FontAttributes = FontAttributes.Bold,
            TextColor = MarkerColor
        };
        if (markerFontSize > 0)
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

    // Font properties copy only when the source span actually set them:
    // SetValue marks the clone's property as locally set, and the platform
    // span-builder resolves every set font property into its own font span —
    // so copying an unset (null) FontFamily would pin the system face onto the
    // pasuk text instead of letting it inherit the label's Taamey D (#2623:
    // the cloned text kept the old face while the uncloned marker changed).
    // FontAutoScalingEnabled, CharacterSpacing and TextDecorations resolve the
    // same IsSet-or-inherit way, so they follow the same rule.
    private static Span CloneSpan(Span span)
    {
        var clone = new Span
        {
            Text = span.Text,
            TextColor = span.TextColor,
            BackgroundColor = span.BackgroundColor,
            LineHeight = span.LineHeight,
            TextTransform = span.TextTransform
        };
        if (span.IsSet(Span.FontFamilyProperty))
        {
            clone.FontFamily = span.FontFamily;
        }
        if (span.IsSet(Span.FontSizeProperty))
        {
            clone.FontSize = span.FontSize;
        }
        if (span.IsSet(Span.FontAttributesProperty))
        {
            clone.FontAttributes = span.FontAttributes;
        }
        if (span.IsSet(Span.FontAutoScalingEnabledProperty))
        {
            clone.FontAutoScalingEnabled = span.FontAutoScalingEnabled;
        }
        if (span.IsSet(Span.CharacterSpacingProperty))
        {
            clone.CharacterSpacing = span.CharacterSpacing;
        }
        if (span.IsSet(Span.TextDecorationsProperty))
        {
            clone.TextDecorations = span.TextDecorations;
        }
        return clone;
    }

    // The font size rides the key as raw bits — exact cache-key equality
    // without tripping S1244's float == rule.
    private sealed record CachedMerge(string Marker, long MarkerFontSizeBits, Color MarkerColor, FormattedString Merged);
}
