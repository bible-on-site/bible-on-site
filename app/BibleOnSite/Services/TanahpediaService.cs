using BibleOnSite.Models;
using GraphQL.Client.Http;

namespace BibleOnSite.Services;

/// <summary>
/// Fetches published Tanahpedia encyclopedia content from the GraphQL API —
/// the same data the website serves under <c>/pedia</c>. Drafts and review
/// states live in a separate admin workflow that requires no client support.
/// </summary>
public class TanahpediaService : BaseGraphQLService, ITanahpediaService
{
    private static readonly Lazy<TanahpediaService> _instance = new(() => new TanahpediaService());

    /// <summary>Singleton instance of the TanahpediaService.</summary>
    public static TanahpediaService Instance => _instance.Value;

    private TanahpediaService()
    {
    }

    public TanahpediaService(GraphQLHttpClient client) : base(client)
    {
    }

    /// <inheritdoc />
    public async Task<List<TanahpediaEntry>> GetEntriesAsync(int limit, int offset, CancellationToken cancellationToken)
    {
        var data = await QueryAsync<EntriesResponse>(@"
            query TanahpediaEntries($limit: Int, $offset: Int) {
                tanahpediaEntries(limit: $limit, offset: $offset) {
                    id
                    uniqueName
                    title
                    updatedAt
                }
            }",
            "TanahpediaEntries",
            new { limit, offset },
            cancellationToken);

        return (data?.TanahpediaEntries ?? []).Select(dto => new TanahpediaEntry
        {
            Id = dto.Id ?? string.Empty,
            UniqueName = dto.UniqueName ?? string.Empty,
            Title = dto.Title ?? string.Empty,
            Content = dto.Content,
            UpdatedAt = dto.UpdatedAt ?? string.Empty,
        }).ToList();
    }

    /// <inheritdoc />
    public async Task<List<TanahpediaEntry>> GetRecentEntriesAsync(int limit, CancellationToken cancellationToken)
    {
        var data = await QueryAsync<RecentEntriesResponse>(@"
            query TanahpediaRecentEntries($limit: Int) {
                tanahpediaRecentEntries(limit: $limit) {
                    id
                    uniqueName
                    title
                    updatedAt
                }
            }",
            "TanahpediaRecentEntries",
            new { limit },
            cancellationToken);

        return (data?.TanahpediaEntries ?? []).Select(dto => new TanahpediaEntry
        {
            Id = dto.Id ?? string.Empty,
            UniqueName = dto.UniqueName ?? string.Empty,
            Title = dto.Title ?? string.Empty,
            Content = dto.Content,
            UpdatedAt = dto.UpdatedAt ?? string.Empty,
        }).ToList();
    }

    /// <inheritdoc />
    public async Task<TanahpediaEntryDetail?> GetEntryDetailAsync(string uniqueName, CancellationToken cancellationToken)
    {
        var data = await QueryAsync<EntryDetailResponse>(@"
            query TanahpediaEntry($uniqueName: String!) {
                tanahpediaEntry(uniqueName: $uniqueName) {
                    id
                    uniqueName
                    title
                    content
                    updatedAt
                    entities {
                        id
                        entityId
                        entityType
                        entityName
                    }
                    occurrences {
                        perekId
                        pasukNumber
                        segmentStart
                        segmentEnd
                    }
                }
            }",
            "TanahpediaEntry",
            new { uniqueName },
            cancellationToken);

        var dto = data?.TanahpediaEntry;
        if (dto == null)
        {
            return null;
        }

        return new TanahpediaEntryDetail
        {
            Id = dto.Id ?? string.Empty,
            UniqueName = dto.UniqueName ?? string.Empty,
            Title = dto.Title ?? string.Empty,
            Content = dto.Content,
            UpdatedAt = dto.UpdatedAt ?? string.Empty,
            Entities = (dto.Entities ?? []).Select(e => new TanahpediaLinkedEntity
            {
                Id = e.Id ?? string.Empty,
                EntityId = e.EntityId ?? string.Empty,
                EntityType = e.EntityType ?? string.Empty,
                EntityName = e.EntityName ?? string.Empty,
            }).ToList(),
            Occurrences = (dto.Occurrences ?? []).Select(o => new TanahpediaEntryOccurrence
            {
                PerekId = o.PerekId,
                PasukNumber = o.PasukNumber,
                SegmentStart = o.SegmentStart,
                SegmentEnd = o.SegmentEnd,
            }).ToList(),
        };
    }

