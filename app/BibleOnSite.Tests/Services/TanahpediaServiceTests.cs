using BibleOnSite.Models;
using BibleOnSite.Services;
using BibleOnSite.Tests.Support;
using GraphQL.Client.Http;

namespace BibleOnSite.Tests.Services;

public class TanahpediaServiceTests
{
    private static TanahpediaService CreateService(GraphQLTransport transport) =>
        new(transport.Client);

    [Fact]
    public async Task GetEntriesAsync_maps_entries()
    {
        var transport = new GraphQLTransport("""
            {
              "data": {
                "tanahpediaEntries": [
                  { "id": "e1", "uniqueName": "משה-רבנו", "title": "משה רבנו", "updatedAt": "2026-07-01T10:00:00" },
                  { "id": "e2", "uniqueName": "אברהם-אבינו", "title": "אברהם אבינו", "updatedAt": "2026-07-02T10:00:00" }
                ]
              }
            }
            """);
        var service = CreateService(transport);

        var entries = await service.GetEntriesAsync(50, 0, TestContext.Current.CancellationToken);

        entries.Should().HaveCount(2);
        entries[0].UniqueName.Should().Be("משה-רבנו");
        entries[1].Title.Should().Be("אברהם אבינו");
        transport.Requests[0].Should().Contain("tanahpediaEntries");
        transport.Requests[0].Should().Contain("\"limit\":50");
    }

    [Fact]
    public async Task GetRecentEntriesAsync_maps_entries()
    {
        var transport = new GraphQLTransport("""
            {
              "data": {
                "tanahpediaRecentEntries": [
                  { "id": "e3", "uniqueName": "דוד-המלך", "title": "דוד המלך", "updatedAt": "2026-07-03T10:00:00" }
                ]
              }
            }
            """);
        var service = CreateService(transport);

        var entries = await service.GetRecentEntriesAsync(5, TestContext.Current.CancellationToken);

        entries.Should().HaveCount(1);
        entries[0].Title.Should().Be("דוד המלך");
        entries[0].UniqueName.Should().Be("דוד-המלך");
        transport.Requests[0].Should().Contain("tanahpediaRecentEntries");
        transport.Requests[0].Should().Contain("\"limit\":5");
    }

    [Fact]
    public async Task GetEntryDetailAsync_maps_entities_and_occurrences()
    {
        var transport = new GraphQLTransport("""
            {
              "data": {
                "tanahpediaEntry": {
                  "id": "e1",
                  "uniqueName": "שמשון",
                  "title": "שמשון",
                  "content": "<p>שופט</p>",
                  "updatedAt": "2026-07-01T10:00:00",
                  "entities": [
                    { "id": "ee1", "entityId": "en1", "entityType": "PERSON", "entityName": "שמשון" }
                  ],
                  "occurrences": [
                    { "perekId": 250, "pasukNumber": 3, "segmentStart": null, "segmentEnd": null },
                    { "perekId": 251, "pasukNumber": 5, "segmentStart": 1, "segmentEnd": 2 }
                  ]
                }
              }
            }
            """);
        var service = CreateService(transport);

        var detail = await service.GetEntryDetailAsync("שמשון", TestContext.Current.CancellationToken);

        detail.Should().NotBeNull();
        detail!.Title.Should().Be("שמשון");
        detail.Content.Should().Be("<p>שופט</p>");
        detail.Entities.Should().ContainSingle()
            .Which.EntityType.Should().Be("PERSON");
        detail.Occurrences.Should().HaveCount(2);
        detail.Occurrences[0].PerekId.Should().Be(250);
        detail.Occurrences[0].SegmentStart.Should().BeNull();
        detail.Occurrences[1].SegmentEnd.Should().Be(2);
        transport.Requests[0].Should().Contain("tanahpediaEntry");
        transport.Requests[0].Should().Contain("uniqueName");
    }

    [Fact]
    public async Task GetEntryDetailAsync_returns_null_for_unknown_name()
    {
        var transport = new GraphQLTransport("""
            { "data": { "tanahpediaEntry": null } }
            """);
        var service = CreateService(transport);

        var detail = await service.GetEntryDetailAsync("no-such-entry", TestContext.Current.CancellationToken);

        detail.Should().BeNull();
    }

