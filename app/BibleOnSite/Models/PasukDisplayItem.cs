namespace BibleOnSite.Models;

/// <summary>
/// Display-layer wrapper around a logical <see cref="Pasuk"/>.
/// In "שניים מקרא" mode each pasuk is rendered twice; the second row of the pair is
/// flagged via <see cref="IsRepeatedCopy"/> so the pasuk marker and perushim are shown
/// once while taps/selection still resolve to the same logical pasuk.
/// </summary>
public sealed class PasukDisplayItem
{
    public PasukDisplayItem(Pasuk pasuk, bool isRepeatedCopy, double fontSize, double markerFontSize)
    {
        Pasuk = pasuk;
        IsRepeatedCopy = isRepeatedCopy;
        FontSize = fontSize;
        MarkerFontSize = markerFontSize;
    }

    /// <summary>The underlying logical pasuk (shared between display copies).</summary>
    public Pasuk Pasuk { get; }

    /// <summary>True for the second (repeated) copy in שניים מקרא mode.</summary>
    public bool IsRepeatedCopy { get; }

    /// <summary>True for the primary copy that carries the marker and perushim.</summary>
    public bool IsFirstCopy => !IsRepeatedCopy;

    /// <summary>Logical pasuk number — identical on both copies so selection stays single.</summary>
    public int PasukNum => Pasuk.PasukNum;

    /// <summary>Marker shown once per pair; empty on the repeated copy.</summary>
    public string PasukNumHeb => IsRepeatedCopy ? string.Empty : Pasuk.PasukNumHeb;

    /// <summary>
    /// Resolved pasuk-text size carried on the item itself. Bound directly (rather
    /// than via a resource) so a recycled or newly created row always gets the
    /// configured size — toggling שניים מקרא must never leave stale or mixed
    /// sizes between rows (#2070).
    /// </summary>
    public double FontSize { get; }

    /// <summary>Resolved pasuk-number marker size (scaled like <see cref="FontSize"/>).</summary>
    public double MarkerFontSize { get; }
}
