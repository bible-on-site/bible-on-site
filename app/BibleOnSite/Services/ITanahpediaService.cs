using BibleOnSite.Models;

namespace BibleOnSite.Services;

/// <summary>
/// Public read contract for Tanahpedia encyclopedia content — the same
/// published data the website serves under <c>/pedia</c>, exposed through the
/// GraphQL API. Every method throws on transport/API failure so callers can
/// show an explicit error state with retry.
/// </summary>
public interface ITanahpediaService
{
    /// <summary>Published entries ordered by title — the browse list.</summary>
    Task<List<TanahpediaEntry>> GetEntriesAsync(int limit, int offset, CancellationToken cancellationToken);

    /// <summary>Entries most recently updated — the landing "עודכנו לאחרונה" section.</summary>
    Task<List<TanahpediaEntry>> GetRecentEntriesAsync(int limit, CancellationToken cancellationToken);

    /// <summary>
    /// A single entry by its canonical <paramref name="uniqueName"/>, with linked
    /// entities and their Tanah occurrences. Null when no entry owns the name —
    /// callers then try <see cref="GetSynonymTargetsAsync"/> for alias or
    /// disambiguation resolution, like the website does.
    /// </summary>
    Task<TanahpediaEntryDetail?> GetEntryDetailAsync(string uniqueName, CancellationToken cancellationToken);

    /// <summary>
    /// Lexical search over published entries — title, canonical name,
    /// synonym/alias names (direct and disambiguation targets) and body
    /// content — ranked like the website's /search tanahpedia provider, one
    /// hit per entry so an ambiguous name surfaces every target rather than
    /// silently picking one. <paramref name="limit"/> clamps to the API's 50.
    /// </summary>
    Task<List<TanahpediaSearchHit>> SearchEntriesAsync(string phrase, int limit, CancellationToken cancellationToken);

    /// <summary>
    /// Entries a synonym name can lead to: 0 results = unknown name, 1 = plain
    /// alias, several = ambiguous — the client renders a chooser.
    /// </summary>
    Task<List<TanahpediaSynonymTarget>> GetSynonymTargetsAsync(string name, CancellationToken cancellationToken);

    /// <summary>Published-entry counts per category key for the landing grid.</summary>
    Task<List<TanahpediaCategoryCount>> GetCategoryCountsAsync(CancellationToken cancellationToken);

    /// <summary>
    /// All entities of a category with the entries that describe them —
    /// powers the 0/1/many-entry listing pages. <paramref name="entityType"/> is
    /// a base entity type; <paramref name="sub"/> optionally narrows it
    /// (PROPHET/KING under PERSON, animal kinds/purities under ANIMAL).
    /// </summary>
    Task<List<TanahpediaEntityWithEntries>> GetEntitiesWithEntriesAsync(string entityType, string? sub, CancellationToken cancellationToken);

    /// <summary>
    /// Entities whose Hebrew-date anniversary falls on the given Hebrew
    /// month/day — the landing "היום בתנ"ך" section.
    /// </summary>
    Task<List<TanahpediaEntityWithEntries>> GetTodayEntitiesAsync(int hebrewMonth, int hebrewDay, CancellationToken cancellationToken);

    /// <summary>Homepage configuration (layout + intro) for an entity type, when configured.</summary>
    Task<TanahpediaCategoryHomepage?> GetCategoryHomepageAsync(string entityType, CancellationToken cancellationToken);

    /// <summary>
    /// Parents, children, spouses and siblings of a PERSON entity with their
    /// source citations — the family section on person entries.
    /// <paramref name="entityId"/> is the entity's <c>tanahpedia_entity.id</c>
    /// (as returned in <see cref="TanahpediaLinkedEntity.EntityId"/>). Null
    /// when the entity is not a person or has no family data.
    /// </summary>
    Task<TanahpediaPersonFamily?> GetPersonFamilyAsync(string entityId, CancellationToken cancellationToken);

    /// <summary>
    /// Place identification pins for the places map. <paramref name="entryId"/>
    /// null returns every identified place (the PLACE category map); a value
    /// scopes the pins to the PLACE entities linked to that entry.
    /// </summary>
    Task<List<TanahpediaPlaceMarker>> GetPlaceMarkersAsync(string? entryId, CancellationToken cancellationToken);
}
