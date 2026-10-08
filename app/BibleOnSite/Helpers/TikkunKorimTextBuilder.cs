using System.Text;
using BibleOnSite.Models;
using Microsoft.Maui.Controls;
using Microsoft.Maui.Graphics;

namespace BibleOnSite.Helpers;

/// <summary>
/// Builds the continuous-flow "תיקון קוראים" text for a whole perek and provides
/// reversible display-only stripping of niqqud and taamim.
/// Canonical <see cref="Pasuk.Text"/> and <see cref="Pasuk.Segments"/> are never touched —
/// each build re-derives its output from the original data, so toggling marks back on
/// restores the marked text exactly.
/// </summary>
public static class TikkunKorimTextBuilder
{
    private static readonly Color PasukMarkerColor = Color.FromArgb("#637598");

    /// <summary>
    /// Removes Hebrew niqqud and taamim while preserving letters, maqaf, sof pasuq,
    /// and all spacing/word order.
    /// Stripped: U+0591–U+05BD (taamim/accents), U+05BF–U+05C2 (niqqud),
    /// U+05C4–U+05C5 (marks), U+05C7 (qamats qatan).
    /// Kept: U+05BE maqaf and U+05C3 sof pasuq — punctuation, not vocalization.
    /// </summary>
    public static string StripMarks(string? text)
    {
        if (string.IsNullOrEmpty(text))
        {
            return string.Empty;
        }

        var builder = new StringBuilder(text.Length);
        foreach (var c in text)
        {
            if (!IsMark(c))
            {
                builder.Append(c);
            }
        }
        return builder.ToString();
    }

    private static bool IsMark(char c) =>
        c is >= '\u0591' and <= '\u05BD'   // cantillation accents (taamim)
            or >= '\u05BF' and <= '\u05C2' // niqqud
            or >= '\u05C4' and <= '\u05C5' // upper/lower dots
            or '\u05C7';                   // qamats qatan

    /// <summary>
    /// Builds one continuous <see cref="FormattedString"/> for the whole perek —
    /// pesukim flow inline with natural wrapping, each preceded by its pasuk marker
    /// so verse identity is preserved. When <paramref name="repeatEachPasuk"/> is set
    /// (combined with שניים מקרא) every pasuk's text is emitted twice, with the marker
    /// shown only once per pair.
    /// </summary>
    public static FormattedString BuildFormattedText(
        IReadOnlyList<Pasuk>? pesukim,
        bool repeatEachPasuk,
        bool hideMarks)
    {
        var formatted = new FormattedString();
        if (pesukim is null)
        {
            return formatted;
        }

        var copies = repeatEachPasuk ? 2 : 1;
        foreach (var pasuk in pesukim)
        {
            // One marker is shared by the pair in שניים מקרא mode.
            formatted.Spans.Add(new Span
            {
                Text = pasuk.PasukNumHeb,
                TextColor = PasukMarkerColor,
                FontSize = 14,
                FontAttributes = FontAttributes.Bold
            });

            for (var copy = 0; copy < copies; copy++)
            {
                formatted.Spans.Add(new Span { Text = " " });
                AppendPasukSpans(formatted, pasuk, hideMarks);
            }
            formatted.Spans.Add(new Span { Text = " " });
        }
        return formatted;
    }

    /// <summary>
    /// Appends the pasuk's already-styled spans (qri/ktiv, parsha markers, spacing and
    /// maqaf handling all included) with marks optionally stripped. Gesture recognizers
    /// are deliberately not copied — in תיקון קוראים a tap anywhere toggles marks and
    /// must never trigger selection or playback.
    /// </summary>
    private static void AppendPasukSpans(FormattedString target, Pasuk pasuk, bool hideMarks)
    {
        foreach (var span in pasuk.FormattedText.Spans)
        {
            target.Spans.Add(new Span
            {
                Text = hideMarks ? StripMarks(span.Text) : span.Text,
                TextColor = span.TextColor,
                BackgroundColor = span.BackgroundColor,
                FontSize = span.FontSize,
                FontAttributes = span.FontAttributes,
                FontFamily = span.FontFamily,
                LineHeight = span.LineHeight,
                TextDecorations = span.TextDecorations
            });
        }
    }
}
