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
}
