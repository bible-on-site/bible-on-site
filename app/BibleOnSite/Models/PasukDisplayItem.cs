namespace BibleOnSite.Models;

/// <summary>
/// Display-layer wrapper around a logical <see cref="Pasuk"/>.
/// In "שניים מקרא" mode each pasuk is rendered twice; the second row of the pair is
/// flagged via <see cref="IsRepeatedCopy"/> so the pasuk marker and perushim are shown
/// once while taps/selection still resolve to the same logical pasuk.
/// </summary>
public sealed class PasukDisplayItem
{
    public PasukDisplayItem(Pasuk pasuk, bool isRepeatedCopy)
    {
        Pasuk = pasuk;
        IsRepeatedCopy = isRepeatedCopy;
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
}
