using System.ComponentModel;

namespace BibleOnSite.Models;

/// <summary>
/// A Masoretic reading unit (מסורה על הפרק) — a parasha delimited by a
/// ptuha/stuma break in the canonical corpus. Mirrors the shared
/// reading-unit contract (docs/data/reading-units.md): the unit maps
/// scripture ranges — it never copies or renumbers pesukim.
/// Implements INotifyPropertyChanged for <see cref="Rows"/> so the
/// carousel rebinds when the unit's pasuk rows are lazy-loaded.
/// </summary>
public class MasoraUnit : INotifyPropertyChanged
{
    // Codacy: S3264 false positive — event IS invoked via OnPropertyChanged() below.
#pragma warning disable S3264 // Events should be invoked
    public event PropertyChangedEventHandler? PropertyChanged;
#pragma warning restore S3264

    private void OnPropertyChanged(string propertyName) =>
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(propertyName));

    /// <summary>Stable unit id, unique and contiguous within the division (1-based).</summary>
    public int UnitId { get; set; }

    /// <summary>URL slug under the division root (today the decimal unit id).</summary>
    public required string Slug { get; set; }

    /// <summary>Parent sefer id (matches tanah_sefer.id).</summary>
    public int SeferId { get; set; }

    /// <summary>Parent sefer canonical name (e.g. "שמואל" for both שמואל א and ב).</summary>
    public required string SeferName { get; set; }

    /// <summary>1-based order of this unit inside its sefer.</summary>
    public int UnitOrder { get; set; }

    /// <summary>Display heading — the scripture reference span (e.g. "בראשית לה כב - מ א").</summary>
    public required string Heading { get; set; }

    /// <summary>
    /// The boundary break that closes this unit ("ptuha"/"stuma"), or null for the
    /// final unit of a sefer which is closed by the sefer end rather than a break.
    /// </summary>
    public string? ClosingBreak { get; set; }

    /// <summary>Primary reading ranges in canonical order (inclusive bounds).</summary>
    public List<MasoraUnitRange> Ranges { get; set; } = new();

    /// <summary>Hebrew label for the closing break ("פרשה פתוחה"/"פרשה סתומה"), empty for sefer-end units.</summary>
    public string ClosingBreakLabel => ClosingBreak switch
    {
        "ptuha" => "פרשה פתוחה",
        "stuma" => "פרשה סתומה",
        _ => string.Empty
    };

    /// <summary>Whether the unit ends on a Masoretic break marker (vs. a sefer end).</summary>
    public bool HasClosingBreak => !string.IsNullOrEmpty(ClosingBreak);

    /// <summary>The count of articles fetched for this unit (populated lazily by the page).</summary>
    public int ArticlesCount { get; set; }

    /// <summary>
    /// Display rows for this unit (perek labels + clipped pasukim), lazy-loaded
    /// by the reading pipeline. Setter raises PropertyChanged so the UI rebinds.
    /// </summary>
    private List<MasoraPasukRow> _rows = new();
    public List<MasoraPasukRow> Rows
    {
        get => _rows;
        set
        {
            _rows = value;
            OnPropertyChanged(nameof(Rows));
        }
    }
}

/// <summary>
/// An inclusive canonical range of a Masoretic unit. Coordinates are
/// {perekId, pasuk, segmentIndex?}: perekId is the global canonical perek
/// id (1-929), pasuk is 1-based inside it, and segmentIndex is an optional
/// 0-based index into the pasuk's segment list for intra-pasuk bounds
/// (Masoretic breaks may sit mid-verse). Null segmentIndex means the
/// whole-pasuk edge.
/// </summary>
public class MasoraUnitRange
{
    public int StartPerekId { get; set; }
    public int StartPasuk { get; set; }
    public int? StartSegmentIndex { get; set; }
    public int EndPerekId { get; set; }
    public int EndPasuk { get; set; }
    public int? EndSegmentIndex { get; set; }
}
