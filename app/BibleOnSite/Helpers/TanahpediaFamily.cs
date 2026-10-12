using BibleOnSite.Models;

namespace BibleOnSite.Helpers;

/// <summary>
/// Hebrew labels and section building for the person-family surface — mirrors
/// the website's <c>person-family-labels.ts</c> and
/// <c>PersonFamilyTree.tsx</c> so entry pages show the same relationship
/// wording (אב/אם, נישואין/פילגש, אחים מבוגרים/צעירים, שיטה א'/ב', חלופי, …).
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

    /// <summary>Website's union-type opinion sort order — נישואין first,
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
    /// alternative-opinion group — the website's <c>altGroupLabel</c>
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

    /// <summary>Father sorts before mother for consistent RTL row order.</summary>
    public static int ParentRoleSortKey(string? code) => code switch
    {
        "FATHER" => 0,
        "MOTHER" => 1,
        _ => 2,
    };

    /// <summary>Opinion-interpretation prefix when one spouse unit holds several
    /// union edges — the website's "שיטה א'/ב'" interpretation ordinals.</summary>
    public static string OpinionOrdinalTitle(int index) =>
        index >= 0 && index < _opinionOrdinals.Length
            ? $"שיטה {_opinionOrdinals[index]}"
            : $"שיטה {index + 1}";

    /// <summary>
    /// Flattens the family summary into ordered display sections — parents,
    /// spouses, children (grouped by co-parent) and siblings (split by birth
    /// date relative to the focal person when known) — mirroring the website's
    /// family tree layout as a compact mobile list. Rows that belong to a
    /// non-null <c>altGroupId</c> (a competing opinion model) are prefixed with
    /// "חלופי" so they never read as simultaneous relatives.
    /// </summary>
    public static List<TanahpediaFamilySection> BuildSections(TanahpediaPersonFamily family)
    {
        var sections = new List<TanahpediaFamilySection>();

        if (family.Parents.Count > 0)
        {
            // Canonical (null) group first, then each alternative-opinion group
            // — mirrors groupByAltGroupId + orderedParentGroups.
            var rows = family.Parents
                .OrderBy(e => e.AltGroupId is null ? 0 : 1)
                .ThenBy(e => e.AltGroupId, StringComparer.Ordinal)
                .ThenBy(e => ParentRoleSortKey(e.ParentRole))
                .ThenBy(e => e.Related.DisplayName, StringComparer.Ordinal)
                .Select(edge => new TanahpediaFamilyRow
                {
                    DisplayName = edge.Related.DisplayName,
                    EntryUniqueName = edge.Related.EntryUniqueName,
                    SexMark = SexMark(edge.Related.Sex),
                    Meta = JoinMeta(
                        AlternativeMark(edge.AltGroupId),
                        ParentMeta(edge.ParentRole, edge.RelationshipType)),
                    SourceCitation = edge.SourceCitation,
                })
                .ToList();
            sections.Add(new TanahpediaFamilySection { Title = "הורים", Rows = rows });
        }

        if (family.Spouses.Count > 0)
        {
            sections.Add(new TanahpediaFamilySection
            {
                Title = SpousesSectionLabel(family.FocalSex),
                Rows = BuildSpouseRows(family.Spouses),
            });
        }

        sections.AddRange(BuildChildrenSections(family.Children, family.Spouses));
        sections.AddRange(BuildSiblingSections(family.Siblings, family.FocalBirthYyyymmdd));
        return sections;
    }

    /// <summary>"חלופי" for a row inside an alternative-opinion group, else null.</summary>
    private static string? AlternativeMark(string? altGroupId) =>
        altGroupId is null ? null : AlternativeGroupLabel;

    /// <summary>Joins meta fragments with " · ", skipping null/empty parts.</summary>
    private static string? JoinMeta(params string?[] parts)
    {
        var kept = parts.Where(part => !string.IsNullOrEmpty(part)).ToList();
        return kept.Count > 0 ? string.Join(" · ", kept) : null;
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

    /// <summary>
    /// Union type plus the timeline bits — mirrors the website's
    /// <c>spouseTimelineSuffix</c>: "התחלה X" whenever a start exists,
    /// "{reason} Y" when the union ended for a reason, and "סיום Y" when it
    /// ended without a reason. Ongoing unions therefore still show their
    /// start date.
    /// </summary>
    private static string SpouseMeta(TanahpediaFamilySpouseEdge edge)
    {
        var parts = new List<string> { UnionTypeLabel(edge.UnionType) };
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
        return string.Join(" · ", parts);
    }

    /// <summary>
    /// Spouse "units" like the website's <c>buildSpouseUnits</c>: each
    /// alternative-opinion group contributes units per partner entity, and the
    /// canonical (null) group contributes one unit per edge. A unit with
    /// several union edges is one partner under several interpretations and
    /// gets "שיטה א'/ב'" ordinals — never alternative partners shown as one.
    /// </summary>
    private static List<TanahpediaFamilyRow> BuildSpouseRows(List<TanahpediaFamilySpouseEdge> spouses)
    {
        var units = BuildSpouseUnits(spouses);
        var rows = new List<TanahpediaFamilyRow>();
        foreach (var unit in units)
        {
            var sorted = SortEdgesForOpinions(unit.Edges);
            var multi = sorted.Count > 1;
            // The partner's own citation is card-level on the website — dedupe
            // across interpretations and show it once, on the first row.
            var personCitation = string.Join("\n", sorted
                .Select(edge => edge.PersonSourceCitation?.Trim())
                .Where(text => !string.IsNullOrEmpty(text))
                .Distinct()!);
            for (var i = 0; i < sorted.Count; i++)
            {
                var edge = sorted[i];
                rows.Add(new TanahpediaFamilyRow
                {
                    DisplayName = edge.Related.DisplayName,
                    EntryUniqueName = edge.Related.EntryUniqueName,
                    SexMark = SexMark(edge.Related.Sex),
                    Meta = JoinMeta(
                        AlternativeMark(edge.AltGroupId),
                        multi ? OpinionOrdinalTitle(i) : null,
                        SpouseMeta(edge)),
                    SourceCitation = edge.SourceCitation,
                    PersonSourceCitation = i == 0 && personCitation.Length > 0
                        ? personCitation
                        : null,
                });
            }
        }
        return rows;
    }

    /// <summary>
    /// Clusters spouse edges into opinion units, then fuses a canonical
    /// נישואין edge with a same-partner, same-<c>unionOrder</c>
    /// <c>FORBIDDEN_WITH_GENTILE</c> edge — the website's
    /// <c>fuseMarriageAndForbiddenSpouseRows</c> — so that pair renders as one
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

        // fuseMarriageAndForbiddenSpouseRows — only single-edge units can pair.
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

    /// <summary>Interpretation ordering inside a spouse unit — the website's
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

    /// <summary>
    /// Children grouped by opinion group, then by their other parent —
    /// "ילדים מ-שרה" blocks ordered like the website (the canonical group
    /// first, named co-parents by union order, the unknown co-parent bucket
    /// last). The "מ-X" subtitle is skipped when the single co-parent bucket
    /// simply repeats the single spouse — the website's
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
            .GroupBy(edge => (AltGroup: edge.AltGroupId ?? string.Empty,
                              CoParent: edge.CoParentEntityId ?? string.Empty))
            .OrderBy(group => group.Key.AltGroup.Length == 0 ? 0 : 1)
            .ThenBy(group => group.Key.AltGroup, StringComparer.Ordinal)
            .ThenBy(group => group.Key.CoParent.Length == 0 ? 1 : 0)
            .ThenBy(group => group.Min(edge => edge.CoParentUnionOrder ?? int.MaxValue))
            .ThenBy(group => group.First().CoParentDisplayName, StringComparer.Ordinal)
            .ToList();
        var anyNamedCoParent = groups.Any(group => group.Key.CoParent.Length > 0);

        var spouseEntityIds = spouses
            .Select(spouse => spouse.Related.EntityId)
            .Distinct()
            .ToList();
        var showCoParentSubtitles = groups.Count > 1 ||
            (groups.Count == 1 && groups[0].Key.CoParent.Length > 0 &&
             (spouseEntityIds.Count != 1 || groups[0].Key.CoParent != spouseEntityIds[0]));

        foreach (var group in groups)
        {
            var baseTitle = group.Key.CoParent.Length == 0
                ? anyNamedCoParent ? "ילדים (בת זוג לא מזוהה בנתונים)" : "ילדים"
                : showCoParentSubtitles && group.First().CoParentDisplayName is { } coParent
                    ? $"ילדים מ-{coParent}"
                    : "ילדים";
            // The whole section is one opinion block — mark it in the title
            // like the website's "חלופי" block label.
            var title = group.Key.AltGroup.Length == 0
                ? baseTitle
                : $"{AlternativeGroupLabel} · {baseTitle}";

            var rows = group
                .OrderBy(edge => edge.BirthOrder ?? int.MaxValue)
                .ThenBy(edge => edge.Related.DisplayName, StringComparer.Ordinal)
                .Select(edge => new TanahpediaFamilyRow
                {
                    DisplayName = edge.Related.DisplayName,
                    EntryUniqueName = edge.Related.EntryUniqueName,
                    SexMark = SexMark(edge.Related.Sex),
                    Meta = ChildMeta(edge),
                    SourceCitation = edge.SourceCitation,
                })
                .ToList();
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
    /// ordinals, "חלופי"); null when plain.</summary>
    public string? Meta { get; init; }

    /// <summary>Free-text source citation backing the relationship (the union
    /// citation on spouse rows) — the website's ribbon citation.</summary>
    public string? SourceCitation { get; init; }

    /// <summary>The related person's own source citation — e.g. their birth
    /// verse — kept separate from <see cref="SourceCitation"/> like the
    /// website's card-level <c>personSourceCitation</c>.</summary>
    public string? PersonSourceCitation { get; init; }

    public bool IsLink => !string.IsNullOrEmpty(EntryUniqueName);
    public bool HasMeta => !string.IsNullOrEmpty(Meta);
    public bool HasSource => !string.IsNullOrEmpty(SourceCitation);
    public bool HasPersonSource => !string.IsNullOrEmpty(PersonSourceCitation);
}

/// <summary>A titled block of family rows — "הורים", "בנות זוג", "ילדים מ-שרה".</summary>
public class TanahpediaFamilySection
{
    public required string Title { get; init; }
    public required IReadOnlyList<TanahpediaFamilyRow> Rows { get; init; }
}
