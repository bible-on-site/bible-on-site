using BibleOnSite.Models;
using System.Text.Json.Serialization;
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
            new Dictionary<string, object?> { ["limit"] = limit, ["offset"] = offset },
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
            new Dictionary<string, object?> { ["limit"] = limit },
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
            new Dictionary<string, object?> { ["uniqueName"] = uniqueName },
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
        using var timeoutSource = new CancellationTokenSource(DefaultSearchTimeout);
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
                new Dictionary<string, object?> { ["phrase"] = phrase, ["limit"] = limit },
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
            new Dictionary<string, object?> { ["name"] = name },
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
            new Dictionary<string, object?> { ["entityType"] = entityType, ["sub"] = sub },
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
            new Dictionary<string, object?> { ["hebrewMonth"] = hebrewMonth, ["hebrewDay"] = hebrewDay },
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
            new Dictionary<string, object?> { ["entityType"] = entityType },
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
            new Dictionary<string, object?> { ["entityId"] = entityId },
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
            new Dictionary<string, object?> { ["entryId"] = entryId },
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

    // GraphQLJsonContext (source-generated) references these members statically,
    // so the trimmer keeps them in Release builds (#1142).

    internal class EntriesResponse
    {
        [JsonPropertyName("tanahpediaEntries")]
        public List<EntryDto>? TanahpediaEntries { get; set; }
    }

    internal class RecentEntriesResponse
    {
        [JsonPropertyName("tanahpediaRecentEntries")]
        public List<EntryDto>? TanahpediaEntries { get; set; }
    }

    internal class EntryDto
    {
        [JsonPropertyName("id")]
        public string? Id { get; set; }
        [JsonPropertyName("uniqueName")]
        public string? UniqueName { get; set; }
        [JsonPropertyName("title")]
        public string? Title { get; set; }
        [JsonPropertyName("content")]
        public string? Content { get; set; }
        [JsonPropertyName("updatedAt")]
        public string? UpdatedAt { get; set; }
    }

    internal class EntryDetailResponse
    {
        [JsonPropertyName("tanahpediaEntry")]
        public EntryDetailDto? TanahpediaEntry { get; set; }
    }

    internal class EntryDetailDto : EntryDto
    {
        [JsonPropertyName("entities")]
        public List<LinkedEntityDto>? Entities { get; set; }
        [JsonPropertyName("occurrences")]
        public List<OccurrenceDto>? Occurrences { get; set; }
    }

    internal class LinkedEntityDto
    {
        [JsonPropertyName("id")]
        public string? Id { get; set; }
        [JsonPropertyName("entityId")]
        public string? EntityId { get; set; }
        [JsonPropertyName("entityType")]
        public string? EntityType { get; set; }
        [JsonPropertyName("entityName")]
        public string? EntityName { get; set; }
    }

    internal class OccurrenceDto
    {
        [JsonPropertyName("perekId")]
        public int PerekId { get; set; }
        [JsonPropertyName("pasukNumber")]
        public int PasukNumber { get; set; }
        [JsonPropertyName("segmentStart")]
        public int? SegmentStart { get; set; }
        [JsonPropertyName("segmentEnd")]
        public int? SegmentEnd { get; set; }
    }

    internal class SearchHitsResponse
    {
        [JsonPropertyName("searchTanahpediaEntries")]
        public List<SearchHitDto>? SearchTanahpediaEntries { get; set; }
    }

    internal class SearchHitDto
    {
        [JsonPropertyName("id")]
        public string? Id { get; set; }
        [JsonPropertyName("uniqueName")]
        public string? UniqueName { get; set; }
        [JsonPropertyName("title")]
        public string? Title { get; set; }
        [JsonPropertyName("excerpt")]
        public string? Excerpt { get; set; }
        [JsonPropertyName("score")]
        public int Score { get; set; }
    }

    internal class SynonymTargetsResponse
    {
        [JsonPropertyName("tanahpediaSynonymTargets")]
        public List<SynonymTargetDto>? TanahpediaSynonymTargets { get; set; }
    }

    internal class SynonymTargetDto
    {
        [JsonPropertyName("entryId")]
        public string? EntryId { get; set; }
        [JsonPropertyName("uniqueName")]
        public string? UniqueName { get; set; }
        [JsonPropertyName("title")]
        public string? Title { get; set; }
        [JsonPropertyName("label")]
        public string? Label { get; set; }
    }

    internal class CategoryCountsResponse
    {
        [JsonPropertyName("tanahpediaCategoryCounts")]
        public List<CategoryCountDto>? TanahpediaCategoryCounts { get; set; }
    }

    internal class CategoryCountDto
    {
        [JsonPropertyName("category")]
        public string? Category { get; set; }
        [JsonPropertyName("count")]
        public int Count { get; set; }
    }

    internal class EntitiesResponse
    {
        [JsonPropertyName("tanahpediaEntities")]
        public List<EntityWithEntriesDto>? TanahpediaEntities { get; set; }
    }

    internal class TodayEntitiesResponse
    {
        [JsonPropertyName("tanahpediaTodayEntities")]
        public List<EntityWithEntriesDto>? TanahpediaTodayEntities { get; set; }
    }

    internal class EntityWithEntriesDto
    {
        [JsonPropertyName("entityId")]
        public string? EntityId { get; set; }
        [JsonPropertyName("entityType")]
        public string? EntityType { get; set; }
        [JsonPropertyName("entityName")]
        public string? EntityName { get; set; }
        [JsonPropertyName("linkedEntries")]
        public List<EntryStubDto>? LinkedEntries { get; set; }
    }

    internal class EntryStubDto
    {
        [JsonPropertyName("id")]
        public string? Id { get; set; }
        [JsonPropertyName("uniqueName")]
        public string? UniqueName { get; set; }
        [JsonPropertyName("title")]
        public string? Title { get; set; }
    }

    internal class CategoryHomepageResponse
    {
        [JsonPropertyName("tanahpediaCategoryHomepage")]
        public CategoryHomepageDto? TanahpediaCategoryHomepage { get; set; }
    }

    internal class CategoryHomepageDto
    {
        [JsonPropertyName("entityType")]
        public string? EntityType { get; set; }
        [JsonPropertyName("layoutType")]
        public string? LayoutType { get; set; }
        [JsonPropertyName("content")]
        public string? Content { get; set; }
    }

    internal class PersonFamilyResponse
    {
        [JsonPropertyName("tanahpediaPersonFamily")]
        public PersonFamilyDto? TanahpediaPersonFamily { get; set; }
    }

    internal class PersonFamilyDto
    {
        [JsonPropertyName("focalPersonId")]
        public string? FocalPersonId { get; set; }
        [JsonPropertyName("focalEntityId")]
        public string? FocalEntityId { get; set; }
        [JsonPropertyName("focalDisplayName")]
        public string? FocalDisplayName { get; set; }
        [JsonPropertyName("focalSex")]
        public string? FocalSex { get; set; }
        [JsonPropertyName("focalBirthYyyymmdd")]
        public int? FocalBirthYyyymmdd { get; set; }
        [JsonPropertyName("parents")]
        public List<ParentEdgeDto>? Parents { get; set; }
        [JsonPropertyName("children")]
        public List<ChildEdgeDto>? Children { get; set; }
        [JsonPropertyName("spouses")]
        public List<SpouseEdgeDto>? Spouses { get; set; }
        [JsonPropertyName("siblings")]
        public List<SiblingDto>? Siblings { get; set; }
    }

    internal class RelatedPersonDto
    {
        [JsonPropertyName("personId")]
        public string? PersonId { get; set; }
        [JsonPropertyName("entityId")]
        public string? EntityId { get; set; }
        [JsonPropertyName("displayName")]
        public string? DisplayName { get; set; }
        [JsonPropertyName("entryUniqueName")]
        public string? EntryUniqueName { get; set; }
        [JsonPropertyName("entryTitle")]
        public string? EntryTitle { get; set; }
        [JsonPropertyName("sex")]
        public string? Sex { get; set; }
    }

    internal class ParentEdgeDto
    {
        [JsonPropertyName("related")]
        public RelatedPersonDto? Related { get; set; }
        [JsonPropertyName("parentRole")]
        public string? ParentRole { get; set; }
        [JsonPropertyName("relationshipType")]
        public string? RelationshipType { get; set; }
        [JsonPropertyName("altGroupId")]
        public string? AltGroupId { get; set; }
        [JsonPropertyName("sourceCitation")]
        public string? SourceCitation { get; set; }
    }

    internal class ChildEdgeDto : ParentEdgeDto
    {
        [JsonPropertyName("birthOrder")]
        public int? BirthOrder { get; set; }
        [JsonPropertyName("coParentEntityId")]
        public string? CoParentEntityId { get; set; }
        [JsonPropertyName("coParentDisplayName")]
        public string? CoParentDisplayName { get; set; }
        [JsonPropertyName("coParentUnionOrder")]
        public int? CoParentUnionOrder { get; set; }
    }

    internal class SpouseEdgeDto
    {
        [JsonPropertyName("related")]
        public RelatedPersonDto? Related { get; set; }
        [JsonPropertyName("unionType")]
        public string? UnionType { get; set; }
        [JsonPropertyName("unionOrder")]
        public int? UnionOrder { get; set; }
        [JsonPropertyName("altGroupId")]
        public string? AltGroupId { get; set; }
        [JsonPropertyName("sourceCitation")]
        public string? SourceCitation { get; set; }
        [JsonPropertyName("personSourceCitation")]
        public string? PersonSourceCitation { get; set; }
        [JsonPropertyName("unionEndReason")]
        public string? UnionEndReason { get; set; }
        [JsonPropertyName("unionStartDate")]
        public int? UnionStartDate { get; set; }
        [JsonPropertyName("unionEndDate")]
        public int? UnionEndDate { get; set; }
    }

    internal class SiblingDto : RelatedPersonDto
    {
        [JsonPropertyName("birthDateYyyymmdd")]
        public int? BirthDateYyyymmdd { get; set; }
        [JsonPropertyName("sourceCitation")]
        public string? SourceCitation { get; set; }
    }

    internal class PlaceMarkersResponse
    {
        [JsonPropertyName("tanahpediaPlaceMarkers")]
        public List<PlaceMarkerDto>? TanahpediaPlaceMarkers { get; set; }
    }

    internal class PlaceMarkerDto
    {
        [JsonPropertyName("placeId")]
        public string? PlaceId { get; set; }
        [JsonPropertyName("placeName")]
        public string? PlaceName { get; set; }
        [JsonPropertyName("modernName")]
        public string? ModernName { get; set; }
        [JsonPropertyName("lat")]
        public double Lat { get; set; }
        [JsonPropertyName("lng")]
        public double Lng { get; set; }
        [JsonPropertyName("entryUniqueName")]
        public string? EntryUniqueName { get; set; }
    }

    #endregion
}
