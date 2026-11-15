namespace BibleOnSite.Models;

/// <summary>
/// One display row of a Masoretic unit: a pasuk clipped to the unit's
/// canonical bounds. The מסורה reader shows no conventional chapter
/// apparatus — no perek dividers and no chapter pasuk numbers — while
/// canonical ids stay on the row for commentary joins. Carries the
/// resolved text size so recycled rows always render at the configured
/// factor (same contract as <see cref="PasukDisplayItem"/>).
/// </summary>
public sealed class MasoraPasukRow
{
    public MasoraPasukRow(Pasuk pasuk, int perekId, double fontSize)
        : this(pasuk, perekId, fontSize, 0, int.MaxValue)
    {
    }

    public MasoraPasukRow(Pasuk pasuk, int perekId, double fontSize, int clipStartIndex, int clipEndIndex)
    {
        Pasuk = pasuk;
        PerekId = perekId;
        FontSize = fontSize;
        ClipStartIndex = clipStartIndex;
        ClipEndIndex = clipEndIndex;
    }

    /// <summary>The pasuk, clipped to the unit's segment bounds.</summary>
    public Pasuk Pasuk { get; }

    /// <summary>The canonical perek this pasuk belongs to (for commentary attachment).</summary>
    public int PerekId { get; }

    /// <summary>Canonical pasuk number inside its perek (internal; never rendered).</summary>
    public int PasukNum => Pasuk.PasukNum;

    /// <summary>Resolved pasuk-text size (user font factor applied).</summary>
    public double FontSize { get; }

    /// <summary>
    /// The 0-based canonical segment index this row's first displayed segment
    /// occupies in the unclipped pasuk — recitation words map onto the clipped
    /// segments as <c>word.Segment - ClipStartIndex</c> (1-based).
    /// </summary>
    public int ClipStartIndex { get; }

    /// <summary>
    /// The last included canonical segment index (0-based), or
    /// <see cref="int.MaxValue"/> when the row keeps the pasuk's full tail.
    /// </summary>
    public int ClipEndIndex { get; }
}
