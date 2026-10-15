using BibleOnSite.Models;

namespace BibleOnSite.Helpers;

/// <summary>
/// Hebrew labels and tree building for the person-family surface - mirrors
/// the website's <c>person-family-labels.ts</c> and
/// <c>PersonFamilyTree.tsx</c> so entry pages show the same relationship
/// wording (אב/אם, נישואין/פילגש, אחים מבוגרים/צעירים, שיטה א'/ב', חלופי, …).
/// </summary>
public static partial class TanahpediaFamily
{
    private static readonly IReadOnlyDictionary<string, string> _parentRoles =
        new Dictionary<string, string> { ["FATHER"] = "אב", ["MOTHER"] = "אם" };

    private static readonly IReadOnlyDictionary<string, string> _relationshipTypes =
        new Dictionary<string, string>
        {
            ["BIOLOGICAL"] = "ביולוגי",
            ["ADOPTIVE"] = "אימוץ",
            ["STEP"] = "חורג",
        };

    private static readonly IReadOnlyDictionary<string, string> _unionTypes =
        new Dictionary<string, string>
        {
            ["MARRIAGE"] = "נישואין",
            ["PILEGESH"] = "פילגש",
            ["FORBIDDEN_WITH_GENTILE"] = "קשר פסול עם גויה",
            ["BANNED_INCEST"] = "קשר אסור (ערוה)",
            ["BETROTHAL"] = "אירוסין",
        };

    private static readonly IReadOnlyDictionary<string, string> _unionEndReasons =
        new Dictionary<string, string> { ["DEATH"] = "פטירה", ["DIVORCE"] = "גירושין" };

    /// <summary>Website's union-type opinion sort order - נישואין first,
    /// then קשר פסול עם גויה, קשר אסור, אירוסין, then anything else.</summary>
    private static readonly IReadOnlyDictionary<string, int> _unionTypeOpinionOrder =
        new Dictionary<string, int>
        {
            ["MARRIAGE"] = 0,
            ["FORBIDDEN_WITH_GENTILE"] = 1,
            ["BANNED_INCEST"] = 2,
            ["BETROTHAL"] = 3,
        };

    private static readonly string[] _opinionOrdinals = ["א'", "ב'", "ג'", "ד'", "ה'"];

    /// <summary>Label marking a row/section that belongs to an
    /// alternative-opinion group - the website's <c>altGroupLabel</c>
    /// ("חלופי").</summary>
    public static string AlternativeGroupLabel => "חלופי";

    public static string ParentRoleLabel(string? code) => Label(_parentRoles, code);
    public static string RelationshipTypeLabel(string? code) => Label(_relationshipTypes, code);
    public static string UnionTypeLabel(string? code) => Label(_unionTypes, code);
    public static string UnionEndReasonLabel(string? code) => Label(_unionEndReasons, code);

    private static string Label(IReadOnlyDictionary<string, string> map, string? code) =>
        code is not null && map.TryGetValue(code, out var label) ? label : code ?? string.Empty;

    /// <summary>YYYYMMDD → "YYYY-MM-DD"; other values pass through trimmed.</summary>
    public static string? FormatYyyymmdd(int? value)
    {
        if (value is null)
        {
            return null;
        }
        var s = value.Value.ToString();
        return s.Length == 8 ? $"{s[..4]}-{s[4..6]}-{s[6..8]}" : s;
    }

    /// <summary>Section title above spouse rows: male focal → בנות זוג; female → בני זוג.</summary>
    public static string SpousesSectionLabel(string? focalSex) => focalSex switch
    {
        "MALE" => "בנות זוג",
        "FEMALE" => "בני זוג",
        _ => "זיווגים",
    };

    /// <summary>Conservative corner mark: ז = זכר, נ = נקבה (same as the website).</summary>
    public static string? SexMark(string? sex) => sex switch
    {
        "MALE" => "ז",
        "FEMALE" => "נ",
        _ => null,
    };

    /// <summary>
    /// Splits a DB citation blob into display lines like the website's
    /// <c>citationLines</c> - one line per paragraph, trimmed, blanks dropped,
    /// duplicates preserved.
    /// </summary>
    public static IReadOnlyList<string> CitationLines(string? text) =>
        text is null
            ? []
            : text.Split('\n').Select(line => line.Trim()).Where(line => line.Length > 0).ToList();

    /// <summary>Father sorts before mother for consistent RTL row order.</summary>
    public static int ParentRoleSortKey(string? code) => code switch
    {
        "FATHER" => 0,
        "MOTHER" => 1,
        _ => 2,
    };

    /// <summary>Opinion-interpretation prefix when one spouse unit holds several
    /// union edges - the website's "שיטה א'/ב'" interpretation ordinals.</summary>
    public static string OpinionOrdinalTitle(int index) =>
        index >= 0 && index < _opinionOrdinals.Length
            ? $"שיטה {_opinionOrdinals[index]}"
            : $"שיטה {index + 1}";

    /// <summary>"אב" / "אם" plus the relationship kind for non-biological edges.</summary>
    private static string ParentMeta(string parentRole, string relationshipType) =>
        relationshipType == "BIOLOGICAL"
            ? ParentRoleLabel(parentRole)
            : $"{ParentRoleLabel(parentRole)} · {RelationshipTypeLabel(relationshipType)}";

