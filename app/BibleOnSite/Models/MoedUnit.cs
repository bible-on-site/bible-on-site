using System.ComponentModel;

namespace BibleOnSite.Models;

/// <summary>
/// One inclusive canonical scripture range inside a moed section — the API's
/// pasuk-granular contract (segment bounds are always null). Coordinates are
/// the shared <see cref="IScriptureRange"/> shape, so the range feeds the
/// same slice decomposition and recitation planning every division uses.
/// </summary>
public sealed class MoedRange : IScriptureRange
{
    /// <summary>Stable DB id of the range row.</summary>
    public int Id { get; set; }

    /// <summary>1-based order inside the section.</summary>
    public int Position { get; set; }

    public int StartPerekId { get; set; }
    public int StartPasuk { get; set; }
    public int? StartSegmentIndex => null;
    public int EndPerekId { get; set; }
    public int EndPasuk { get; set; }
    public int? EndSegmentIndex => null;
}

/// <summary>
/// One labelled reading section of a moed (e.g. מגילת איכה, a custom-scoped
/// הפטרה) with its ordered ranges. Labels are distinct identities — mutually
/// alternative readings stay separate sections, never merged.
/// </summary>
public sealed class MoedSection
{
    /// <summary>Stable DB id — keys per-section recitation (moed:{id}:s{sectionId}).</summary>
    public int Id { get; set; }

    /// <summary>Section heading shown above its ranges.</summary>
    public required string Label { get; set; }

    /// <summary>1-based display order inside the moed.</summary>
    public int Position { get; set; }

    /// <summary>The section's ordered inclusive ranges; repeated ranges keep their place.</summary>
    public List<MoedRange> Ranges { get; set; } = [];
}

/// <summary>
/// A מועדים על הפרק unit: one published occasion from the DB-backed
/// catalogue (e.g. תשעה באב). <see cref="Name"/> is the moed identity;
/// <see cref="HebrewMonth"/>/<see cref="DateLabel"/> are display-only date
/// context; <see cref="AnnualOrder"/> is wheel ordering, never a calendar
/// rule. <see cref="ArticleIds"/> is the server-resolved union of
/// range-linked and explicitly linked articles, deduplicated in order.
/// Implements INotifyPropertyChanged for <see cref="Rows"/> so the page
/// rebinds when rows lazy-load.
/// </summary>
public sealed class MoedUnit : INotifyPropertyChanged
{
    // Codacy: S3264 false positive — event IS invoked via OnPropertyChanged() below.
#pragma warning disable S3264 // Events should be invoked
    public event PropertyChangedEventHandler? PropertyChanged;
#pragma warning restore S3264

    private void OnPropertyChanged(string propertyName) =>
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(propertyName));

    /// <summary>Stable DB id.</summary>
    public int Id { get; set; }

    /// <summary>Canonical Hebrew URL segment — the deep-link key.</summary>
    public required string Slug { get; set; }

    /// <summary>Hebrew display name.</summary>
    public required string Name { get; set; }

    /// <summary>Short editorial description, when curated.</summary>
    public string? Summary { get; set; }

    /// <summary>Display-only Hebrew month anchor (e.g. תשרי).</summary>
    public string? HebrewMonth { get; set; }

    /// <summary>Display-only date label (e.g. א'-ב' בתשרי).</summary>
    public string? DateLabel { get; set; }

    /// <summary>Wheel/display ordering — not calendar math.</summary>
    public int AnnualOrder { get; set; }

    /// <summary>Ordered labelled reading sections.</summary>
    public List<MoedSection> Sections { get; set; } = [];

    /// <summary>
    /// The server-resolved article union (range-linked first, explicit-only
    /// afterward), deduplicated by article identity, in API order.
    /// </summary>
    public List<int> ArticleIds { get; set; } = [];

    /// <summary>Articles badge count, filled by the view model's loader.</summary>
    public int ArticlesCount { get; set; }

    private List<MoedDisplayRow> _rows = [];

    /// <summary>Display rows built from the sections; lazy-built on first show.</summary>
    public List<MoedDisplayRow> Rows
    {
        get => _rows;
        set
        {
            if (_rows != value)
            {
                _rows = value;
                OnPropertyChanged(nameof(Rows));
            }
        }
    }
}