    [Fact]
    public async Task GetSynonymTargetsAsync_maps_targets_with_labels()
    {
        var transport = new GraphQLTransport("""
            {
              "data": {
                "tanahpediaSynonymTargets": [
                  { "entryId": "e1", "uniqueName": "דתן", "title": "דתן", "label": null },
                  { "entryId": "e2", "uniqueName": "דתן-ואבירם", "title": "דתן ואבירם", "label": "בני קרח" }
                ]
              }
            }
            """);
        var service = CreateService(transport);

        var targets = await service.GetSynonymTargetsAsync("דתן", TestContext.Current.CancellationToken);

        targets.Should().HaveCount(2);
        targets[0].Label.Should().BeNull();
        targets[1].Label.Should().Be("בני קרח");
        transport.Requests[0].Should().Contain("tanahpediaSynonymTargets");
    }

    [Fact]
    public async Task GetCategoryCountsAsync_maps_counts()
    {
        var transport = new GraphQLTransport("""
            {
              "data": {
                "tanahpediaCategoryCounts": [
                  { "category": "PERSON", "count": 42 },
                  { "category": "PLACE", "count": 7 }
                ]
              }
            }
            """);
        var service = CreateService(transport);

        var counts = await service.GetCategoryCountsAsync(TestContext.Current.CancellationToken);

        counts.Should().HaveCount(2);
        counts[0].Category.Should().Be("PERSON");
        counts[0].Count.Should().Be(42);
    }

    [Fact]
    public async Task GetEntitiesWithEntriesAsync_passes_sub_filter()
    {
        var transport = new GraphQLTransport("""
            {
              "data": {
                "tanahpediaEntities": [
                  {
                    "entityId": "en1",
                    "entityType": "PERSON",
                    "entityName": "יְהוֹשֻׁעַ",
                    "linkedEntries": [
                      { "id": "e1", "uniqueName": "יהושע-בן-נון", "title": "יהושע בן נון" }
                    ]
                  }
                ]
              }
            }
            """);
        var service = CreateService(transport);

        var entities = await service.GetEntitiesWithEntriesAsync("PERSON", "PROPHET", TestContext.Current.CancellationToken);

        entities.Should().ContainSingle();
        entities[0].EntityName.Should().Be("יְהוֹשֻׁעַ");
        entities[0].LinkedEntries.Should().ContainSingle()
            .Which.UniqueName.Should().Be("יהושע-בן-נון");
        transport.Requests[0].Should().Contain("\"entityType\":\"PERSON\"");
        transport.Requests[0].Should().Contain("\"sub\":\"PROPHET\"");
    }

    [Fact]
    public async Task GetTodayEntitiesAsync_maps_entities()
    {
        var transport = new GraphQLTransport("""
            {
              "data": {
                "tanahpediaTodayEntities": [
                  {
                    "entityId": "en1",
                    "entityType": "PERSON",
                    "entityName": "מתתיהו",
                    "linkedEntries": [
                      { "id": "e1", "uniqueName": "מתתיהו-החשמונאי", "title": "מתתיהו החשמונאי" }
                    ]
                  }
                ]
              }
            }
            """);
        var service = CreateService(transport);

        var entities = await service.GetTodayEntitiesAsync(9, 25, TestContext.Current.CancellationToken);

        entities.Should().ContainSingle();
        entities[0].LinkedEntries.Should().ContainSingle();
        transport.Requests[0].Should().Contain("\"hebrewMonth\":9");
        transport.Requests[0].Should().Contain("\"hebrewDay\":25");
    }

    [Fact]
    public async Task GetCategoryHomepageAsync_returns_null_when_unconfigured()
    {
        var transport = new GraphQLTransport("""
            { "data": { "tanahpediaCategoryHomepage": null } }
            """);
        var service = CreateService(transport);

        var homepage = await service.GetCategoryHomepageAsync("PLANT", TestContext.Current.CancellationToken);

        homepage.Should().BeNull();
    }

    [Fact]
    public async Task GetCategoryHomepageAsync_maps_configured_page()
    {
        var transport = new GraphQLTransport("""
            {
              "data": {
                "tanahpediaCategoryHomepage": {
                  "entityType": "PLACE",
                  "layoutType": "MAP",
                  "content": "<p>מפת המקומות</p>"
                }
              }
            }
            """);
        var service = CreateService(transport);

        var homepage = await service.GetCategoryHomepageAsync("PLACE", TestContext.Current.CancellationToken);

        homepage.Should().NotBeNull();
        homepage!.LayoutType.Should().Be("MAP");
        homepage.Content.Should().Be("<p>מפת המקומות</p>");
    }

