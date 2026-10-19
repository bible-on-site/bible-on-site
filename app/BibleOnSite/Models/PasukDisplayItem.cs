namespace BibleOnSite.Models;

/// <summary>
/// Display-layer wrapper around a logical <see cref="Pasuk"/>.
/// In "שניים מקרא" mode each pasuk is rendered twice; the second row of the pair is
/// flagged via <see cref="IsRepeatedCopy"/> so the pasuk marker and perushim are shown
/// once while taps/selection still resolve to the same logical pasuk.
/// </summary>
public sealed class PasukDisplayItem
{
    public PasukDisplayItem(Pasuk pasuk, bool isRepeatedCopy, bool isLastCopy,
        double fontSize, double markerFontSize)
    {
        Pasuk = pasuk;
        IsRepeatedCopy = isRepeatedCopy;
        IsLastCopy = isLastCopy;
        FontSize = fontSize;
        MarkerFontSize = markerFontSize;
    }

    /// <summary>The underlying logical pasuk (shared between display copies).</summary>
    public Pasuk Pasuk { get; }

    /// <summary>True for the second (repeated) copy in שניים מקרא mode.</summary>
    public bool IsRepeatedCopy { get; }

    /// <summary>True for the primary copy that carries the pasuk marker.</summary>
    public bool IsFirstCopy => !IsRepeatedCopy;

    /// <summary>
    /// True for the copy that carries the perushim: the only copy in normal mode,
    /// the repeated copy in שניים מקרא — so the rendered order is מקרא, מקרא,
    /// פירוש rather than מקרא, פירוש, מקרא (#2403).
    /// </summary>
    public bool IsLastCopy { get; }

    /// <summary>
    /// Notes to render under this copy: the real list on the last copy, empty
    /// on the copies between. Empty rather than merely hidden so a row never
    /// instantiates dead perush views that could shadow the live ones in
    /// visual-tree searches (#2403).
    /// </summary>
    public IReadOnlyList<PerushNoteDisplay> PerushNotes =>
        IsLastCopy ? Pasuk.VisiblePerushNotes : [];

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
