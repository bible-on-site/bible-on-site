using System.ComponentModel;

namespace BibleOnSite.Models;

/// <summary>
/// Inclusive canonical scripture bounds — the shared reading-unit
/// contract's <c>ScriptureRange</c> (version 1). Coordinates use the
/// global canonical perek id plus a 1-based pasuk; segment indexes are
/// optional 0-based intra-pasuk bounds (Masoretic breaks only — the
/// parasha table never sets them).
/// </summary>
public sealed class ScriptureRange : IScriptureRange
{
    public int StartPerekId { get; set; }
    public int StartPasuk { get; set; }
    public int? StartSegmentIndex { get; set; }
    public int EndPerekId { get; set; }
    public int EndPasuk { get; set; }
    public int? EndSegmentIndex { get; set; }
}

/// <summary>
/// An ordered auxiliary reading attached to a unit — a Haftarah custom
/// variant. Variants (ספרדים / אשכנזים / תימנים) are never flattened:
/// each keeps its own id, conjunctive label, and ordered range list.
/// Ordered ranges may jump perakim or sefarim and repeat pesukim.
/// </summary>
public sealed class AuxiliaryReading
{
    /// <summary>Stable variant id, e.g. "haftara-sefaradi-temani".</summary>
    public required string Id { get; set; }

    /// <summary>Display label, e.g. "ספרדים ותימנים".</summary>
    public required string Label { get; set; }

    public List<ScriptureRange> Ranges { get; set; } = [];
}

/// <summary>
/// A פרשה על הפרק unit: one weekly Torah parasha. The heading is the
/// parasha name (unit identity, not a ref span); joined pairs keep
/// separate unit identities. <see cref="TorahRange"/> is the single
/// contiguous primary range; <see cref="Haftarot"/> are the ordered
/// auxiliary readings. Implements INotifyPropertyChanged for
/// <see cref="Rows"/> so the carousel rebinds when rows lazy-load.
/// </summary>
public sealed class ParashaUnit : INotifyPropertyChanged
{
    // Codacy: S3264 false positive — event IS invoked via OnPropertyChanged() below.
#pragma warning disable S3264 // Events should be invoked
    public event PropertyChangedEventHandler? PropertyChanged;
#pragma warning restore S3264

    private void OnPropertyChanged(string propertyName) =>
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(propertyName));

    /// <summary>Stable contiguous id within the division; the slug is its decimal form.</summary>
    public int UnitId { get; set; }

    public required string Slug { get; set; }

    /// <summary>Id of one of the five Torah sefarim.</summary>
    public int SeferId { get; set; }

    /// <summary>Parent sefer canonical name (e.g. "בראשית").</summary>
    public required string SeferName { get; set; }

    /// <summary>1-based order inside the parent sefer.</summary>
    public int Order { get; set; }

    /// <summary>The parasha name, e.g. "בראשית".</summary>
    public required string Heading { get; set; }

    /// <summary>The single contiguous primary Torah range.</summary>
    public required ScriptureRange TorahRange { get; set; }

    /// <summary>Ordered Haftarah custom variants.</summary>
    public List<AuxiliaryReading> Haftarot { get; set; } = [];

    /// <summary>Every reading range this unit renders, in display order (Torah first).</summary>
    public IEnumerable<ScriptureRange> AllRanges()
    {
        yield return TorahRange;
        foreach (var haftara in Haftarot)
        {
            foreach (var range in haftara.Ranges)
            {
                yield return range;
            }
        }
    }

    /// <summary>The count of articles fetched for this unit (populated lazily by the page).</summary>
    public int ArticlesCount { get; set; }

    /// <summary>
    /// Neighbour carousel pages stay out of the accessibility tree: they are off
    /// screen, and every XCTest snapshot would otherwise serialize them too.
    /// </summary>
    private bool _isOffscreenCarouselPage = true;
    public bool IsOffscreenCarouselPage
    {
        get => _isOffscreenCarouselPage;
        set
        {
            if (_isOffscreenCarouselPage == value) { return; }
            _isOffscreenCarouselPage = value;
            OnPropertyChanged(nameof(IsOffscreenCarouselPage));
        }
    }

    /// <summary>
    /// The Torah range in original references (e.g. "בראשית א א - ו ח"),
    /// resolved by the reading pipeline once perek metadata is available.
    /// </summary>
    private string _rangeLabel = string.Empty;
    public string RangeLabel
    {
        get => _rangeLabel;
        set
        {
            _rangeLabel = value;
            OnPropertyChanged(nameof(RangeLabel));
        }
    }

    /// <summary>
    /// Display rows for this unit — section/perek headers plus pesukim
    /// clipped to the unit's canonical bounds — lazy-loaded by the reading
    /// pipeline. Setter raises PropertyChanged so the UI rebinds.
    /// </summary>
    private List<ParashaDisplayItem> _rows = new();
    public List<ParashaDisplayItem> Rows
    {
        get => _rows;
        set
        {
            _rows = value;
            OnPropertyChanged(nameof(Rows));
        }
    }

    /// <summary>
    /// The unit's logical pesukim (no headers, no שניים מקרא copies) for
    /// the תיקון קוראים continuous flow — assigned together with Rows.
    /// </summary>
    private List<Pasuk> _tikkunPasukim = new();
    public List<Pasuk> TikkunPasukim
    {
        get => _tikkunPasukim;
        set
        {
            _tikkunPasukim = value;
            OnPropertyChanged(nameof(TikkunPasukim));
        }
    }
}
