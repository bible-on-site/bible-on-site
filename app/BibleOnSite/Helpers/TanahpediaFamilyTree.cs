using BibleOnSite.Models;

namespace BibleOnSite.Helpers;

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