    [Fact]
    public async Task GetEntriesAsync_throws_on_graphql_errors()
    {
        var transport = new GraphQLTransport("""
            {
              "errors": [ { "message": "database unavailable" } ],
              "data": null
            }
            """);
        var service = CreateService(transport);

        var act = () => service.GetEntriesAsync(50, 0, TestContext.Current.CancellationToken);

        await act.Should().ThrowAsync<GraphQLException>();
    }

    [Fact]
    public async Task GetEntriesAsync_returns_empty_when_data_missing()
    {
        var transport = new GraphQLTransport("""{ "data": null }""");
        var service = CreateService(transport);

        var entries = await service.GetEntriesAsync(50, 0, TestContext.Current.CancellationToken);

        entries.Should().BeEmpty();
    }

    [Fact]
    public async Task GetEntriesAsync_fills_null_dto_fields()
    {
        var transport = new GraphQLTransport("""
            {
              "data": {
                "tanahpediaEntries": [
                  { "id": null, "uniqueName": null, "title": null, "content": null, "updatedAt": null }
                ]
              }
            }
            """);
        var service = CreateService(transport);

        var entries = await service.GetEntriesAsync(50, 0, TestContext.Current.CancellationToken);

        entries.Should().ContainSingle().Which.Should().Match<TanahpediaEntry>(e =>
            e.Id == string.Empty && e.UniqueName == string.Empty &&
            e.Title == string.Empty && e.UpdatedAt == string.Empty);
    }

    [Fact]
    public async Task GetRecentEntriesAsync_returns_empty_when_data_missing()
    {
        var transport = new GraphQLTransport("""{ "data": null }""");
        var service = CreateService(transport);

        var entries = await service.GetRecentEntriesAsync(5, TestContext.Current.CancellationToken);

        entries.Should().BeEmpty();
    }

    [Fact]
    public async Task GetRecentEntriesAsync_fills_null_dto_fields()
    {
        var transport = new GraphQLTransport("""
            {
              "data": {
                "tanahpediaRecentEntries": [
                  { "id": null, "uniqueName": null, "title": null, "updatedAt": null }
                ]
              }
            }
            """);
        var service = CreateService(transport);

        var entries = await service.GetRecentEntriesAsync(5, TestContext.Current.CancellationToken);

        entries.Should().ContainSingle().Which.Title.Should().BeEmpty();
    }

    [Fact]
    public async Task GetEntryDetailAsync_fills_null_dto_fields()
    {
        var transport = new GraphQLTransport("""
            {
              "data": {
                "tanahpediaEntry": {
                  "id": null, "uniqueName": null, "title": null, "updatedAt": null,
                  "entities": [ { "id": null, "entityId": null, "entityType": null, "entityName": null } ],
                  "occurrences": null
                }
              }
            }
            """);
        var service = CreateService(transport);

        var detail = await service.GetEntryDetailAsync("x", TestContext.Current.CancellationToken);

        detail.Should().NotBeNull();
        detail!.UniqueName.Should().BeEmpty();
        detail.Entities.Should().ContainSingle().Which.EntityType.Should().BeEmpty();
        detail.Occurrences.Should().BeEmpty();
    }

    [Fact]
    public async Task GetEntryDetailAsync_defaults_null_collections()
    {
        var transport = new GraphQLTransport("""
            {
              "data": {
                "tanahpediaEntry": {
                  "id": "e1", "uniqueName": "x", "title": "x", "updatedAt": "2026-01-01",
                  "entities": null, "occurrences": null
                }
              }
            }
            """);
        var service = CreateService(transport);

        var detail = await service.GetEntryDetailAsync("x", TestContext.Current.CancellationToken);

        detail.Should().NotBeNull();
        detail!.Entities.Should().BeEmpty();
        detail.Occurrences.Should().BeEmpty();
    }

    [Fact]
    public async Task GetEntryDetailAsync_returns_null_when_data_or_entry_missing()
    {
        var service = CreateService(new GraphQLTransport("""{ "data": null }"""));
        (await service.GetEntryDetailAsync("x", TestContext.Current.CancellationToken))
            .Should().BeNull();

        service = CreateService(new GraphQLTransport("""{ "data": { "tanahpediaEntry": null } }"""));
        (await service.GetEntryDetailAsync("x", TestContext.Current.CancellationToken))
            .Should().BeNull();
    }

