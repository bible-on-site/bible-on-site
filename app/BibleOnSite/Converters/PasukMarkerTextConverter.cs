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

    // Keyed on the source FormattedString instance: Pasuk.FormattedText keeps
    // returning the same instance while its weak-ref cache lives and hands out
    // a new instance only when the content genuinely changed (recitation
    // segment, הסתר שם השם revision), so instance identity is a complete merge
    // key — recycled rows and repeat binds reuse the merge instead of cloning
    // every span again. Entries die with their source FormattedString, so the
    // table stays bounded on its own as rows and perakim recycle.
    private readonly ConditionalWeakTable<FormattedString, List<CachedMerge>> _mergedCache = new();
    private readonly object _mergedCacheGate = new();

    /// <summary>Marker color in the light theme — set in XAML to {StaticResource Primary}.</summary>
    public Color MarkerColor { get; set; } = Colors.Blue;

    /// <summary>Marker color in the dark theme — Primary is illegible on dark
    /// surfaces, so pages pass AccentOnDark.</summary>
    public Color MarkerColorDark { get; set; } = Colors.LightBlue;

    private Color ResolvedMarkerColor =>
        Application.Current?.RequestedTheme == AppTheme.Dark ? MarkerColorDark : MarkerColor;

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
            var resolvedMarkerColor = ResolvedMarkerColor;
            foreach (var merge in merges)
            {
                if (merge.Marker == marker &&
                    merge.MarkerFontSizeBits == markerFontSizeBits &&
                    merge.MarkerColor.Equals(resolvedMarkerColor))
                {
                    return merge.Merged;
                }
            }

            var merged = Merge(text, marker, markerFontSize, resolvedMarkerColor);
            if (merges.Count == MaxCachedMergesPerSource)
            {
                merges.RemoveAt(0);
            }
            merges.Add(new CachedMerge(marker, markerFontSizeBits, resolvedMarkerColor, merged));
            return merged;
        }
    }

    public object[] ConvertBack(object value, Type[] targetTypes, object? parameter, CultureInfo culture)
        => throw new NotSupportedException();

    private FormattedString Merge(FormattedString text, string marker, double markerFontSize, Color resolvedMarkerColor)
    {
        var merged = new FormattedString();
        var markerSpan = new Span
        {
            Text = marker + " ",
            FontAttributes = FontAttributes.Bold,
            TextColor = resolvedMarkerColor
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

    private static Span CloneSpan(Span span)
    {
        // Reading Span.FontSize evaluates its default-value creator (NaN) and
        // marks the property IsSet — on the clone AND on the source span. On
        // Android GetEffectiveFont then resolves a size-less Font.IsDefault, so
        // ToSpannableString skips the PlatformFontSpan that carries the label's
        // size and the pasuk body renders at the platform default (14sp)
        // instead of the configured size (#2461). Check IsSet before reading,
        // and copy each property only when the source span really set it.
        var clone = new Span { Text = span.Text };
        if (span.IsSet(Span.FontSizeProperty) && !double.IsNaN(span.FontSize))
        {
            clone.FontSize = span.FontSize;
        }
        if (span.IsSet(Span.FontFamilyProperty))
        {
            clone.FontFamily = span.FontFamily;
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
        if (span.IsSet(Span.LineHeightProperty))
        {
            clone.LineHeight = span.LineHeight;
        }
        if (span.IsSet(Span.TextTransformProperty))
        {
            clone.TextTransform = span.TextTransform;
        }
        if (span.IsSet(Span.StyleProperty))
        {
            clone.Style = span.Style;
        }
        if (span.TextColor is not null)
        {
            clone.TextColor = span.TextColor;
        }
        if (span.BackgroundColor is not null)
        {
            clone.BackgroundColor = span.BackgroundColor;
        }
        return clone;
    }

    // The font size rides the key as raw bits — exact cache-key equality
    // without tripping S1244's float == rule.
    private sealed record CachedMerge(string Marker, long MarkerFontSizeBits, Color MarkerColor, FormattedString Merged);
}
