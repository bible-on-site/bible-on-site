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

    /// <summary>
    /// Persisted canonical reading metric for the entry body (issue #2607).
    /// Null when the API has no metric row — badges render nothing.
    /// </summary>
    public ReadingMetric? ReadingMetric { get; set; }

    /// <summary>"זמן קריאה משוער: X" badge text or null when nothing to show.</summary>
    public string? ReadingTimeBadge =>
        Helpers.ReadingTimeFormatter.FormatReadingTimeLabel(ReadingMetric?.EstimatedSeconds);
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

/// <summary>
/// A person related to the focal person in a family edge — carries the linked
/// entry (when one exists) so rows render as links to that entry.
/// </summary>
public class TanahpediaFamilyPerson
{
    /// <summary><c>tanahpedia_person.id</c> of the related person.</summary>
    public string PersonId { get; set; } = string.Empty;

    /// <summary><c>tanahpedia_entity.id</c> of the related person.</summary>
    public string EntityId { get; set; } = string.Empty;

    public string DisplayName { get; set; } = string.Empty;

    /// <summary>Canonical entry slug describing the person; null when the
    /// person has no entry (the row then renders the name plain).</summary>
    public string? EntryUniqueName { get; set; }

    public string? EntryTitle { get; set; }

    /// <summary>MALE/FEMALE/UNKNOWN from <c>tanahpedia_person_sex</c>; null when
    /// unrecorded.</summary>
    public string? Sex { get; set; }
}

/// <summary>A parent edge of the focal person.</summary>
public class TanahpediaFamilyParentEdge
{
    public TanahpediaFamilyPerson Related { get; set; } = new();

    /// <summary>FATHER/MOTHER lookup code.</summary>
    public string ParentRole { get; set; } = string.Empty;

    /// <summary>BIOLOGICAL/ADOPTIVE/STEP lookup code.</summary>
    public string RelationshipType { get; set; } = string.Empty;

    /// <summary>Alternate-opinion group id; null for the primary modeling.</summary>
    public string? AltGroupId { get; set; }

    /// <summary>Free-text source citation backing this edge.</summary>
    public string? SourceCitation { get; set; }
}

/// <summary>A child edge of the focal person.</summary>
public class TanahpediaFamilyChildEdge
{
    public TanahpediaFamilyPerson Related { get; set; } = new();
    public string ParentRole { get; set; } = string.Empty;
    public string RelationshipType { get; set; } = string.Empty;
    public string? AltGroupId { get; set; }
    public string? SourceCitation { get; set; }

    /// <summary>Positive one-based birth order on the edge.</summary>
    public int? BirthOrder { get; set; }

    /// <summary>The other parent of this child, when modeled.</summary>
    public string? CoParentEntityId { get; set; }
    public string? CoParentDisplayName { get; set; }

    /// <summary>Union order of the focal person with the co-parent.</summary>
    public int? CoParentUnionOrder { get; set; }
}

/// <summary>A union (marriage/pilegesh/betrothal/…) edge of the focal person.</summary>
public class TanahpediaFamilySpouseEdge
{
    public TanahpediaFamilyPerson Related { get; set; } = new();

    /// <summary>MARRIAGE/PILEGESH/BETROTHAL/… lookup code.</summary>
    public string UnionType { get; set; } = string.Empty;

    public int? UnionOrder { get; set; }
    public string? AltGroupId { get; set; }

    /// <summary>Source citation classifying the union itself.</summary>
    public string? SourceCitation { get; set; }

    /// <summary>Source citation about the spouse person.</summary>
    public string? PersonSourceCitation { get; set; }

    /// <summary>DEATH/DIVORCE lookup code when the union ended.</summary>
    public string? UnionEndReason { get; set; }

    /// <summary>YYYYMMDD Hebrew-calendar dates when modeled.</summary>
    public int? UnionStartDate { get; set; }
    public int? UnionEndDate { get; set; }
}