    [Fact]
    public async Task GetSynonymTargetsAsync_returns_empty_when_data_missing()
    {
        var transport = new GraphQLTransport("""{ "data": null }""");
        var service = CreateService(transport);

        var targets = await service.GetSynonymTargetsAsync("x", TestContext.Current.CancellationToken);

        targets.Should().BeEmpty();
    }

    [Fact]
    public async Task GetSynonymTargetsAsync_fills_null_dto_fields()
    {
        var transport = new GraphQLTransport("""
            {
              "data": {
                "tanahpediaSynonymTargets": [
                  { "entryId": null, "uniqueName": null, "title": null, "label": null }
                ]
              }
            }
            """);
        var service = CreateService(transport);

        var targets = await service.GetSynonymTargetsAsync("x", TestContext.Current.CancellationToken);

        targets.Should().ContainSingle().Which.Should().Match<TanahpediaSynonymTarget>(t =>
            t.EntryId == string.Empty && t.UniqueName == string.Empty &&
            t.Title == string.Empty && t.Label == null);
    }

    [Fact]
    public async Task GetCategoryCountsAsync_returns_empty_when_data_missing()
    {
        var transport = new GraphQLTransport("""{ "data": null }""");
        var service = CreateService(transport);

        var counts = await service.GetCategoryCountsAsync(TestContext.Current.CancellationToken);

        counts.Should().BeEmpty();
    }

    [Fact]
    public async Task GetCategoryCountsAsync_fills_null_category()
    {
        var transport = new GraphQLTransport("""
            {
              "data": {
                "tanahpediaCategoryCounts": [ { "category": null, "count": 3 } ]
              }
            }
            """);
        var service = CreateService(transport);

        var counts = await service.GetCategoryCountsAsync(TestContext.Current.CancellationToken);

        counts.Should().ContainSingle().Which.Category.Should().BeEmpty();
    }

    [Fact]
    public async Task GetEntitiesWithEntriesAsync_fills_null_dto_fields()
    {
        var transport = new GraphQLTransport("""
            {
              "data": {
                "tanahpediaEntities": [
                  {
                    "entityId": null, "entityType": null, "entityName": null,
                    "linkedEntries": [ { "id": null, "uniqueName": null, "title": null } ]
                  }
                ]
              }
            }
            """);
        var service = CreateService(transport);

        var entities = await service.GetEntitiesWithEntriesAsync("PERSON", null, TestContext.Current.CancellationToken);

        entities.Should().ContainSingle();
        entities[0].EntityType.Should().BeEmpty();
        entities[0].LinkedEntries.Should().ContainSingle().Which.Title.Should().BeEmpty();
    }

    [Fact]
    public async Task GetEntitiesWithEntriesAsync_returns_empty_when_data_missing()
    {
        var transport = new GraphQLTransport("""{ "data": null }""");
        var service = CreateService(transport);

        var entities = await service.GetEntitiesWithEntriesAsync("PERSON", null, TestContext.Current.CancellationToken);

        entities.Should().BeEmpty();
    }

    [Fact]
    public async Task GetEntitiesWithEntriesAsync_defaults_null_linked_entries()
    {
        var transport = new GraphQLTransport("""
            {
              "data": {
                "tanahpediaEntities": [
                  { "entityId": "e1", "entityType": "PERSON", "entityName": "דתן", "linkedEntries": null }
                ]
              }
            }
            """);
        var service = CreateService(transport);

        var entities = await service.GetEntitiesWithEntriesAsync("PERSON", null, TestContext.Current.CancellationToken);

        entities.Should().ContainSingle().Which.LinkedEntries.Should().BeEmpty();
    }

    [Fact]
    public async Task GetTodayEntitiesAsync_returns_empty_when_data_missing()
    {
        var transport = new GraphQLTransport("""{ "data": null }""");
        var service = CreateService(transport);

        var entities = await service.GetTodayEntitiesAsync(9, 25, TestContext.Current.CancellationToken);

        entities.Should().BeEmpty();
    }

    [Fact]
    public async Task GetCategoryHomepageAsync_returns_null_when_data_missing()
    {
        var transport = new GraphQLTransport("""{ "data": null }""");
        var service = CreateService(transport);

        var homepage = await service.GetCategoryHomepageAsync("PLACE", TestContext.Current.CancellationToken);

        homepage.Should().BeNull();
    }

