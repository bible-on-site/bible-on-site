using BibleOnSite.Models;

namespace BibleOnSite.Helpers;

public static partial class TanahpediaFamily
{
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

/// <summary>Ribbon-line roles above a card - matching the website's
/// relationRibbon/opinion-title/citation/timeline styling.</summary>
public enum TanahpediaFamilyRibbonKind
{
    /// <summary>"שיטה א'/ב'" - interpretation ordinal, bold.</summary>
    Ordinal,

    /// <summary>The relationship kind (אב, נישואין, אב · אימוץ) - emphasis.</summary>
    Main,

    /// <summary>A source citation backing the union/relationship.</summary>
    Citation,

    /// <summary>Secondary facts - "סדר N", union timeline.</summary>
    Meta,
}

/// <summary>One ribbon line rendered above a person card.</summary>
public sealed record TanahpediaFamilyRibbonLine(TanahpediaFamilyRibbonKind Kind, string Text);

/// <summary>
/// A person card in the tree - display name, ז/נ sex mark, in-card citation
/// lines, and the entry link when the person has an entry. The focal card
/// never links (it is the entry being viewed).
/// </summary>
public class TanahpediaFamilyCard
{
    public required string DisplayName { get; init; }
    public string? EntryUniqueName { get; init; }
    public string? SexMark { get; init; }
    public IReadOnlyList<string> CardCitations { get; set; } = [];

    /// <summary>The focal person card - highlighted, centered on the axis.</summary>
    public bool IsFocal { get; init; }

    public bool IsLink => !string.IsNullOrEmpty(EntryUniqueName);
    public bool HasCitations => CardCitations.Count > 0;
}

/// <summary>A card plus the ribbon lines stacked above it.</summary>
public class TanahpediaFamilyCardStack
{
    public IReadOnlyList<TanahpediaFamilyRibbonLine> Ribbons { get; init; } = [];
    public required TanahpediaFamilyCard Card { get; init; }
}

/// <summary>
/// A labeled block of card stacks rendered as one centered wrap row -
/// <see cref="Labels"/> become pill labels stacked above the row ("חלופי",
/// "אחים מבוגרים", "ילדים מ-לאה").
/// </summary>
public class TanahpediaFamilyGroup
{
    public IReadOnlyList<string> Labels { get; init; } = [];
    public IReadOnlyList<TanahpediaFamilyCardStack> Stacks { get; init; } = [];
}

/// <summary>
/// One spouse unit - the partner card stack and, in the spouse/children
/// matrix layout, the children attributed to that partner rendered
/// underneath it.
/// </summary>
public class TanahpediaFamilySpouseUnit
{
    public required TanahpediaFamilyCardStack Spouse { get; init; }
    public IReadOnlyList<TanahpediaFamilyCardStack> Children { get; init; } = [];
}

/// <summary>
/// The family neighborhood of a PERSON entity as a vertical card tree - the
/// mobile axis of the website's PersonFamilyTree: הורים above the focal card,
/// then אחים clusters, בני/בנות זוג units (with matrix children), then
/// ילדים buckets.
/// </summary>
public class TanahpediaFamilyTree
{
    public required TanahpediaFamilyCard Focal { get; init; }
    public IReadOnlyList<TanahpediaFamilyGroup> ParentGroups { get; init; } = [];
    public IReadOnlyList<TanahpediaFamilyGroup> SiblingClusters { get; init; } = [];
    public string? SpousesLabel { get; init; }
    public IReadOnlyList<TanahpediaFamilySpouseUnit> SpouseUnits { get; init; } = [];
    public string? LooseChildrenLabel { get; init; }
    public IReadOnlyList<TanahpediaFamilyCardStack> LooseChildren { get; init; } = [];
    public IReadOnlyList<TanahpediaFamilyGroup> ChildGroups { get; init; } = [];
}