    /// <inheritdoc />
    public async Task<List<TanahpediaSynonymTarget>> GetSynonymTargetsAsync(string name, CancellationToken cancellationToken)
    {
        var data = await QueryAsync<SynonymTargetsResponse>(@"
            query TanahpediaSynonymTargets($name: String!) {
                tanahpediaSynonymTargets(name: $name) {
                    entryId
                    uniqueName
                    title
                    label
                }
            }",
            "TanahpediaSynonymTargets",
            new { name },
            cancellationToken);

        return (data?.TanahpediaSynonymTargets ?? []).Select(dto => new TanahpediaSynonymTarget
        {
            EntryId = dto.EntryId ?? string.Empty,
            UniqueName = dto.UniqueName ?? string.Empty,
            Title = dto.Title ?? string.Empty,
            Label = dto.Label,
        }).ToList();
    }

    /// <inheritdoc />
    public async Task<List<TanahpediaCategoryCount>> GetCategoryCountsAsync(CancellationToken cancellationToken)
    {
        var data = await QueryAsync<CategoryCountsResponse>(@"
            query TanahpediaCategoryCounts {
                tanahpediaCategoryCounts {
                    category
                    count
                }
            }",
            "TanahpediaCategoryCounts",
            null,
            cancellationToken);

        return (data?.TanahpediaCategoryCounts ?? []).Select(dto => new TanahpediaCategoryCount
        {
            Category = dto.Category ?? string.Empty,
            Count = dto.Count,
        }).ToList();
    }

    /// <inheritdoc />
    public async Task<List<TanahpediaEntityWithEntries>> GetEntitiesWithEntriesAsync(string entityType, string? sub, CancellationToken cancellationToken)
    {
        var data = await QueryAsync<EntitiesResponse>(@"
            query TanahpediaEntities($entityType: String!, $sub: String) {
                tanahpediaEntities(entityType: $entityType, sub: $sub) {
                    entityId
                    entityType
                    entityName
                    linkedEntries {
                        id
                        uniqueName
                        title
                    }
                }
            }",
            "TanahpediaEntities",
            new { entityType, sub },
            cancellationToken);

        return (data?.TanahpediaEntities ?? []).Select(MapEntityWithEntries).ToList();
    }

    /// <inheritdoc />
    public async Task<List<TanahpediaEntityWithEntries>> GetTodayEntitiesAsync(int hebrewMonth, int hebrewDay, CancellationToken cancellationToken)
    {
        var data = await QueryAsync<TodayEntitiesResponse>(@"
            query TanahpediaTodayEntities($hebrewMonth: Int!, $hebrewDay: Int!) {
                tanahpediaTodayEntities(hebrewMonth: $hebrewMonth, hebrewDay: $hebrewDay) {
                    entityId
                    entityType
                    entityName
                    linkedEntries {
                        id
                        uniqueName
                        title
                    }
                }
            }",
            "TanahpediaTodayEntities",
            new { hebrewMonth, hebrewDay },
            cancellationToken);

        return (data?.TanahpediaTodayEntities ?? []).Select(MapEntityWithEntries).ToList();
    }

    /// <inheritdoc />
    public async Task<TanahpediaCategoryHomepage?> GetCategoryHomepageAsync(string entityType, CancellationToken cancellationToken)
    {
        var data = await QueryAsync<CategoryHomepageResponse>(@"
            query TanahpediaCategoryHomepage($entityType: String!) {
                tanahpediaCategoryHomepage(entityType: $entityType) {
                    entityType
                    layoutType
                    content
                }
            }",
            "TanahpediaCategoryHomepage",
            new { entityType },
            cancellationToken);

        var dto = data?.TanahpediaCategoryHomepage;
        if (dto == null)
        {
            return null;
        }

        return new TanahpediaCategoryHomepage
        {
            EntityType = dto.EntityType ?? string.Empty,
            LayoutType = dto.LayoutType ?? string.Empty,
            Content = dto.Content,
        };
    }

    private static TanahpediaEntityWithEntries MapEntityWithEntries(EntityWithEntriesDto dto) => new()
    {
        EntityId = dto.EntityId ?? string.Empty,
        EntityType = dto.EntityType ?? string.Empty,
        EntityName = dto.EntityName ?? string.Empty,
        LinkedEntries = (dto.LinkedEntries ?? []).Select(e => new TanahpediaEntryStub
        {
            Id = e.Id ?? string.Empty,
            UniqueName = e.UniqueName ?? string.Empty,
            Title = e.Title ?? string.Empty,
        }).ToList(),
    };

    #region DTOs for GraphQL responses

    // JsonProperty attributes are required to prevent IL trimming in Release
    // builds — these members are only accessed via JSON deserialization
    // reflection, so the trimmer would strip them. See #1142 for details.

    private class EntriesResponse
    {
        [Newtonsoft.Json.JsonProperty("tanahpediaEntries")]
        public List<EntryDto>? TanahpediaEntries { get; set; }
    }

    private class RecentEntriesResponse
    {
        [Newtonsoft.Json.JsonProperty("tanahpediaRecentEntries")]
        public List<EntryDto>? TanahpediaEntries { get; set; }
    }

