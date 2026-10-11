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
    private static readonly Color QriNoteColor = Color.FromArgb("#637598");
    private static readonly Color RecitingColor = Color.FromArgb("#1c427b");
    private const float NoteFontScale = 14f / 18f;

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
    /// preceded by its pasuk-marker word so verse identity is preserved. Typed
    /// {פ}/{ס} section segments become layout tokens (<see cref="TikkunWordKind"/>)
    /// rather than literal text. When <paramref name="repeatEachPasuk"/> is set
    /// (combined with שניים מקרא) every pasuk's words are emitted twice, with the
    /// marker shown only once per pair. Maqaf-joined words remain a single word so
    /// the justified layout never breaks a maqaf pair across lines.
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
            words.Add(new TikkunWord(pasuk.PasukNumHeb, PasukMarkerColor, NoteFontScale, IsBold: true));

            for (var copy = 0; copy < copies; copy++)
            {
                AppendPasukWords(words, pasuk, hideMarks);
            }
        }
        return words;
    }

    /// <summary>
    /// Walks the pasuk's typed segments so section markers stay layout tokens.
    /// Text segments emit the same words the styled <see cref="Pasuk.FormattedText"/>
    /// would show (same qri/ktiv note text, colors and relative sizes); gesture
    /// recognizers are irrelevant at word level — in תיקון קוראים a tap anywhere
    /// toggles marks and must never trigger selection or playback.
    /// </summary>
    private static void AppendPasukWords(List<TikkunWord> words, Pasuk pasuk, bool hideMarks)
    {
        // Mirrors Pasuk.BuildFormattedText's spacing: a text segment joins the
        // previous word with no space only when the previous segment ended in a
        // maqaf; section markers and empty segments never glue.
        var joinPrevious = false;
        for (var i = 0; i < pasuk.Segments.Count; i++)
        {
            var segment = pasuk.Segments[i];
            var reciting = pasuk.RecitingSegment == i + 1;
            switch (segment.Type)
            {
                case SegmentType.Ptuha:
                    words.Add(TikkunWord.PtuhaBreak);
                    break;

                case SegmentType.Stuma:
                    words.Add(TikkunWord.StumaGap);
                    break;

                case SegmentType.Qri when segment.IsQriDifferentThanKtiv:
                    // Qri differs from ktiv: "(קְרִי: value)" with note styling —
                    // the note label pieces glue to the value (no space before ")").
                    AppendText(words, "(קְרִי: ", QriNoteColor, NoteFontScale, bold: false,
                        hideMarks, joinPrevious);
                    AppendText(words, segment.Value, reciting ? RecitingColor : QriNoteColor,
                        1f, bold: false, hideMarks, glueToPrevious: false);
                    AppendText(words, ")", QriNoteColor, NoteFontScale, bold: false,
                        hideMarks, glueToPrevious: true);
                    break;

                case SegmentType.Ktiv:
                case SegmentType.Qri: // same-as-ktiv qri — plain text
                    AppendText(words, segment.Value, reciting ? RecitingColor : null,
                        1f, bold: false, hideMarks, joinPrevious);
                    break;

                default:
                    throw new ArgumentOutOfRangeException(nameof(segment), segment.Type,
                        "Unknown verse segment type");
            }

            joinPrevious = segment.EndsWithMaqaf;
        }
    }

    /// <summary>
    /// Splits a text piece into space-free words. The first word glues onto the
    /// previous word when <paramref name="glueToPrevious"/> is set (maqaf runs and
    /// the closing ")" of a qri note); empty pieces emit nothing.
    /// </summary>
    private static void AppendText(List<TikkunWord> words, string? text, Color? color,
        float scale, bool bold, bool hideMarks, bool glueToPrevious)
    {
        var value = hideMarks ? StripMarks(text) : text;
        if (string.IsNullOrEmpty(value))
        {
            return;
        }

        var glue = glueToPrevious;
        foreach (var piece in value.Split(' ', StringSplitOptions.RemoveEmptyEntries))
        {
            if (glue && words.Count > 0 && words[^1].Kind == TikkunWordKind.Text)
            {
                words[^1] = words[^1] with { Text = words[^1].Text + piece };
            }
            else
            {
                words.Add(new TikkunWord(piece, color, scale, bold));
            }
            glue = false;
        }
    }
}
