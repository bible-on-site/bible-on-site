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

    /// <summary>API's accepted range for `searchTanahpediaEntries(limit:)`.</summary>
    private const int MaxSearchLimit = 50;

    /// <summary>Remote search budget — matches ArticleService's search deadline.</summary>
    private static readonly TimeSpan DefaultSearchTimeout = TimeSpan.FromSeconds(8);

    /// <summary>Singleton instance of the TanahpediaService.</summary>
    public static TanahpediaService Instance => _instance.Value;

    private readonly TimeSpan _searchTimeout = DefaultSearchTimeout;

    private TanahpediaService()
    {
    }

    public TanahpediaService(GraphQLHttpClient client) : base(client)
    {
    }

    internal TanahpediaService(GraphQLHttpClient client, TimeSpan searchTimeout) : base(client)
    {
        _searchTimeout = searchTimeout;
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
    public async Task<List<TanahpediaSearchHit>> SearchEntriesAsync(string phrase, int limit, CancellationToken cancellationToken)
    {
        // The API accepts 1-50 and rejects out-of-range values — clamp here so
        // the documented contract holds for every caller.
        limit = Math.Clamp(limit, 1, MaxSearchLimit);
        using var timeoutSource = new CancellationTokenSource(_searchTimeout);
        using var linked = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken, timeoutSource.Token);
        try
        {
            var data = await QueryAsync<SearchHitsResponse>(@"
                query SearchTanahpediaEntries($phrase: String!, $limit: Int) {
                    searchTanahpediaEntries(phrase: $phrase, limit: $limit) {
                        id
                        uniqueName
                        title
                        excerpt
                        score
                    }
                }",
                "SearchTanahpediaEntries",
                new { phrase, limit },
                linked.Token);

            return (data?.SearchTanahpediaEntries ?? []).Select(dto => new TanahpediaSearchHit
            {
                Id = dto.Id ?? string.Empty,
                UniqueName = dto.UniqueName ?? string.Empty,
                Title = dto.Title ?? string.Empty,
                Excerpt = dto.Excerpt ?? string.Empty,
                Score = dto.Score,
            }).ToList();
        }
        catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested)
        {
            // Timeout source fired — translate to a TimeoutException so the
            // caller can surface the availability note instead of hanging on
            // the transport timeout (same contract as article search).
            throw new TimeoutException("Tanahpedia search timed out");
        }
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

    /// <inheritdoc />
    public async Task<TanahpediaPersonFamily?> GetPersonFamilyAsync(string entityId, CancellationToken cancellationToken)
    {
        var data = await QueryAsync<PersonFamilyResponse>(@"
            query TanahpediaPersonFamily($entityId: String!) {
                tanahpediaPersonFamily(entityId: $entityId) {
                    focalPersonId
                    focalEntityId
                    focalDisplayName
                    focalSex
                    focalBirthYyyymmdd
                    parents { related { personId entityId displayName entryUniqueName entryTitle sex } parentRole relationshipType altGroupId sourceCitation }
                    children { related { personId entityId displayName entryUniqueName entryTitle sex } parentRole relationshipType altGroupId sourceCitation birthOrder coParentEntityId coParentDisplayName coParentUnionOrder }
                    spouses { related { personId entityId displayName entryUniqueName entryTitle sex } unionType unionOrder altGroupId sourceCitation personSourceCitation unionEndReason unionStartDate unionEndDate }
                    siblings { personId entityId displayName entryUniqueName entryTitle sex birthDateYyyymmdd sourceCitation }
                }
            }",
            "TanahpediaPersonFamily",
            new { entityId },
            cancellationToken);

        var dto = data?.TanahpediaPersonFamily;
        if (dto == null)
        {
            return null;
        }

        return new TanahpediaPersonFamily
        {
            FocalPersonId = dto.FocalPersonId ?? string.Empty,
            FocalEntityId = dto.FocalEntityId ?? string.Empty,
            FocalDisplayName = dto.FocalDisplayName ?? string.Empty,
            FocalSex = dto.FocalSex,
            FocalBirthYyyymmdd = dto.FocalBirthYyyymmdd,
            Parents = (dto.Parents ?? []).Select(e => new TanahpediaFamilyParentEdge
            {
                Related = MapRelatedPerson(e.Related),
                ParentRole = e.ParentRole ?? string.Empty,
                RelationshipType = e.RelationshipType ?? string.Empty,
                AltGroupId = e.AltGroupId,
                SourceCitation = e.SourceCitation,
            }).ToList(),
            Children = (dto.Children ?? []).Select(e => new TanahpediaFamilyChildEdge
            {
                Related = MapRelatedPerson(e.Related),
                ParentRole = e.ParentRole ?? string.Empty,
                RelationshipType = e.RelationshipType ?? string.Empty,
                AltGroupId = e.AltGroupId,
                SourceCitation = e.SourceCitation,
                BirthOrder = e.BirthOrder,
                CoParentEntityId = e.CoParentEntityId,
                CoParentDisplayName = e.CoParentDisplayName,
                CoParentUnionOrder = e.CoParentUnionOrder,
            }).ToList(),
            Spouses = (dto.Spouses ?? []).Select(e => new TanahpediaFamilySpouseEdge
            {
                Related = MapRelatedPerson(e.Related),
                UnionType = e.UnionType ?? string.Empty,
                UnionOrder = e.UnionOrder,
                AltGroupId = e.AltGroupId,
                SourceCitation = e.SourceCitation,
                PersonSourceCitation = e.PersonSourceCitation,
                UnionEndReason = e.UnionEndReason,
                UnionStartDate = e.UnionStartDate,
                UnionEndDate = e.UnionEndDate,
            }).ToList(),
            Siblings = (dto.Siblings ?? []).Select(s => new TanahpediaFamilySibling
            {
                PersonId = s.PersonId ?? string.Empty,
                EntityId = s.EntityId ?? string.Empty,
                DisplayName = s.DisplayName ?? string.Empty,
                EntryUniqueName = s.EntryUniqueName,
                EntryTitle = s.EntryTitle,
                Sex = s.Sex,
                BirthDateYyyymmdd = s.BirthDateYyyymmdd,
                SourceCitation = s.SourceCitation,
            }).ToList(),
        };
    }

    /// <inheritdoc />
    public async Task<List<TanahpediaPlaceMarker>> GetPlaceMarkersAsync(string? entryId, CancellationToken cancellationToken)
    {
        var data = await QueryAsync<PlaceMarkersResponse>(@"
            query TanahpediaPlaceMarkers($entryId: String) {
                tanahpediaPlaceMarkers(entryId: $entryId) {
                    placeId
                    placeName
                    modernName
                    lat
                    lng
                    entryUniqueName
                }
            }",
            "TanahpediaPlaceMarkers",
            new { entryId },
            cancellationToken);

        return (data?.TanahpediaPlaceMarkers ?? []).Select(dto => new TanahpediaPlaceMarker
        {
            PlaceId = dto.PlaceId ?? string.Empty,
            PlaceName = dto.PlaceName ?? string.Empty,
            ModernName = dto.ModernName,
            Lat = dto.Lat,
            Lng = dto.Lng,
            EntryUniqueName = dto.EntryUniqueName,
        }).ToList();
    }

    private static TanahpediaFamilyPerson MapRelatedPerson(RelatedPersonDto? dto) => new()
    {
        PersonId = dto?.PersonId ?? string.Empty,
        EntityId = dto?.EntityId ?? string.Empty,
        DisplayName = dto?.DisplayName ?? string.Empty,
        EntryUniqueName = dto?.EntryUniqueName,
        EntryTitle = dto?.EntryTitle,
        Sex = dto?.Sex,
    };

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

    private class SearchHitsResponse
    {
        [Newtonsoft.Json.JsonProperty("searchTanahpediaEntries")]
        public List<SearchHitDto>? SearchTanahpediaEntries { get; set; }
    }

    private class SearchHitDto
    {
        [Newtonsoft.Json.JsonProperty("id")]
        public string? Id { get; set; }
        [Newtonsoft.Json.JsonProperty("uniqueName")]
        public string? UniqueName { get; set; }
        [Newtonsoft.Json.JsonProperty("title")]
        public string? Title { get; set; }
        [Newtonsoft.Json.JsonProperty("excerpt")]
        public string? Excerpt { get; set; }
        [Newtonsoft.Json.JsonProperty("score")]
        public int Score { get; set; }
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

    private class PersonFamilyResponse
    {
        [Newtonsoft.Json.JsonProperty("tanahpediaPersonFamily")]
        public PersonFamilyDto? TanahpediaPersonFamily { get; set; }
    }

    private class PersonFamilyDto
    {
        [Newtonsoft.Json.JsonProperty("focalPersonId")]
        public string? FocalPersonId { get; set; }
        [Newtonsoft.Json.JsonProperty("focalEntityId")]
        public string? FocalEntityId { get; set; }
        [Newtonsoft.Json.JsonProperty("focalDisplayName")]
        public string? FocalDisplayName { get; set; }
        [Newtonsoft.Json.JsonProperty("focalSex")]
        public string? FocalSex { get; set; }
        [Newtonsoft.Json.JsonProperty("focalBirthYyyymmdd")]
        public int? FocalBirthYyyymmdd { get; set; }
        [Newtonsoft.Json.JsonProperty("parents")]
        public List<ParentEdgeDto>? Parents { get; set; }
        [Newtonsoft.Json.JsonProperty("children")]
        public List<ChildEdgeDto>? Children { get; set; }
        [Newtonsoft.Json.JsonProperty("spouses")]
        public List<SpouseEdgeDto>? Spouses { get; set; }
        [Newtonsoft.Json.JsonProperty("siblings")]
        public List<SiblingDto>? Siblings { get; set; }
    }

    private class RelatedPersonDto
    {
        [Newtonsoft.Json.JsonProperty("personId")]
        public string? PersonId { get; set; }
        [Newtonsoft.Json.JsonProperty("entityId")]
        public string? EntityId { get; set; }
        [Newtonsoft.Json.JsonProperty("displayName")]
        public string? DisplayName { get; set; }
        [Newtonsoft.Json.JsonProperty("entryUniqueName")]
        public string? EntryUniqueName { get; set; }
        [Newtonsoft.Json.JsonProperty("entryTitle")]
        public string? EntryTitle { get; set; }
        [Newtonsoft.Json.JsonProperty("sex")]
        public string? Sex { get; set; }
    }

    private class ParentEdgeDto
    {
        [Newtonsoft.Json.JsonProperty("related")]
        public RelatedPersonDto? Related { get; set; }
        [Newtonsoft.Json.JsonProperty("parentRole")]
        public string? ParentRole { get; set; }
        [Newtonsoft.Json.JsonProperty("relationshipType")]
        public string? RelationshipType { get; set; }
        [Newtonsoft.Json.JsonProperty("altGroupId")]
        public string? AltGroupId { get; set; }
        [Newtonsoft.Json.JsonProperty("sourceCitation")]
        public string? SourceCitation { get; set; }
    }

    private class ChildEdgeDto : ParentEdgeDto
    {
        [Newtonsoft.Json.JsonProperty("birthOrder")]
        public int? BirthOrder { get; set; }
        [Newtonsoft.Json.JsonProperty("coParentEntityId")]
        public string? CoParentEntityId { get; set; }
        [Newtonsoft.Json.JsonProperty("coParentDisplayName")]
        public string? CoParentDisplayName { get; set; }
        [Newtonsoft.Json.JsonProperty("coParentUnionOrder")]
        public int? CoParentUnionOrder { get; set; }
    }

    private class SpouseEdgeDto
    {
        [Newtonsoft.Json.JsonProperty("related")]
        public RelatedPersonDto? Related { get; set; }
        [Newtonsoft.Json.JsonProperty("unionType")]
        public string? UnionType { get; set; }
        [Newtonsoft.Json.JsonProperty("unionOrder")]
        public int? UnionOrder { get; set; }
        [Newtonsoft.Json.JsonProperty("altGroupId")]
        public string? AltGroupId { get; set; }
        [Newtonsoft.Json.JsonProperty("sourceCitation")]
        public string? SourceCitation { get; set; }
        [Newtonsoft.Json.JsonProperty("personSourceCitation")]
        public string? PersonSourceCitation { get; set; }
        [Newtonsoft.Json.JsonProperty("unionEndReason")]
        public string? UnionEndReason { get; set; }
        [Newtonsoft.Json.JsonProperty("unionStartDate")]
        public int? UnionStartDate { get; set; }
        [Newtonsoft.Json.JsonProperty("unionEndDate")]
        public int? UnionEndDate { get; set; }
    }

    private class SiblingDto : RelatedPersonDto
    {
        [Newtonsoft.Json.JsonProperty("birthDateYyyymmdd")]
        public int? BirthDateYyyymmdd { get; set; }
        [Newtonsoft.Json.JsonProperty("sourceCitation")]
        public string? SourceCitation { get; set; }
    }

    private class PlaceMarkersResponse
    {
        [Newtonsoft.Json.JsonProperty("tanahpediaPlaceMarkers")]
        public List<PlaceMarkerDto>? TanahpediaPlaceMarkers { get; set; }
    }

    private class PlaceMarkerDto
    {
        [Newtonsoft.Json.JsonProperty("placeId")]
        public string? PlaceId { get; set; }
        [Newtonsoft.Json.JsonProperty("placeName")]
        public string? PlaceName { get; set; }
        [Newtonsoft.Json.JsonProperty("modernName")]
        public string? ModernName { get; set; }
        [Newtonsoft.Json.JsonProperty("lat")]
        public double Lat { get; set; }
        [Newtonsoft.Json.JsonProperty("lng")]
        public double Lng { get; set; }
        [Newtonsoft.Json.JsonProperty("entryUniqueName")]
        public string? EntryUniqueName { get; set; }
    }

    #endregion
}
