using BibleOnSite.Models;
using Microsoft.Maui.Controls;
using Microsoft.Maui.Graphics;

namespace BibleOnSite.Helpers;

/// <summary>
/// Builds the drawable word list for the continuous-flow "תיקון קוראים" view and
/// provides reversible display-only stripping of niqqud and taamim.
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

        var builder = new System.Text.StringBuilder(text.Length);
        foreach (var c in text.Where(c => !IsMark(c)))
        {
            builder.Append(c);
        }
        return builder.ToString();
    }

    private static bool IsMark(char c) =>
        c is >= (char)0x0591 and <= (char)0x05BD   // cantillation accents (taamim)
            or >= (char)0x05BF and <= (char)0x05C2 // niqqud
            or >= (char)0x05C4 and <= (char)0x05C5 // upper/lower dots
            or (char)0x05C7;                       // qamats qatan

    /// <summary>
    /// Builds the word sequence for the whole perek — pesukim flow inline, each
    /// preceded by its pasuk-marker word so verse identity is preserved. When
    /// <paramref name="repeatEachPasuk"/> is set (combined with שניים מקרא) every
    /// pasuk's words are emitted twice, with the marker shown only once per pair.
    /// Maqaf-joined words remain a single word so the justified layout never breaks
    /// a maqaf pair across lines.
    /// </summary>
    public static IReadOnlyList<TikkunWord> BuildWords(
        IReadOnlyList<Pasuk>? pesukim,
        bool repeatEachPasuk,
        bool hideMarks)
    {
        var words = new List<TikkunWord>();
        if (pesukim is null)
        {
            return words;
        }

        var copies = repeatEachPasuk ? 2 : 1;
        foreach (var pasuk in pesukim)
        {
            // One marker is shared by the pair in שניים מקרא mode.
            words.Add(new TikkunWord(pasuk.PasukNumHeb, PasukMarkerColor, 14f / 18f, IsBold: true));

            for (var copy = 0; copy < copies; copy++)
            {
                AppendPasukWords(words, pasuk, hideMarks);
            }
        }
        return words;
    }

    /// <summary>
    /// Splits the pasuk's already-styled spans (qri/ktiv, parsha markers, spacing and
    /// maqaf handling all included) into space-free words that keep the span styling.
    /// Gesture recognizers are irrelevant at word level — in תיקון קוראים a tap
    /// anywhere toggles marks and must never trigger selection or playback.
    /// </summary>
    private static void AppendPasukWords(List<TikkunWord> words, Pasuk pasuk, bool hideMarks)
    {
        foreach (var span in pasuk.FormattedText.Spans)
        {
            var text = hideMarks ? StripMarks(span.Text) : span.Text;
            var scale = span.FontSize > 0 ? (float)(span.FontSize / 18.0) : 1f;
            var bold = span.FontAttributes.HasFlag(FontAttributes.Bold);
            foreach (var piece in text.Split(' ', StringSplitOptions.RemoveEmptyEntries))
            {
                words.Add(new TikkunWord(piece, span.TextColor, scale, bold));
            }
        }
    }
}
