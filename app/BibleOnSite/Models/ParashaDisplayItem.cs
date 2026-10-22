namespace BibleOnSite.Models;

/// <summary>
/// One row in the פרשה על הפרק reader: a section header ("תורה",
/// "הפטרה - אשכנזים"), a perek subheader inside a reading
/// ("ישעיהו מב"), or a pasuk row carrying the reader's shared
/// <see cref="PasukDisplayItem"/> so שניים מקרא copies, pasuk
/// markers, selection, and perush placement behave exactly as they
/// do on the על הפרק reader.
/// </summary>
public sealed class ParashaDisplayItem
{
    /// <summary>A major section boundary (Torah / Haftarah variant).</summary>
    public bool IsSectionHeader { get; set; }

    /// <summary>A per-perek subheader inside a section.</summary>
    public bool IsPerekHeader { get; set; }

    /// <summary>The display pasuk for pasuk rows; null on headers.</summary>
    public PasukDisplayItem? Display { get; set; }

    /// <summary>Header text; pasuk rows leave it empty.</summary>
    public required string Text { get; set; }

    /// <summary>Canonical perek of the pasuk row (0 on headers) — commentary joins.</summary>
    public int PerekId { get; set; }

    /// <summary>Canonical pasuk number of the pasuk row (0 on headers).</summary>
    public int PasukNum => Display?.PasukNum ?? 0;

    // Passthroughs keep the row template's bindings type-safe without
    // nullable chains — headers never render pasuk-bound views.
    public Pasuk? Pasuk => Display?.Pasuk;
    public FormattedString? PasukFormattedText => Display?.Pasuk?.FormattedText;
    public string PasukNumHeb => Display?.PasukNumHeb ?? string.Empty;
    public double PasukFontSize => Display?.FontSize ?? 0;
    public double PasukMarkerFontSize => Display?.MarkerFontSize ?? 0;
    public bool IsLastCopy => Display?.IsLastCopy ?? false;
    public IReadOnlyList<PerushNoteDisplay>? PerushNotes => Display?.PerushNotes;

    public static ParashaDisplayItem SectionHeader(string text) =>
        new() { IsSectionHeader = true, Text = text };

    public static ParashaDisplayItem PerekHeader(string text) =>
        new() { IsPerekHeader = true, Text = text };

    public static ParashaDisplayItem PasukItem(PasukDisplayItem display, int perekId) =>
        new() { Display = display, PerekId = perekId, Text = string.Empty };
}
