using BibleOnSite.Models;

namespace BibleOnSite.Helpers;

/// <summary>
/// Hebrew labels and section building for the person-family surface — mirrors
/// the website's <c>person-family-labels.ts</c> so entry pages show the same
/// relationship wording (אב/אם, נישואין/פילגש, אחים מבוגרים/צעירים, …).
/// </summary>
public static class TanahpediaFamily
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

    private static readonly string[] _opinionOrdinals = ["א'", "ב'", "ג'", "ד'", "ה'"];

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

    /// <summary>Father sorts before mother for consistent RTL row order.</summary>
    public static int ParentRoleSortKey(string? code) => code switch
    {
        "FATHER" => 0,
        "MOTHER" => 1,
        _ => 2,
    };

    /// <summary>Opinion-block title when several edges target the same person.</summary>
    public static string OpinionOrdinalTitle(int index) =>
        index >= 0 && index < _opinionOrdinals.Length
            ? $"שיטה {_opinionOrdinals[index]}"
            : $"שיטה {index + 1}";

    /// <summary>
    /// Flattens the family summary into ordered display sections — parents,
    /// spouses, children (grouped by co-parent) and siblings (split by birth
    /// date relative to the focal person when known) — mirroring the website's
    /// family tree layout as a compact mobile list.
    /// </summary>
    public static List<TanahpediaFamilySection> BuildSections(TanahpediaPersonFamily family)
    {
        var sections = new List<TanahpediaFamilySection>();

        if (family.Parents.Count > 0)
        {
            var rows = WithOpinionOrdinals(family.Parents
                .OrderBy(e => ParentRoleSortKey(e.ParentRole))
                .ThenBy(e => e.Related.DisplayName, StringComparer.Ordinal)
                .Select(edge => new TanahpediaFamilyRow
                {
                    DisplayName = edge.Related.DisplayName,
                    EntryUniqueName = edge.Related.EntryUniqueName,
                    SexMark = SexMark(edge.Related.Sex),
                    Meta = ParentMeta(edge.ParentRole, edge.RelationshipType),
                    SourceCitation = edge.SourceCitation,
                    AltGroupId = edge.AltGroupId,
                    RelatedEntityId = edge.Related.EntityId,
                })
                .ToList());
            sections.Add(new TanahpediaFamilySection { Title = "הורים", Rows = rows });
        }

        if (family.Spouses.Count > 0)
        {
            var rows = WithOpinionOrdinals(family.Spouses
                .OrderBy(e => e.UnionOrder ?? int.MaxValue)
                .ThenBy(e => e.Related.DisplayName, StringComparer.Ordinal)
                .Select(edge => new TanahpediaFamilyRow
                {
                    DisplayName = edge.Related.DisplayName,
                    EntryUniqueName = edge.Related.EntryUniqueName,
                    SexMark = SexMark(edge.Related.Sex),
                    Meta = SpouseMeta(edge),
                    SourceCitation = edge.PersonSourceCitation ?? edge.SourceCitation,
                    AltGroupId = edge.AltGroupId,
                    RelatedEntityId = edge.Related.EntityId,
                })
                .ToList());
            sections.Add(new TanahpediaFamilySection
            {
                Title = SpousesSectionLabel(family.FocalSex),
                Rows = rows,
            });
        }

        sections.AddRange(BuildChildrenSections(family.Children, family.Spouses));
        sections.AddRange(BuildSiblingSections(family.Siblings, family.FocalBirthYyyymmdd));
        return sections;
    }

    /// <summary>"אב" / "אם" plus the relationship kind for non-biological edges.</summary>
    private static string ParentMeta(string parentRole, string relationshipType) =>
        relationshipType == "BIOLOGICAL"
            ? ParentRoleLabel(parentRole)
            : $"{ParentRoleLabel(parentRole)} · {RelationshipTypeLabel(relationshipType)}";

    /// <summary>
    /// Child meta — the focal person is the parent, so role/relationship only
    /// show for non-biological edges (same rule as the website's
    /// <c>focalChildCardMetaLine</c>).
    /// </summary>
    private static string? ChildMeta(TanahpediaFamilyChildEdge edge) =>
        edge.RelationshipType == "BIOLOGICAL"
            ? null
            : $"{ParentRoleLabel(edge.ParentRole)} · {RelationshipTypeLabel(edge.RelationshipType)}";

    private static string SpouseMeta(TanahpediaFamilySpouseEdge edge)
    {
        var parts = new List<string> { UnionTypeLabel(edge.UnionType) };
        if (edge.UnionEndReason is { } endReason)
        {
            var dates = (FormatYyyymmdd(edge.UnionStartDate), FormatYyyymmdd(edge.UnionEndDate)) switch
            {
                (string start, string end) => $" ({start}-{end})",
                (null, string end) => $" (-{end})",
                _ => string.Empty,
            };
            parts.Add($"{UnionEndReasonLabel(endReason)}{dates}");
        }
        return string.Join(" · ", parts);
    }

    /// <summary>
    /// When several edges in a list target the same person (alternate-opinion
    /// groups), each row gets an ordinal prefix — the website's "שיטה א'/ב'"
    /// opinion blocks.
    /// </summary>
    private static List<TanahpediaFamilyRow> WithOpinionOrdinals(List<TanahpediaFamilyRow> rows)
    {
        var counts = rows
            .Where(row => row.AltGroupId is not null)
            .GroupBy(row => row.RelatedEntityId)
            .ToDictionary(group => group.Key, group => group.Count());
        if (counts.Count == 0)
        {
            return rows;
        }

        var ordinals = new Dictionary<string, int>();
        foreach (var row in rows)
        {
            if (row.AltGroupId is null || counts.GetValueOrDefault(row.RelatedEntityId) < 2)
            {
                continue;
            }
            var index = ordinals.GetValueOrDefault(row.RelatedEntityId);
            ordinals[row.RelatedEntityId] = index + 1;
            row.Meta = row.Meta is null
                ? OpinionOrdinalTitle(index)
                : $"{OpinionOrdinalTitle(index)} · {row.Meta}";
        }
        return rows;
    }

    /// <summary>
    /// Children grouped by their other parent — "ילדים מ-שרה" blocks ordered
    /// like the website (named co-parents by union order, the unknown
    /// co-parent bucket last). The "מ-X" subtitle is skipped when the single
    /// co-parent bucket simply repeats the single spouse — the website's
    /// <c>shouldShowCoParentSubtitles</c> rule.
    /// </summary>
    private static IEnumerable<TanahpediaFamilySection> BuildChildrenSections(
        List<TanahpediaFamilyChildEdge> children,
        List<TanahpediaFamilySpouseEdge> spouses)
    {
        if (children.Count == 0)
        {
            yield break;
        }

        var groups = children
            .GroupBy(edge => edge.CoParentEntityId ?? string.Empty)
            .OrderBy(group => group.Key.Length == 0 ? 1 : 0)
            .ThenBy(group => group.Min(edge => edge.CoParentUnionOrder ?? int.MaxValue))
            .ThenBy(group => group.First().CoParentDisplayName, StringComparer.Ordinal)
            .ToList();
        var anyNamedCoParent = groups.Any(group => group.Key.Length > 0);

        var spouseEntityIds = spouses
            .Select(spouse => spouse.Related.EntityId)
            .Distinct()
            .ToList();
        var showCoParentSubtitles = groups.Count > 1 ||
            (groups.Count == 1 && groups[0].Key.Length > 0 &&
             (spouseEntityIds.Count != 1 || groups[0].Key != spouseEntityIds[0]));

        foreach (var group in groups)
        {
            var title = group.Key.Length == 0
                ? anyNamedCoParent ? "ילדים (בת זוג לא מזוהה בנתונים)" : "ילדים"
                : showCoParentSubtitles && group.First().CoParentDisplayName is { } coParent
                    ? $"ילדים מ-{coParent}"
                    : "ילדים";

            var rows = WithOpinionOrdinals(group
                .OrderBy(edge => edge.BirthOrder ?? int.MaxValue)
                .ThenBy(edge => edge.Related.DisplayName, StringComparer.Ordinal)
                .Select(edge => new TanahpediaFamilyRow
                {
                    DisplayName = edge.Related.DisplayName,
                    EntryUniqueName = edge.Related.EntryUniqueName,
                    SexMark = SexMark(edge.Related.Sex),
                    Meta = ChildMeta(edge),
                    SourceCitation = edge.SourceCitation,
                    AltGroupId = edge.AltGroupId,
                    RelatedEntityId = edge.Related.EntityId,
                })
                .ToList());
            yield return new TanahpediaFamilySection { Title = title, Rows = rows };
        }
    }

    /// <summary>
    /// Siblings split by birth date relative to the focal person — "אחים
    /// מבוגרים"/"אחים צעירים" when the split is meaningful, else a single
    /// "אחים" section (the website's two equal columns collapse to one list on
    /// a narrow screen).
    /// </summary>
    private static IEnumerable<TanahpediaFamilySection> BuildSiblingSections(
        List<TanahpediaFamilySibling> siblings,
        int? focalBirthYyyymmdd)
    {
        if (siblings.Count == 0)
        {
            yield break;
        }

        List<TanahpediaFamilySibling> older = [];
        List<TanahpediaFamilySibling> younger = [];
        List<TanahpediaFamilySibling> unknown = [];
        if (focalBirthYyyymmdd is { } focalBirth)
        {
            foreach (var sibling in siblings)
            {
                if (sibling.BirthDateYyyymmdd is { } birth && birth < focalBirth)
                {
                    older.Add(sibling);
                }
                else if (sibling.BirthDateYyyymmdd is { } b && b > focalBirth)
                {
                    younger.Add(sibling);
                }
                else
                {
                    unknown.Add(sibling);
                }
            }
        }
        else
        {
            unknown = siblings;
        }

        var differentiated = older.Count > 0 && younger.Count > 0;
        if (differentiated)
        {
            yield return SiblingSection("אחים מבוגרים", SortByName(older));
            yield return SiblingSection("אחים צעירים", SortByName([.. younger, .. unknown]));
        }
        else
        {
            yield return SiblingSection("אחים", SortByName(siblings));
        }
    }

    private static TanahpediaFamilySection SiblingSection(
        string title,
        List<TanahpediaFamilySibling> siblings) => new()
    {
        Title = title,
        Rows = siblings.Select(sibling => new TanahpediaFamilyRow
        {
            DisplayName = sibling.DisplayName,
            EntryUniqueName = sibling.EntryUniqueName,
            SexMark = SexMark(sibling.Sex),
            SourceCitation = sibling.SourceCitation,
            RelatedEntityId = sibling.EntityId,
        }).ToList(),
    };

    private static List<TanahpediaFamilySibling> SortByName(IEnumerable<TanahpediaFamilySibling> siblings) =>
        siblings.OrderBy(sibling => sibling.DisplayName, StringComparer.Ordinal).ToList();
}