/// <summary>
/// A sibling of the focal person — shares at least one parent edge. The
/// related-person fields mirror <see cref="TanahpediaFamilyPerson"/>.
/// </summary>
public class TanahpediaFamilySibling : TanahpediaFamilyPerson
{
    /// <summary>YYYYMMDD birth date; null when unrecorded.</summary>
    public int? BirthDateYyyymmdd { get; set; }

    /// <summary>Citation of the shared parent edge backing the sibling link.</summary>
    public string? SourceCitation { get; set; }
}

/// <summary>
/// The family neighborhood of a PERSON entity — parents, children, spouses and
/// siblings with their source citations. Mirrors the website's
/// <c>PersonFamilySummary</c>.
/// </summary>
public class TanahpediaPersonFamily
{
    public string FocalPersonId { get; set; } = string.Empty;
    public string FocalEntityId { get; set; } = string.Empty;
    public string FocalDisplayName { get; set; } = string.Empty;

    /// <summary>MALE/FEMALE/UNKNOWN; null when unrecorded.</summary>
    public string? FocalSex { get; set; }

    /// <summary>YYYYMMDD birth date of the focal person; null when unrecorded.</summary>
    public int? FocalBirthYyyymmdd { get; set; }

    public List<TanahpediaFamilyParentEdge> Parents { get; set; } = new();
    public List<TanahpediaFamilyChildEdge> Children { get; set; } = new();
    public List<TanahpediaFamilySpouseEdge> Spouses { get; set; } = new();
    public List<TanahpediaFamilySibling> Siblings { get; set; } = new();
}

/// <summary>
/// A place identification pin for the places map, with the place's first
/// linked entry for in-app navigation.
/// </summary>
public class TanahpediaPlaceMarker
{
    /// <summary><c>tanahpedia_place_identification.id</c> (the pin row).</summary>
    public string PlaceId { get; set; } = string.Empty;

    /// <summary>Entity display name of the place.</summary>
    public string PlaceName { get; set; } = string.Empty;

    /// <summary>Modern identification name, when recorded.</summary>
    public string? ModernName { get; set; }

    public double Lat { get; set; }
    public double Lng { get; set; }

    /// <summary>Canonical entry slug of the place's first linked entry;
    /// null when the place has no entry.</summary>
    public string? EntryUniqueName { get; set; }
}

// Reflection-based serialization is disabled in release builds, so the map
// WebView payload goes through a generated context (see TanahpediaMapHtml).
[System.Text.Json.Serialization.JsonSourceGenerationOptions(
    PropertyNamingPolicy = System.Text.Json.Serialization.JsonKnownNamingPolicy.CamelCase)]
[System.Text.Json.Serialization.JsonSerializable(
    typeof(IReadOnlyList<TanahpediaPlaceMarker>),
    TypeInfoPropertyName = "TanahpediaPlaceMarkers")]
#pragma warning disable S2333 // System.Text.Json source generation supplies this partial implementation.
public partial class TanahpediaJsonContext : System.Text.Json.Serialization.JsonSerializerContext;
#pragma warning restore S2333

/// <summary>
/// One ranked Tanahpedia search hit — the app counterpart of the website's
/// /search tanahpedia result: matched over title, canonical name,
/// synonym/alias names and body content, one hit per entry.
/// </summary>
public class TanahpediaSearchHit
{
    public string Id { get; set; } = string.Empty;

    /// <summary>Canonical entry slug — the navigation key, never a raw alias.</summary>
    public string UniqueName { get; set; } = string.Empty;

    public string Title { get; set; } = string.Empty;

    /// <summary>
    /// Plain-text snippet: the body window around a content match, the
    /// "נקרא גם:" alias list when an alias drove the match, or the body
    /// lead-in for a title-only match. Empty when the entry has neither.
    /// </summary>
    public string Excerpt { get; set; } = string.Empty;

    /// <summary>Relevance score — name fields weighted ×2 over body content.</summary>
    public int Score { get; set; }
}
