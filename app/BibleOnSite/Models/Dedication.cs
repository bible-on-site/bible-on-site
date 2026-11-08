using System.Text.RegularExpressions;

namespace BibleOnSite.Models;

/// <summary>
/// One dedication honouring <see cref="Subject"/> for <see cref="Purposes"/>,
/// as resolved by the API's `dedications` query for a reading context (#2731).
/// </summary>
public class Dedication
{
    public int Id { get; set; }

    public string Subject { get; set; } = string.Empty;

    /// <summary>Purpose descriptions (לע"נ, רפואה שלימה, ...).</summary>
    public List<string> Purposes { get; set; } = [];

    /// <summary>Whole-dedication expiry (UTC wall-clock); null = ongoing.</summary>
    public string? ExpiresAt { get; set; }

    /// <summary>The assignments that matched the requested context.</summary>
    public List<DedicationScope> Scopes { get; set; } = [];
}

/// <summary>One assignment of a dedication to a target.</summary>
public class DedicationScope
{
    /// <summary>PEREK | SEFER | HELEK | PARASHA | ARTICLE | TANAHPEDIA_ENTRY | MASORA.</summary>
    public string Kind { get; set; } = string.Empty;

    public int? PerekIdLow { get; set; }
    public int? PerekIdHigh { get; set; }
    public int? SeferId { get; set; }
    public int? HelekId { get; set; }
    public int? ParashaId { get; set; }
    public int? ArticleId { get; set; }

    /// <summary>Canonical tanahpedia_entry id (not the mutable unique_name).</summary>
    public string? EntryId { get; set; }

    /// <summary>Assignment-level expiry (UTC wall-clock); null = ongoing.</summary>
    public string? ExpiresAt { get; set; }
}

/// <summary>
/// Reading-context input for `dedications(context:)`: pass every identity the
/// context carries — the API resolves perek → sefer → helek ancestors itself.
/// </summary>
public class DedicationContext
{
    public List<int>? PerekIds { get; set; }
    public List<int>? SeferIds { get; set; }
    public List<int>? HelekIds { get; set; }
    public List<int>? ParashaIds { get; set; }
    public List<string>? EntryIds { get; set; }
    public List<int>? ArticleIds { get; set; }

    /// <summary>True for a מסורה על הפרק reading context (feature-level scope).</summary>
    public bool? Masora { get; set; }
}

public static class DedicationFormatter
{
    private static readonly HashSet<string> HealingPurposes =
    [
        "רפואה", "לרפואה", "לרפואת", "רפואה שלמה", "רפואה שלימה", "לרפואה שלמה", "לרפואה שלימה",
    ];

    /// <summary>
    /// One stored purpose in display form: whitespace collapsed, legacy
    /// gershayim/geresh/typographic quotes mapped to ASCII, healing variants
    /// folded to the construct form לרפואת.
    /// </summary>
    public static string DisplayPurpose(string purpose)
    {
        var clean = Regex.Replace(purpose.Trim(), @"\s+", " ");
        clean = Regex.Replace(clean, "[״“”„]", "\"");
        clean = Regex.Replace(clean, "[׳‘’]", "'");
        return HealingPurposes.Contains(clean) ? "לרפואת" : clean;
    }

    /// <summary>
    /// The rendered line — mirrors the website's `formatDedication` (#2849):
    /// purposes first (joined with ו) then the exact subject, e.g.
    /// `לרפואת מזל בת רחל`; the subject alone when no purpose is given.
    /// </summary>
    public static string Format(Dedication dedication)
    {
        var purposes = dedication.Purposes.Select(DisplayPurpose).Where(p => p.Length > 0).Distinct().ToList();
        return purposes.Count == 0
            ? dedication.Subject
            : $"{string.Join(" ו", purposes)} {dedication.Subject}";
    }

    public static List<string> FormatAll(IEnumerable<Dedication> dedications) =>
        dedications.Select(Format).ToList();
}
