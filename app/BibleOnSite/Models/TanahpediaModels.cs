namespace BibleOnSite.Models;

/// <summary>
/// Lightweight reference to a published Tanahpedia entry — the stable identity
/// used by in-app routes and in-content links.
/// </summary>
public class TanahpediaEntryStub
{
    public string Id { get; set; } = string.Empty;

    /// <summary>Canonical entry slug; synonyms resolve to this value.</summary>
    public string UniqueName { get; set; } = string.Empty;

    public string Title { get; set; } = string.Empty;
}

/// <summary>A published Tanahpedia entry (browse list shape).</summary>
public class TanahpediaEntry
{
    public string Id { get; set; } = string.Empty;
    public string UniqueName { get; set; } = string.Empty;
    public string Title { get; set; } = string.Empty;

    /// <summary>Admin-authored HTML body; null when the entry has no content yet.</summary>
    public string? Content { get; set; }

    public string UpdatedAt { get; set; } = string.Empty;
}

/// <summary>An entity linked to an entry through <c>tanahpedia_entry_entity</c>.</summary>
public class TanahpediaLinkedEntity
{
    /// <summary><c>tanahpedia_entry_entity.id</c></summary>
    public string Id { get; set; } = string.Empty;

    public string EntityId { get; set; } = string.Empty;

    /// <summary>PERSON, PLACE, EVENT, WAR, ANIMAL, OBJECT, TEMPLE_TOOL, PLANT,
    /// ASTRONOMICAL_OBJECT, SAYING, SEFER, TANAH_SEFER, PROPHECY, NATION.</summary>
    public string EntityType { get; set; } = string.Empty;

    public string EntityName { get; set; } = string.Empty;
}

/// <summary>
/// A Tanah text occurrence attached to one of the entry's entities: a perek +
/// pasuk pair plus optional sub-pasuk segment coordinates.
/// </summary>
public class TanahpediaEntryOccurrence
{
    /// <summary><c>tanah_perek.id</c> (1-929).</summary>
    public int PerekId { get; set; }

    /// <summary>1-based pasuk index within the perek.</summary>
    public int PasukNumber { get; set; }

    /// <summary>0-based segment index; null means the whole pasuk.</summary>
    public int? SegmentStart { get; set; }

    /// <summary>0-based segment index (inclusive); null means the whole pasuk.</summary>
    public int? SegmentEnd { get; set; }
}

/// <summary>
/// An entry with its linked entities and Tanah occurrences — everything a
/// reader page needs in a single round trip.
/// </summary>
public class TanahpediaEntryDetail
{
    public string Id { get; set; } = string.Empty;
    public string UniqueName { get; set; } = string.Empty;
    public string Title { get; set; } = string.Empty;
    public string? Content { get; set; }
    public string UpdatedAt { get; set; } = string.Empty;
    public List<TanahpediaLinkedEntity> Entities { get; set; } = new();
    public List<TanahpediaEntryOccurrence> Occurrences { get; set; } = new();
}

/// <summary>
/// An entity of a given type with the entries that describe it — zero, one or
/// several (the page renders the name plain, linked, or disambiguated).
/// </summary>
public class TanahpediaEntityWithEntries
{
    public string EntityId { get; set; } = string.Empty;
    public string EntityType { get; set; } = string.Empty;
    public string EntityName { get; set; } = string.Empty;
    public List<TanahpediaEntryStub> LinkedEntries { get; set; } = new();
}

/// <summary>
/// Display shape for one entity row — mirrors the website's
/// <c>EntityListItem</c>: zero entries render the name plain (with an
/// "אין ערך" badge in listings), one entry makes the name itself the link,
/// several render the name followed by bracketed entry links. The "today"
/// variant shows only the entry links (or the plain name when there are none).
/// </summary>
public class TanahpediaEntityItem
{
    /// <summary>The entity's display name.</summary>
    public required string EntityName { get; init; }

    /// <summary>Show the name as plain (non-link) text.</summary>
    public bool ShowNamePlain { get; init; }

    /// <summary>Show the "(אין ערך)" badge — category listings only.</summary>
    public bool ShowNoEntryBadge { get; init; }

