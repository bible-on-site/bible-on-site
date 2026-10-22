namespace BibleOnSite.Models;

/// <summary>
/// How a <see cref="TikkunWord"/> participates in the תיקון קוראים flow.
/// </summary>
public enum TikkunWordKind
{
    /// <summary>Regular drawable text.</summary>
    Text,
    /// <summary>
    /// {פ} — פרשה פתוחה: the current line ends with a blank remainder and the
    /// following section starts at the RTL start of a new line. When the section
    /// ends exactly at a line boundary, a full blank line is left instead
    /// (see <see cref="Helpers.TikkunFlowLayout"/>).
    /// </summary>
    Ptuha,
    /// <summary>
    /// {ס} — פרשה סתומה: a gap of about nine Hebrew letters separates the
    /// sections. The continuation stays on the same line when it fits;
    /// otherwise it starts on the next line indented by the gap.
    /// </summary>
    Stuma,
}

/// <summary>
/// One layout unit in the תיקון קוראים continuous flow — either a drawable word
/// carrying the styling of the pasuk segment it came from (qri/ktiv notes and
/// pasuk numbers keep their look), or a typed section-break token ({פ}/{ס})
/// produced from <see cref="SegmentType"/> markers. Token entries never render
/// text themselves; the layout engine turns them into blank space.
/// </summary>
/// <param name="Text">The word text (never contains spaces; maqaf-joined words stay one unit). Empty for section tokens.</param>
/// <param name="TextColor">Explicit span color, or null to use the theme text color.</param>
/// <param name="FontSizeScale">Font size as a fraction of the base pasuk size (14/18 for notes and markers).</param>
/// <param name="IsBold">Whether the word renders bold.</param>
/// <param name="Kind">Text word or a section-break token.</param>
public sealed record TikkunWord(string Text, Color? TextColor, float FontSizeScale, bool IsBold,
    TikkunWordKind Kind = TikkunWordKind.Text)
{
    /// <summary>The {פ} (פתוחה) paragraph-break token.</summary>
    public static TikkunWord PtuhaBreak { get; } = new(string.Empty, null, 1f, false, TikkunWordKind.Ptuha);

    /// <summary>The {ס} (סתומה) nine-letter-gap token.</summary>
    public static TikkunWord StumaGap { get; } = new(string.Empty, null, 1f, false, TikkunWordKind.Stuma);
}
