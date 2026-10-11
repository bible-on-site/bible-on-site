namespace BibleOnSite.Models;

/// <summary>
/// One display row of a Masoretic unit: a pasuk clipped to the unit's
/// canonical bounds, optionally preceded by its perek source label when
/// the unit spans several perakim. Carries the resolved text sizes so
/// recycled rows always render at the configured factor (same contract
/// as <see cref="PasukDisplayItem"/>).
/// </summary>
public sealed class MasoraPasukRow
{
    public MasoraPasukRow(Pasuk pasuk, int perekId, string? perekLabel,
        double fontSize, double markerFontSize)
    {
        Pasuk = pasuk;
        PerekId = perekId;
        PerekLabel = perekLabel;
        FontSize = fontSize;
        MarkerFontSize = markerFontSize;
    }

    /// <summary>The pasuk, clipped to the unit's segment bounds.</summary>
    public Pasuk Pasuk { get; }

    /// <summary>The canonical perek this pasuk belongs to (for commentary attachment).</summary>
    public int PerekId { get; }

    /// <summary>
    /// Perek source label shown above the row (e.g. "שמואל א יב") — set only
    /// on the first row of each perek slice and only when the unit crosses
    /// perek boundaries.
    /// </summary>
    public string? PerekLabel { get; }

    /// <summary>Whether this row opens a new perek inside a multi-perek unit.</summary>
    public bool HasPerekLabel => PerekLabel != null;

    /// <summary>Logical pasuk number inside its perek.</summary>
    public int PasukNum => Pasuk.PasukNum;

    /// <summary>Pasuk number in Hebrew letters.</summary>
    public string PasukNumHeb => Pasuk.PasukNumHeb;

    /// <summary>Resolved pasuk-text size (user font factor applied).</summary>
    public double FontSize { get; }

    /// <summary>Resolved pasuk-number marker size.</summary>
    public double MarkerFontSize { get; }
}