/// <summary>
/// One row in the מועדים reader: a section header (the DB label — קריאת
/// התורה / מפטיר / הפטרה / a megillah reading), a perek subheader inside a
/// reading, or a pasuk row clipped to its range bounds. Canonical ids and
/// clip bounds stay on the row for commentary joins and recitation word
/// mapping; <see cref="SectionId"/> keys per-section playback.
/// </summary>
public sealed class MoedDisplayRow : INotifyPropertyChanged
{
    // Codacy: S3264 false positive — event IS invoked via OnPropertyChanged() below.
#pragma warning disable S3264 // Events should be invoked
    public event PropertyChangedEventHandler? PropertyChanged;
#pragma warning restore S3264

    /// <summary>A labelled section boundary (with its canonical refs subtitle).</summary>
    public bool IsSectionHeader { get; private init; }

    /// <summary>A per-perek subheader inside a section.</summary>
    public bool IsPerekHeader { get; private init; }

    /// <summary>Header text; pasuk rows leave it empty.</summary>
    public required string Text { get; init; }

    /// <summary>Canonical references line under a section header; empty elsewhere.</summary>
    public string RefsText { get; init; } = string.Empty;

    /// <summary>The section this row belongs to — recitation key scope.</summary>
    public int SectionId { get; init; }

    /// <summary>
    /// The DB range this row was emitted for — a section can repeat one
    /// reading, and the recitation highlight must land on the occurrence
    /// that is playing, not the first canonical match (#3261 review).
    /// 0 on headers and rows built without range identity.
    /// </summary>
    public int RangeId { get; init; }

    /// <summary>The display pasuk for pasuk rows; null on headers.</summary>
    public Pasuk? Pasuk { get; init; }

    /// <summary>Canonical perek of the pasuk row (0 on headers) — commentary joins.</summary>
    public int PerekId { get; init; }

    /// <summary>Canonical pasuk number of the pasuk row (0 on headers).</summary>
    public int PasukNum => Pasuk?.PasukNum ?? 0;

    /// <summary>Resolved pasuk-text size (user font factor applied).</summary>
    public double FontSize { get; init; }

    /// <summary>Resolved pasuk-number marker size (scaled like <see cref="FontSize"/>).</summary>
    public double MarkerFontSize { get; init; }

    /// <summary>
    /// The 0-based canonical segment index this row's first displayed segment
    /// occupies in the unclipped pasuk — same contract as
    /// <see cref="MasoraPasukRow.ClipStartIndex"/>.
    /// </summary>
    public int ClipStartIndex { get; init; }

    /// <summary>The last included canonical segment index (0-based), or int.MaxValue.</summary>
    public int ClipEndIndex { get; init; }

    private bool _showPlayButton;

    /// <summary>
    /// Whether this section header offers its play button — set by the view
    /// model's recitation-availability refresh (קריינות enabled AND the
    /// section's plan yields at least one clip).
    /// </summary>
    public bool ShowPlayButton
    {
        get => _showPlayButton;
        set
        {
            if (_showPlayButton != value)
            {
                _showPlayButton = value;
                PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(nameof(ShowPlayButton)));
            }
        }
    }

    // Passthroughs keep the row template's bindings type-safe without
    // nullable chains — headers never render pasuk-bound views.
    public string PasukNumHeb => Pasuk?.PasukNumHeb ?? string.Empty;
    public IReadOnlyList<PerushNoteDisplay>? PerushNotes => Pasuk?.VisiblePerushNotes;

    public static MoedDisplayRow SectionHeader(int sectionId, string text, string refsText) =>
        new() { IsSectionHeader = true, SectionId = sectionId, Text = text, RefsText = refsText };

    public static MoedDisplayRow PerekHeader(int sectionId, string text) =>
        new() { IsPerekHeader = true, SectionId = sectionId, Text = text };

    public static MoedDisplayRow PasukRow(int sectionId, Pasuk pasuk, int perekId,
        double fontSize, double markerFontSize, int clipStartIndex, int clipEndIndex) =>
        PasukRow(sectionId, pasuk, perekId, fontSize, markerFontSize,
            clipStartIndex, clipEndIndex, 0);

    public static MoedDisplayRow PasukRow(int sectionId, Pasuk pasuk, int perekId,
        double fontSize, double markerFontSize, int clipStartIndex, int clipEndIndex,
        int rangeId) =>
        new()
        {
            SectionId = sectionId,
            RangeId = rangeId,
            Text = string.Empty,
            Pasuk = pasuk,
            PerekId = perekId,
            FontSize = fontSize,
            MarkerFontSize = markerFontSize,
            ClipStartIndex = clipStartIndex,
            ClipEndIndex = clipEndIndex,
        };
}
