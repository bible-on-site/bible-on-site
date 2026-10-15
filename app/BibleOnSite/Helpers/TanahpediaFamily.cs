using BibleOnSite.Models;

namespace BibleOnSite.Helpers;

/// <summary>
/// Hebrew labels and tree building for the person-family surface - mirrors
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
    /// <summary>
    /// Builds the person-family surface as a vertical card tree - the mobile
    /// (narrow) layout of the website's <c>PersonFamilyTree</c>: tiers on one
    /// axis - הורים, the focal card, אחים, בני/בנות זוג, ילדים - each tier
    /// labeled, each person a card with ribbon lines above it. Returns null
    /// when the person has no modeled relatives (the section then hides,
    /// same as before).
    /// </summary>
    public static TanahpediaFamilyTree? BuildTree(TanahpediaPersonFamily family)
    {
        if (family.Parents.Count == 0 && family.Spouses.Count == 0
            && family.Children.Count == 0 && family.Siblings.Count == 0)
        {
            return null;
        }

        var units = BuildSpouseUnits(family.Spouses);
        var showUnionOrder = units.Count > 1;

        // matrixEligible - the website's spouse/children matrix: children only
        // attach under spouse columns when several spouses exist AND every
        // child edge sits in the canonical group AND at least one names a
        // co-parent. (The web's canUseSpouseChildMatrix check can never fail:
        // units always hold a single partner entity by construction.)
        var matrixEligible = units.Count > 1
            && family.Children.Count > 0
            && family.Children.All(child => child.AltGroupId is null)
            && family.Children.Any(child => child.CoParentEntityId is not null);

        var spousePartnerIds = units
            .Select(unit => unit.Edges[0].Related.EntityId)
            .ToHashSet(StringComparer.Ordinal);

        return new TanahpediaFamilyTree
        {
            Focal = new TanahpediaFamilyCard
            {
                DisplayName = family.FocalDisplayName,
                SexMark = SexMark(family.FocalSex),
                CardCitations = CitationLines(ParentSourceCitation(family.Parents)),
                IsFocal = true,
            },
            ParentGroups = BuildParentGroups(family.Parents),
            SiblingClusters = BuildSiblingClusters(family.Siblings, family.FocalBirthYyyymmdd),
            SpousesLabel = units.Count > 0 ? SpousesSectionLabel(family.FocalSex) : null,
            SpouseUnits = units
                .Select(unit => new TanahpediaFamilySpouseUnit
                {
                    Spouse = SpouseStack(unit.Edges, showUnionOrder),
                    Children = matrixEligible
                        ? SortedChildren(family.Children)
                            .Where(child => child.CoParentEntityId is { } coParent
                                && coParent == unit.Edges[0].Related.EntityId)
                            .Select(ChildStack)
                            .ToList()
                        : [],
                })
                .ToList(),
            LooseChildrenLabel = "ילדים ללא מיפוי מלא לבת זוג בגרף",
            LooseChildren = matrixEligible
                ? SortedChildren(family.Children)
                    .Where(child => child.CoParentEntityId is null
                        || !spousePartnerIds.Contains(child.CoParentEntityId))
                    .Select(ChildStack)
                    .ToList()
                : [],
            ChildGroups = matrixEligible
                ? []
                : BuildChildGroups(family.Children, units),
        };
    }

    /// <summary>Card model for a related person - name, sex mark, entry link.</summary>
    private static TanahpediaFamilyCard PersonCard(TanahpediaFamilyPerson person) => new()
    {
        DisplayName = person.DisplayName,
        EntryUniqueName = person.EntryUniqueName,
        SexMark = SexMark(person.Sex),
    };

    /// <summary>
    /// Parents tier - canonical group first, then each alternative-opinion
    /// group under a "חלופי" label (the website's orderedParentGroups +
    /// altGroupLabel). The edge citation is not on the parent card: it feeds
    /// the focal card via <see cref="ParentSourceCitation"/>.
    /// </summary>
    private static List<TanahpediaFamilyGroup> BuildParentGroups(List<TanahpediaFamilyParentEdge> parents) =>
        parents
            .GroupBy(edge => edge.AltGroupId)
            .OrderBy(group => group.Key is null ? 0 : 1)
            .ThenBy(group => group.Key, StringComparer.Ordinal)
            .Select(group => new TanahpediaFamilyGroup
            {
                Labels = group.Key is null ? [] : [AlternativeGroupLabel],
                Stacks = group
                    .OrderBy(edge => ParentRoleSortKey(edge.ParentRole))
                    .ThenBy(edge => edge.Related.DisplayName, StringComparer.Ordinal)
                    .Select(edge => new TanahpediaFamilyCardStack
                    {
                        Ribbons = [new TanahpediaFamilyRibbonLine(
                            TanahpediaFamilyRibbonKind.Main,
                            ParentMeta(edge.ParentRole, edge.RelationshipType))],
                        Card = PersonCard(edge.Related),
                    })
                    .ToList(),
            })
            .ToList();

    /// <summary>
    /// Relationship evidence shown on the focal card - the website's
    /// <c>parentSourceCitation</c>: when exactly one father and one mother are
    /// modeled, prefer a citation line shared by both; otherwise every unique
    /// parent-edge citation in order.
    /// </summary>
    private static string? ParentSourceCitation(List<TanahpediaFamilyParentEdge> parents)
    {
        var lineRoles = new Dictionary<string, HashSet<string>>(StringComparer.Ordinal);
        foreach (var parent in parents)
        {
            foreach (var line in CitationLines(parent.SourceCitation))
            {
                if (!lineRoles.TryGetValue(line, out var roles))
                {
                    roles = [];
                    lineRoles[line] = roles;
                }
                roles.Add(parent.ParentRole);
            }
        }

        var oneParentPerRole =
            parents.Count(parent => parent.ParentRole == "FATHER") == 1 &&
            parents.Count(parent => parent.ParentRole == "MOTHER") == 1;
        var shared = oneParentPerRole
            ? lineRoles.FirstOrDefault(pair =>
                pair.Value.Contains("FATHER") && pair.Value.Contains("MOTHER")).Key
            : null;
        return shared ?? (lineRoles.Count > 0 ? string.Join("\n", lineRoles.Keys) : null);
    }

    /// <summary>
    /// One spouse unit → one card stack: per union edge a ribbon group
    /// (שיטה ordinal when the unit holds several interpretations, union type,
    /// union citations, "סדר N" when several partners exist, timeline) above
    /// the shared partner card; the partner's own citation dedupes into the
    /// card, matching <c>SpouseInterpretationsCard</c>/<c>SpouseCard</c>.
    /// </summary>
    private static TanahpediaFamilyCardStack SpouseStack(
        List<TanahpediaFamilySpouseEdge> edges,
        bool showUnionOrder)
    {
        var sorted = SortEdgesForOpinions(edges);
        var multi = sorted.Count > 1;
        var ribbons = new List<TanahpediaFamilyRibbonLine>();
        for (var i = 0; i < sorted.Count; i++)
        {
            var edge = sorted[i];
            if (multi)
            {
                ribbons.Add(new TanahpediaFamilyRibbonLine(
                    TanahpediaFamilyRibbonKind.Ordinal, OpinionOrdinalTitle(i)));
            }
            ribbons.Add(new TanahpediaFamilyRibbonLine(
                TanahpediaFamilyRibbonKind.Main, UnionTypeLabel(edge.UnionType)));
            foreach (var line in CitationLines(edge.SourceCitation))
            {
                ribbons.Add(new TanahpediaFamilyRibbonLine(
                    TanahpediaFamilyRibbonKind.Citation, line));
            }
            if (showUnionOrder && edge.UnionOrder is { } order)
            {
                ribbons.Add(new TanahpediaFamilyRibbonLine(
                    TanahpediaFamilyRibbonKind.Meta, $"סדר {order}"));
            }
            if (SpouseTimelineText(edge) is { } timeline)
            {
                ribbons.Add(new TanahpediaFamilyRibbonLine(
                    TanahpediaFamilyRibbonKind.Meta, timeline));
            }
        }

        var card = PersonCard(sorted[0].Related);
        card.CardCitations = sorted
            .SelectMany(edge => CitationLines(edge.PersonSourceCitation))
            .Distinct()
            .ToList();
        return new TanahpediaFamilyCardStack { Ribbons = ribbons, Card = card };
    }

    /// <summary>A sibling → plain card with the edge citation inside it.</summary>
    private static TanahpediaFamilyCardStack SiblingStack(TanahpediaFamilySibling sibling)
    {
        var card = PersonCard(sibling);
        card.CardCitations = CitationLines(sibling.SourceCitation);
        return new TanahpediaFamilyCardStack { Card = card };
    }

    /// <summary>A child edge → card stack: optional non-biological meta
    /// ribbon above the card, the edge citation inside it.</summary>
    private static TanahpediaFamilyCardStack ChildStack(TanahpediaFamilyChildEdge edge)
    {
        var card = PersonCard(edge.Related);
        card.CardCitations = CitationLines(edge.SourceCitation);
        return new TanahpediaFamilyCardStack
        {
            Ribbons = ChildMeta(edge) is { } meta
                ? [new TanahpediaFamilyRibbonLine(TanahpediaFamilyRibbonKind.Main, meta)]
                : [],
            Card = card,
        };
    }

    /// <summary>Children order: birth order when any is recorded, then name -
    /// the website's <c>compareChildEdgesChronology</c>.</summary>
    private static IEnumerable<TanahpediaFamilyChildEdge> SortedChildren(
        IEnumerable<TanahpediaFamilyChildEdge> children) =>
        children
            .OrderBy(edge => edge.BirthOrder ?? int.MaxValue)
            .ThenBy(edge => edge.Related.DisplayName, StringComparer.Ordinal);

    /// <summary>
    /// Children tier (non-matrix): alt groups (canonical first, "חלופי" label
    /// on the group's first bucket) → co-parent buckets ("ילדים מ-X", the
    /// unknown bucket last) - the website's orderedChildGroups +
    /// partitionChildrenByCoParent + shouldShowCoParentSubtitles.
    /// </summary>
    private static List<TanahpediaFamilyGroup> BuildChildGroups(
        List<TanahpediaFamilyChildEdge> children,
        List<SpouseUnit> units)
    {
        var groups = new List<TanahpediaFamilyGroup>();
        var altGroups = children
            .GroupBy(edge => edge.AltGroupId)
            .OrderBy(group => group.Key is null ? 0 : 1)
            .ThenBy(group => group.Key, StringComparer.Ordinal);

        foreach (var altGroup in altGroups)
        {
            var buckets = altGroup
                .GroupBy(edge => edge.CoParentEntityId ?? string.Empty)
                .OrderBy(group => group.Key.Length == 0 ? 1 : 0)
                .ThenBy(group => group.Min(edge => edge.CoParentUnionOrder ?? int.MaxValue))
                .ThenBy(group => group.First().CoParentDisplayName, StringComparer.Ordinal)
                .ToList();

            // shouldShowCoParentSubtitles - the website compares against the
            // single spouse unit (not the distinct partner entities).
            var showCoParentSubtitles = buckets.Count > 1 ||
                (buckets.Count == 1 && buckets[0].Key.Length > 0 &&
                 (units.Count != 1 || buckets[0].Key != units[0].Edges[0].Related.EntityId));

            var first = true;
            foreach (var bucket in buckets)
            {
                var labels = new List<string>();
                if (first && altGroup.Key is not null)
                {
                    labels.Add(AlternativeGroupLabel);
                }
                first = false;
                if (showCoParentSubtitles)
                {
                    labels.Add(bucket.Key.Length > 0 && bucket.First().CoParentDisplayName is { } coParent
                        ? $"ילדים מ-{coParent}"
                        : "ילדים (בת זוג לא מזוהה בנתונים)");
                }

                groups.Add(new TanahpediaFamilyGroup
                {
                    Labels = labels,
                    Stacks = SortedChildren(bucket).Select(ChildStack).ToList(),
                });
            }
        }
        return groups;
    }

    /// <summary>
    /// Sibling clusters - "אחים מבוגרים"/"אחים צעירים" when the birth-date
    /// split against the focal person is meaningful, else one "אחים" cluster.
    /// </summary>
    private static List<TanahpediaFamilyGroup> BuildSiblingClusters(
        List<TanahpediaFamilySibling> siblings,
        int? focalBirthYyyymmdd)
    {
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
        var clusters = differentiated
            ? new[] { ("אחים מבוגרים", older), ("אחים צעירים", [.. younger, .. unknown]) }
            : new[] { ("אחים", siblings) };

        return clusters
            .Select(cluster => new TanahpediaFamilyGroup
            {
                Labels = [cluster.Item1],
                Stacks = cluster.Item2
                    .OrderBy(sibling => sibling.DisplayName, StringComparer.Ordinal)
                    .Select(SiblingStack)
                    .ToList(),
            })
            .ToList();
    }
}
