namespace BibleOnSite.Models;

/// <summary>
/// One row in the parasha reader: a section header ("תורה",
/// "הפטרה - אשכנזים"), a perek subheader inside a reading
/// ("ישעיהו מב"), or a pasuk row carrying the pasuk for rich rendering.
/// </summary>
public sealed class ParashaDisplayItem
{
    /// <summary>A major section boundary (Torah / Haftarah variant).</summary>
    public bool IsSectionHeader { get; set; }

    /// <summary>A per-perek subheader inside a section.</summary>
    public bool IsPerekHeader { get; set; }

    /// <summary>The pasuk for pasuk rows; null on headers.</summary>
    public Pasuk? Pasuk { get; set; }

    /// <summary>Header text, or the pasuk's plain text for pasuk rows.</summary>
    public required string Text { get; set; }

    public static ParashaDisplayItem SectionHeader(string text) =>
        new() { IsSectionHeader = true, Text = text };

    public static ParashaDisplayItem PerekHeader(string text) =>
        new() { IsPerekHeader = true, Text = text };

    public static ParashaDisplayItem PasukItem(Pasuk pasuk) =>
        new() { Pasuk = pasuk, Text = pasuk.Text };
}
