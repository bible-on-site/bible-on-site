namespace BibleOnSite.Models;

/// <summary>
/// Inclusive canonical scripture bounds — the shared reading-unit
/// contract's <c>ScriptureRange</c> (version 1). Coordinates use the
/// global canonical perek id plus a 1-based pasuk; segment indexes are
/// optional 0-based intra-pasuk bounds (Masoretic breaks only — the
/// parasha table never sets them).
/// </summary>
public sealed class ScriptureRange
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
/// auxiliary readings.
/// </summary>
public sealed class ParashaUnit
{
    /// <summary>Stable contiguous id within the division; the slug is its decimal form.</summary>
    public int UnitId { get; set; }

    public required string Slug { get; set; }

    /// <summary>Id of one of the five Torah sefarim.</summary>
    public int SeferId { get; set; }

    /// <summary>1-based order inside the parent sefer.</summary>
    public int Order { get; set; }

    /// <summary>The parasha name, e.g. "בראשית".</summary>
    public required string Heading { get; set; }

    /// <summary>The single contiguous primary Torah range.</summary>
    public required ScriptureRange TorahRange { get; set; }

    /// <summary>Ordered Haftarah custom variants.</summary>
    public List<AuxiliaryReading> Haftarot { get; set; } = [];
}