/// <summary>One row inside a family section — a related person.</summary>
public class TanahpediaFamilyRow
{
    public required string DisplayName { get; init; }

    /// <summary>Canonical entry slug when the person has an entry — the row
    /// then taps through to <c>tanahpediaEntry</c>.</summary>
    public string? EntryUniqueName { get; init; }

    /// <summary>ז/נ sex mark; null when unknown.</summary>
    public string? SexMark { get; init; }

    /// <summary>Relationship qualifier ("אב", "נישואין · פטירה", opinion
    /// ordinals); null when plain.</summary>
    public string? Meta { get; set; }

    /// <summary>Free-text source citation backing the relationship.</summary>
    public string? SourceCitation { get; init; }

    /// <summary>Alternate-opinion group id; used to detect multi-opinion edges.</summary>
    public string? AltGroupId { get; init; }

    /// <summary>Related person's entity id — groups repeat edges (opinions).</summary>
    public string RelatedEntityId { get; init; } = string.Empty;

    public bool IsLink => !string.IsNullOrEmpty(EntryUniqueName);
    public bool HasMeta => !string.IsNullOrEmpty(Meta);
    public bool HasSource => !string.IsNullOrEmpty(SourceCitation);
}

/// <summary>A titled block of family rows — "הורים", "בנות זוג", "ילדים מ-שרה".</summary>
public class TanahpediaFamilySection
{
    public required string Title { get; init; }
    public required IReadOnlyList<TanahpediaFamilyRow> Rows { get; init; }
}