    private class EntryDto
    {
        [Newtonsoft.Json.JsonProperty("id")]
        public string? Id { get; set; }
        [Newtonsoft.Json.JsonProperty("uniqueName")]
        public string? UniqueName { get; set; }
        [Newtonsoft.Json.JsonProperty("title")]
        public string? Title { get; set; }
        [Newtonsoft.Json.JsonProperty("content")]
        public string? Content { get; set; }
        [Newtonsoft.Json.JsonProperty("updatedAt")]
        public string? UpdatedAt { get; set; }
    }

    private class EntryDetailResponse
    {
        [Newtonsoft.Json.JsonProperty("tanahpediaEntry")]
        public EntryDetailDto? TanahpediaEntry { get; set; }
    }

    private class EntryDetailDto : EntryDto
    {
        [Newtonsoft.Json.JsonProperty("entities")]
        public List<LinkedEntityDto>? Entities { get; set; }
        [Newtonsoft.Json.JsonProperty("occurrences")]
        public List<OccurrenceDto>? Occurrences { get; set; }
    }

    private class LinkedEntityDto
    {
        [Newtonsoft.Json.JsonProperty("id")]
        public string? Id { get; set; }
        [Newtonsoft.Json.JsonProperty("entityId")]
        public string? EntityId { get; set; }
        [Newtonsoft.Json.JsonProperty("entityType")]
        public string? EntityType { get; set; }
        [Newtonsoft.Json.JsonProperty("entityName")]
        public string? EntityName { get; set; }
    }

    private class OccurrenceDto
    {
        [Newtonsoft.Json.JsonProperty("perekId")]
        public int PerekId { get; set; }
        [Newtonsoft.Json.JsonProperty("pasukNumber")]
        public int PasukNumber { get; set; }
        [Newtonsoft.Json.JsonProperty("segmentStart")]
        public int? SegmentStart { get; set; }
        [Newtonsoft.Json.JsonProperty("segmentEnd")]
        public int? SegmentEnd { get; set; }
    }

    private class SynonymTargetsResponse
    {
        [Newtonsoft.Json.JsonProperty("tanahpediaSynonymTargets")]
        public List<SynonymTargetDto>? TanahpediaSynonymTargets { get; set; }
    }

    private class SynonymTargetDto
    {
        [Newtonsoft.Json.JsonProperty("entryId")]
        public string? EntryId { get; set; }
        [Newtonsoft.Json.JsonProperty("uniqueName")]
        public string? UniqueName { get; set; }
        [Newtonsoft.Json.JsonProperty("title")]
        public string? Title { get; set; }
        [Newtonsoft.Json.JsonProperty("label")]
        public string? Label { get; set; }
    }

    private class CategoryCountsResponse
    {
        [Newtonsoft.Json.JsonProperty("tanahpediaCategoryCounts")]
        public List<CategoryCountDto>? TanahpediaCategoryCounts { get; set; }
    }

    private class CategoryCountDto
    {
        [Newtonsoft.Json.JsonProperty("category")]
        public string? Category { get; set; }
        [Newtonsoft.Json.JsonProperty("count")]
        public int Count { get; set; }
    }

    private class EntitiesResponse
    {
        [Newtonsoft.Json.JsonProperty("tanahpediaEntities")]
        public List<EntityWithEntriesDto>? TanahpediaEntities { get; set; }
    }

    private class TodayEntitiesResponse
    {
        [Newtonsoft.Json.JsonProperty("tanahpediaTodayEntities")]
        public List<EntityWithEntriesDto>? TanahpediaTodayEntities { get; set; }
    }

    private class EntityWithEntriesDto
    {
        [Newtonsoft.Json.JsonProperty("entityId")]
        public string? EntityId { get; set; }
        [Newtonsoft.Json.JsonProperty("entityType")]
        public string? EntityType { get; set; }
        [Newtonsoft.Json.JsonProperty("entityName")]
        public string? EntityName { get; set; }
        [Newtonsoft.Json.JsonProperty("linkedEntries")]
        public List<EntryStubDto>? LinkedEntries { get; set; }
    }

    private class EntryStubDto
    {
        [Newtonsoft.Json.JsonProperty("id")]
        public string? Id { get; set; }
        [Newtonsoft.Json.JsonProperty("uniqueName")]
        public string? UniqueName { get; set; }
        [Newtonsoft.Json.JsonProperty("title")]
        public string? Title { get; set; }
    }

    private class CategoryHomepageResponse
    {
        [Newtonsoft.Json.JsonProperty("tanahpediaCategoryHomepage")]
        public CategoryHomepageDto? TanahpediaCategoryHomepage { get; set; }
    }

    private class CategoryHomepageDto
    {
        [Newtonsoft.Json.JsonProperty("entityType")]
        public string? EntityType { get; set; }
        [Newtonsoft.Json.JsonProperty("layoutType")]
        public string? LayoutType { get; set; }
        [Newtonsoft.Json.JsonProperty("content")]
        public string? Content { get; set; }
    }

    #endregion
}