    /// <summary>
    /// Child meta - the focal person is the parent, so role/relationship only
    /// show for non-biological edges (same rule as the website's
    /// <c>focalChildCardMetaLine</c>).
    /// </summary>
    private static string? ChildMeta(TanahpediaFamilyChildEdge edge) =>
        edge.RelationshipType == "BIOLOGICAL"
            ? null
            : $"{ParentRoleLabel(edge.ParentRole)} · {RelationshipTypeLabel(edge.RelationshipType)}";

    /// <summary>
    /// Union timeline bits without the union type - the website's
    /// <c>spouseTimelinePlain</c>: "התחלה X" whenever a start exists,
    /// "{reason} Y" when the union ended for a coded reason, and "סיום Y"
    /// when it ended without one. Ongoing unions still show their start date.
    /// </summary>
    private static string? SpouseTimelineText(TanahpediaFamilySpouseEdge edge)
    {
        var parts = new List<string>();
        var start = FormatYyyymmdd(edge.UnionStartDate);
        var end = FormatYyyymmdd(edge.UnionEndDate);
        if (start is not null)
        {
            parts.Add($"התחלה {start}");
        }
        if (edge.UnionEndReason is { } endReason)
        {
            parts.Add(end is not null
                ? $"{UnionEndReasonLabel(endReason)} {end}"
                : UnionEndReasonLabel(endReason));
        }
        else if (end is not null)
        {
            parts.Add($"סיום {end}");
        }
        return parts.Count > 0 ? string.Join(" · ", parts) : null;
    }

    /// <summary>
    /// Clusters spouse edges into opinion units, then fuses a canonical
    /// נישואין edge with a same-partner, same-<c>unionOrder</c>
    /// <c>FORBIDDEN_WITH_GENTILE</c> edge - the website's
    /// <c>fuseMarriageAndForbiddenSpouseRows</c> - so that pair renders as one
    /// partner with two interpretations instead of two separate partners.
    /// Units are ordered by earliest union order, then partner name.
    /// </summary>
    private static List<SpouseUnit> BuildSpouseUnits(List<TanahpediaFamilySpouseEdge> spouses)
    {
        var units = new List<SpouseUnit>();
        foreach (var edge in spouses.Where(edge => edge.AltGroupId is null))
        {
            units.Add(new SpouseUnit(null, [edge]));
        }
        foreach (var group in spouses
                     .Where(edge => edge.AltGroupId is not null)
                     .GroupBy(edge => edge.AltGroupId!)
                     .OrderBy(group => group.Key, StringComparer.Ordinal))
        {
            foreach (var edges in group.GroupBy(edge => edge.Related.EntityId))
            {
                units.Add(new SpouseUnit(group.Key, [.. edges]));
            }
        }

        // fuseMarriageAndForbiddenSpouseRows - only single-edge units can pair.
        var singles = units.Where(unit => unit.Edges.Count == 1).ToList();
        var used = new HashSet<int>();
        var fused = new List<SpouseUnit>();
        for (var i = 0; i < singles.Count; i++)
        {
            if (used.Contains(i))
            {
                continue;
            }
            var a = singles[i].Edges[0];
            for (var j = i + 1; j < singles.Count; j++)
            {
                if (used.Contains(j))
                {
                    continue;
                }
                var b = singles[j].Edges[0];
                var types = new[] { a.UnionType, b.UnionType };
                var complementary = types.Contains("MARRIAGE") &&
                    types.Contains("FORBIDDEN_WITH_GENTILE");
                if (!complementary ||
                    a.Related.EntityId != b.Related.EntityId ||
                    (a.UnionOrder ?? -999) != (b.UnionOrder ?? -999))
                {
                    continue;
                }
                used.Add(i);
                used.Add(j);
                fused.Add(new SpouseUnit(
                    singles[i].AltGroupKey ?? singles[j].AltGroupKey,
                    [a, b]));
                break;
            }
        }

        return units.Where(unit => unit.Edges.Count > 1)
            .Concat(fused)
            .Concat(singles.Where((_, index) => !used.Contains(index)))
            .OrderBy(unit => unit.Edges.Min(edge => edge.UnionOrder ?? 999))
            .ThenBy(unit => unit.Edges[0].Related.DisplayName, StringComparer.Ordinal)
            .ToList();
    }

    /// <summary>Interpretation ordering inside a spouse unit - the website's
    /// <c>sortEdgesForOpinions</c>: canonical union types first, then union
    /// order, then type name.</summary>
    private static List<TanahpediaFamilySpouseEdge> SortEdgesForOpinions(
        List<TanahpediaFamilySpouseEdge> edges) =>
        edges
            .OrderBy(edge => edge.UnionType is { } type && _unionTypeOpinionOrder.TryGetValue(type, out var rank)
                ? rank
                : 4)
            .ThenBy(edge => edge.UnionOrder ?? 999)
            .ThenBy(edge => edge.UnionType ?? string.Empty, StringComparer.Ordinal)
            .ToList();

    private sealed record SpouseUnit(string? AltGroupKey, List<TanahpediaFamilySpouseEdge> Edges);
}
