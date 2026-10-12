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
    {
        Pasuk = pasuk;
        PerekId = perekId;
        FontSize = fontSize;
    }

    /// <summary>The pasuk, clipped to the unit's segment bounds.</summary>
    public Pasuk Pasuk { get; }

    /// <summary>The canonical perek this pasuk belongs to (for commentary attachment).</summary>
    public int PerekId { get; }

    /// <summary>Canonical pasuk number inside its perek (internal; never rendered).</summary>
    public int PasukNum => Pasuk.PasukNum;

    /// <summary>Resolved pasuk-text size (user font factor applied).</summary>
    public double FontSize { get; }
}
