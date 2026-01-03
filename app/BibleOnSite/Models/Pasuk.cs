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
    /// The text content of the pasuk.
    /// </summary>
    public required string Text { get; set; }

    /// <summary>
    /// Additional formatting components if any (e.g., parsha markers {ס} {פ}).
    /// </summary>
    public List<PasukComponent> Components { get; set; } = new();
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