    /// <summary>The name itself is the entry link (exactly one linked entry).</summary>
    public bool IsSingleLink { get; init; }

    /// <summary>Entry unique name for <see cref="IsSingleLink"/> taps.</summary>
    public string? SingleUniqueName { get; init; }

    /// <summary>Show the per-entry link list.</summary>
    public bool ShowLinks { get; init; }

    /// <summary>Entry links with display prefixes (" [", ", ", " / ").</summary>
    public List<TanahpediaEntryLink> Links { get; init; } = [];

    /// <summary>Listing shape: name (badge) | name→link | name [link, link].</summary>
    public static TanahpediaEntityItem ForListing(TanahpediaEntityWithEntries entity)
    {
        return entity.LinkedEntries.Count switch
        {
            0 => new TanahpediaEntityItem
            {
                EntityName = entity.EntityName,
                ShowNamePlain = true,
                ShowNoEntryBadge = true,
            },
            1 => new TanahpediaEntityItem
            {
                EntityName = entity.EntityName,
                IsSingleLink = true,
                SingleUniqueName = entity.LinkedEntries[0].UniqueName,
            },
            _ => new TanahpediaEntityItem
            {
                EntityName = entity.EntityName,
                ShowNamePlain = true,
                ShowLinks = true,
                Links = entity.LinkedEntries
                    .Select((entry, index) => new TanahpediaEntryLink
                    {
                        UniqueName = entry.UniqueName,
                        Title = entry.Title,
                        Prefix = index == 0 ? " [" : ", ",
                        Suffix = index == entity.LinkedEntries.Count - 1 ? "]" : string.Empty,
                    })
                    .ToList(),
            },
        };
    }

    /// <summary>Today-section shape: plain name when no entries, else "link / link".</summary>
    public static TanahpediaEntityItem ForToday(TanahpediaEntityWithEntries entity)
    {
        if (entity.LinkedEntries.Count == 0)
        {
            return new TanahpediaEntityItem
            {
                EntityName = entity.EntityName,
                ShowNamePlain = true,
            };
        }

        return new TanahpediaEntityItem
        {
            EntityName = entity.EntityName,
            ShowLinks = true,
            Links = entity.LinkedEntries
                .Select((entry, index) => new TanahpediaEntryLink
                {
                    UniqueName = entry.UniqueName,
                    Title = entry.Title,
                    Prefix = index == 0 ? string.Empty : " / ",
                })
                .ToList(),
        };
    }
}

/// <summary>One tappable entry link inside an entity row.</summary>
public class TanahpediaEntryLink
{
    /// <summary>Separator drawn before the link (" [", ",", " / " or empty).</summary>
    public string Prefix { get; init; } = string.Empty;

    /// <summary>Separator drawn after the link ("]" on the last bracketed link).</summary>
    public string Suffix { get; init; } = string.Empty;

    /// <summary>Canonical entry slug used for navigation.</summary>
    public string UniqueName { get; init; } = string.Empty;

    /// <summary>Entry title shown to the reader.</summary>
    public string Title { get; init; } = string.Empty;
}

/// <summary>
/// Number of published entries linked to a category key — either a base entity
/// type or a subcategory (PROPHET/KING, animal kinds and purities).
/// </summary>
public class TanahpediaCategoryCount
{
    public string Category { get; set; } = string.Empty;
    public int Count { get; set; }
}

/// <summary>
/// One entry a synonym can lead to. A single target means a plain alias;
/// several mean the name is ambiguous and the reader has to choose.
/// </summary>
public class TanahpediaSynonymTarget
{
    public string EntryId { get; set; } = string.Empty;
    public string UniqueName { get; set; } = string.Empty;
    public string Title { get; set; } = string.Empty;

    /// <summary>Human label distinguishing ambiguous targets; null for direct links.</summary>
    public string? Label { get; set; }
}

/// <summary>Category homepage configuration.</summary>
public class TanahpediaCategoryHomepage
{
    public string EntityType { get; set; } = string.Empty;

    /// <summary>LIST, MAP, GALLERY or TIMELINE.</summary>
    public string LayoutType { get; set; } = string.Empty;

    /// <summary>Admin-authored HTML intro rendered above the listing.</summary>
    public string? Content { get; set; }
}
