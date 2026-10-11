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
    Task<List<TanahpediaEntry>> GetEntriesAsync(int limit, int offset, CancellationToken cancellationToken = default);

    /// <summary>Entries most recently updated — the landing "עודכנו לאחרונה" section.</summary>
    Task<List<TanahpediaEntry>> GetRecentEntriesAsync(int limit, CancellationToken cancellationToken = default);

    /// <summary>
    /// A single entry by its canonical <paramref name="uniqueName"/>, with linked
    /// entities and their Tanah occurrences. Null when no entry owns the name —
    /// callers then try <see cref="GetSynonymTargetsAsync"/> for alias or
    /// disambiguation resolution, like the website does.
    /// </summary>
    Task<TanahpediaEntryDetail?> GetEntryDetailAsync(string uniqueName, CancellationToken cancellationToken = default);

    /// <summary>
    /// Entries a synonym name can lead to: 0 results = unknown name, 1 = plain
    /// alias, several = ambiguous — the client renders a chooser.
    /// </summary>
    Task<List<TanahpediaSynonymTarget>> GetSynonymTargetsAsync(string name, CancellationToken cancellationToken = default);

    /// <summary>Published-entry counts per category key for the landing grid.</summary>
    Task<List<TanahpediaCategoryCount>> GetCategoryCountsAsync(CancellationToken cancellationToken = default);

    /// <summary>
    /// All entities of a category with the entries that describe them —
    /// powers the 0/1/many-entry listing pages. <paramref name="entityType"/> is
    /// a base entity type; <paramref name="sub"/> optionally narrows it
    /// (PROPHET/KING under PERSON, animal kinds/purities under ANIMAL).
    /// </summary>
    Task<List<TanahpediaEntityWithEntries>> GetEntitiesWithEntriesAsync(string entityType, string? sub = null, CancellationToken cancellationToken = default);

    /// <summary>
    /// Entities whose Hebrew-date anniversary falls on the given Hebrew
    /// month/day — the landing "היום בתנ"ך" section.
    /// </summary>
    Task<List<TanahpediaEntityWithEntries>> GetTodayEntitiesAsync(int hebrewMonth, int hebrewDay, CancellationToken cancellationToken = default);

    /// <summary>Homepage configuration (layout + intro) for an entity type, when configured.</summary>
    Task<TanahpediaCategoryHomepage?> GetCategoryHomepageAsync(string entityType, CancellationToken cancellationToken = default);
}
