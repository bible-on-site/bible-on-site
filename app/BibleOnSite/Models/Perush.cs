namespace BibleOnSite.Models;

/// <summary>
/// Represents a commentary work (e.g. רש"י, תרגום אונקלוס).
/// Loaded from perushim catalog (bundled).
/// </summary>
public class Perush
{
    /// <summary>SQLite primary key from perush table.</summary>
    public int Id { get; set; }

    /// <summary>Hebrew display name (e.g. רש"י, אבן עזרא).</summary>
    public required string Name { get; set; }

    /// <summary>Display order (lower = first). Targum first, Rashi second, then chronological.</summary>
    public int Priority { get; set; }
}
