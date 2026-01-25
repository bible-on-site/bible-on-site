using BibleOnSite.Helpers;

namespace BibleOnSite.Models;

/// <summary>
/// Represents a single Pasuk (verse) within a Perek.
/// </summary>
public class Pasuk
{
    /// <summary>
    /// The verse number within the perek (1-based).
    /// </summary>
    public int PasukNum { get; set; }

    /// <summary>
    /// The verse number in Hebrew letters (e.g., א, ב, ג).
    /// </summary>
    public string PasukNumHeb => PasukNum.ToHebrewLetters();

    /// <summary>
    /// The text content of the pasuk (plain text concatenation of segments).
    /// </summary>
    public required string Text { get; set; }

    /// <summary>
    /// The segments that make up this pasuk (for rich rendering).
    /// </summary>
    public List<PasukSegment> Segments { get; set; } = new();
}

/// <summary>
/// Represents a segment within a pasuk (text, qri, ktiv, or parsha marker).
/// </summary>
public class PasukSegment
{
    /// <summary>
    /// The type of segment.
    /// </summary>
    public SegmentType Type { get; set; }

    /// <summary>
    /// The text value of this segment (empty for ptuha/stuma).
    /// </summary>
    public string Value { get; set; } = string.Empty;

    /// <summary>
    /// For qri segments: offset to paired ktiv segment.
    /// For ktiv segments: offset to paired qri segment.
    /// Null for regular text or parsha markers.
    /// </summary>
    public int? PairedOffset { get; set; }

    /// <summary>
    /// Whether this qri differs from its ktiv (qri has a different reading).
    /// </summary>
    public bool IsQriDifferentThanKtiv => Type == SegmentType.Qri && PairedOffset.HasValue;

    /// <summary>
    /// Whether this ktiv differs from its qri (ktiv has a different spelling).
    /// </summary>
    public bool IsKtivDifferentThanQri => Type == SegmentType.Ktiv && PairedOffset.HasValue && PairedOffset.Value != 0;

    /// <summary>
    /// Whether the segment ends with a maqaf (Hebrew hyphen).
    /// </summary>
    public bool EndsWithMaqaf => Value.Length > 0 && Value[^1] == '־';
}

/// <summary>
/// Types of segments within a pasuk.
/// </summary>
public enum SegmentType
{
    /// <summary>Ktiv segment (written text, may differ from qri).</summary>
    Ktiv,
    /// <summary>Qri segment (read text, vocalized).</summary>
    Qri,
    /// <summary>Parsha marker פתוחה (open paragraph).</summary>
    Ptuha,
    /// <summary>Parsha marker סתומה (closed paragraph).</summary>
    Stuma
}

/// <summary>
/// Represents a component within a pasuk (text segment or special marker).
/// </summary>
public class PasukComponent
{
    /// <summary>
    /// The type of component (Text, Samech, Peh, etc.).
    /// </summary>
    public PasukComponentType Type { get; set; }

    /// <summary>
    /// The text content of this component.
    /// </summary>
    public string Content { get; set; } = string.Empty;
}

/// <summary>
/// Types of components within a pasuk.
/// </summary>
public enum PasukComponentType
{
    /// <summary>Regular text content.</summary>
    Text,
    /// <summary>Parsha marker {ס} - Setuma (closed).</summary>
    Samech,
    /// <summary>Parsha marker {פ} - Petucha (open).</summary>
    Peh,
    /// <summary>Nun Hafucha marker.</summary>
    NunHafucha
}