    [Fact]
    public async Task GetCategoryHomepageAsync_fills_null_fields()
    {
        var transport = new GraphQLTransport("""
            {
              "data": {
                "tanahpediaCategoryHomepage": {
                  "entityType": null, "layoutType": null, "content": null
                }
              }
            }
            """);
        var service = CreateService(transport);

        var homepage = await service.GetCategoryHomepageAsync("PLACE", TestContext.Current.CancellationToken);

        homepage.Should().NotBeNull();
        homepage!.EntityType.Should().BeEmpty();
        homepage.LayoutType.Should().BeEmpty();
        homepage.Content.Should().BeNull();
    }

    [Fact]
    public async Task SearchEntriesAsync_returns_empty_for_null_data()
    {
        var transport = new GraphQLTransport("{\"data\":{\"searchTanahpediaEntries\":null}}");
        var service = CreateService(transport);

        var hits = await service.SearchEntriesAsync("תורה", 10, TestContext.Current.CancellationToken);

        hits.Should().BeEmpty();
    }

    [Fact]
    public async Task SearchEntriesAsync_translates_the_search_deadline_to_timeout()
    {
        var transport = new GraphQLTransport
        {
            Respond = async cancellationToken =>
            {
                await Task.Delay(Timeout.Infinite, cancellationToken);
                throw new InvalidOperationException("unreachable");
            }
        };
        var service = CreateService(transport);

        var act = () => service.SearchEntriesAsync("תורה", 10, TestContext.Current.CancellationToken);

        await act.Should().ThrowAsync<TimeoutException>().WithMessage("*timed out*");
    }

    [Fact]
    public async Task GetPersonFamilyAsync_maps_all_edge_kinds()
    {
        var transport = new GraphQLTransport("""
            {
              "data": {
                "tanahpediaPersonFamily": {
                  "focalPersonId": "p1",
                  "focalEntityId": "e-yaakov",
                  "focalDisplayName": "יעקב",
                  "focalSex": "MALE",
                  "focalBirthYyyymmdd": 21081215,
                  "parents": [
                    { "related": { "personId": "p-f", "entityId": "e-itzchak", "displayName": "יצחק",
                                   "entryUniqueName": "יצחק", "entryTitle": "יצחק אבינו", "sex": "MALE" },
                      "parentRole": "FATHER", "relationshipType": "BIOLOGICAL",
                      "altGroupId": null, "sourceCitation": "בראשית כה יט" }
                  ],
                  "children": [
                    { "related": { "personId": "p-y", "entityId": "e-yosef", "displayName": "יוסף",
                                   "entryUniqueName": null, "entryTitle": null, "sex": null },
                      "parentRole": "FATHER", "relationshipType": "BIOLOGICAL", "altGroupId": null,
                      "sourceCitation": null, "birthOrder": 11,
                      "coParentEntityId": "e-rachel", "coParentDisplayName": "רחל", "coParentUnionOrder": 2 }
                  ],
                  "spouses": [
                    { "related": { "personId": "p-r", "entityId": "e-rachel", "displayName": "רחל",
                                   "entryUniqueName": "רחל", "entryTitle": "רחל אמנו", "sex": "FEMALE" },
                      "unionType": "MARRIAGE", "unionOrder": 2, "altGroupId": null,
                      "sourceCitation": "בראשית כט לא", "personSourceCitation": null,
                      "unionEndReason": "DEATH", "unionStartDate": null, "unionEndDate": null }
                  ],
                  "siblings": [
                    { "personId": "p-esav", "entityId": "e-esav", "displayName": "עשו",
                      "entryUniqueName": null, "entryTitle": null, "sex": "MALE",
                      "birthDateYyyymmdd": null, "sourceCitation": "בראשית כה כה" }
                  ]
                }
              }
            }
            """);
        var service = CreateService(transport);

        var family = await service.GetPersonFamilyAsync("e-yaakov", TestContext.Current.CancellationToken);

        family.Should().NotBeNull();
        family!.FocalPersonId.Should().Be("p1");
        family.FocalSex.Should().Be("MALE");
        family.FocalBirthYyyymmdd.Should().Be(21081215);
        family.Parents.Should().ContainSingle();
        family.Parents[0].Related.DisplayName.Should().Be("יצחק");
        family.Parents[0].Related.EntryUniqueName.Should().Be("יצחק");
        family.Parents[0].ParentRole.Should().Be("FATHER");
        family.Parents[0].SourceCitation.Should().Be("בראשית כה יט");
        family.Children.Should().ContainSingle();
        family.Children[0].BirthOrder.Should().Be(11);
        family.Children[0].CoParentDisplayName.Should().Be("רחל");
        family.Spouses.Should().ContainSingle();
        family.Spouses[0].UnionType.Should().Be("MARRIAGE");
        family.Spouses[0].UnionEndReason.Should().Be("DEATH");
        family.Siblings.Should().ContainSingle();
        family.Siblings[0].DisplayName.Should().Be("עשו");
        family.Siblings[0].SourceCitation.Should().Be("בראשית כה כה");
        transport.Requests[0].Should().Contain("tanahpediaPersonFamily");
        transport.Requests[0].Should().Contain("e-yaakov");
    }

    [Fact]
    public async Task GetPersonFamilyAsync_returns_null_when_data_missing()
    {
        var transport = new GraphQLTransport("""{ "data": { "tanahpediaPersonFamily": null } }""");
        var service = CreateService(transport);

        var family = await service.GetPersonFamilyAsync("e1", TestContext.Current.CancellationToken);

        family.Should().BeNull();
    }

    [Fact]
    public async Task GetPersonFamilyAsync_defaults_null_lists()
    {
        var transport = new GraphQLTransport("""
            {
              "data": {
                "tanahpediaPersonFamily": {
                  "focalPersonId": "p1", "focalEntityId": "e1", "focalDisplayName": "אדם",
                  "focalSex": null, "focalBirthYyyymmdd": null,
                  "parents": null, "children": null, "spouses": null, "siblings": null
                }
              }
            }
            """);
        var service = CreateService(transport);

        var family = await service.GetPersonFamilyAsync("e1", TestContext.Current.CancellationToken);

        family.Should().NotBeNull();
        family!.Parents.Should().BeEmpty();
        family.Children.Should().BeEmpty();
        family.Spouses.Should().BeEmpty();
        family.Siblings.Should().BeEmpty();
    }

    [Fact]
    public async Task GetPlaceMarkersAsync_maps_markers()
    {
        var transport = new GraphQLTransport("""
            {
              "data": {
                "tanahpediaPlaceMarkers": [
                  { "placeId": "pi-1", "placeName": "ירושלים", "modernName": "Jerusalem",
                    "lat": 31.778, "lng": 35.235, "entryUniqueName": "ירושלים" },
                  { "placeId": "pi-2", "placeName": "שילה", "modernName": null,
                    "lat": 32.055, "lng": 35.289, "entryUniqueName": null }
                ]
              }
            }
            """);
        var service = CreateService(transport);

        var markers = await service.GetPlaceMarkersAsync(null, TestContext.Current.CancellationToken);

        markers.Should().HaveCount(2);
        markers[0].PlaceName.Should().Be("ירושלים");
        markers[0].Lat.Should().Be(31.778);
        markers[0].EntryUniqueName.Should().Be("ירושלים");
        markers[1].EntryUniqueName.Should().BeNull();
        transport.Requests[0].Should().Contain("tanahpediaPlaceMarkers");
    }

    [Fact]
    public async Task GetPlaceMarkersAsync_returns_empty_when_data_missing()
    {
        var transport = new GraphQLTransport("""{ "data": null }""");
        var service = CreateService(transport);

        var markers = await service.GetPlaceMarkersAsync("entry-1", TestContext.Current.CancellationToken);

        markers.Should().BeEmpty();
    }

    [Fact]
    public void EntryReadingMetricDto_ToModel_maps_the_persisted_metric()
    {
        var dto = new TanahpediaService.EntryReadingMetricDto
        {
            WordCount = 210,
            EstimatedSeconds = 58,
            WordsPerMinute = 220,
            CalcVersion = 1,
            SourceHash = "e".PadLeft(64, 'e'),
        };

        var metric = dto.ToModel();

        metric.WordCount.Should().Be(210);
        metric.EstimatedSeconds.Should().Be(58);
        metric.WordsPerMinute.Should().Be(220);
        metric.SourceHash.Should().HaveLength(64);
    }

    [Fact]
    public void EntryReadingMetricDto_ToModel_defaults_a_missing_source_hash()
    {
        var dto = new TanahpediaService.EntryReadingMetricDto
        {
            WordCount = 210,
            EstimatedSeconds = 58,
            WordsPerMinute = 220,
            CalcVersion = 1,
            SourceHash = null,
        };

        var metric = dto.ToModel();

        metric.SourceHash.Should().BeEmpty();
    }
}
