using BibleOnSite.Models;
using BibleOnSite.Services;
using BibleOnSite.Tests.Support;

namespace BibleOnSite.Tests.Services;

public class DedicationServiceTests
{
    private static DedicationService CreateService(GraphQLTransport transport) =>
        new(transport.Client);

    [Fact]
    public async Task GetDedicationsAsync_maps_response()
    {
        var transport = new GraphQLTransport("""
            {
              "data": {
                "dedications": [
                  {
                    "id": 7,
                    "subject": "Fulano de Tal",
                    "purposes": ["Falecimento", "Em louvor a Deus"],
                    "expiresAt": "2026-12-31T23:59:59Z",
                    "scopes": [
                      {
                        "kind": "PEREK",
                        "perekIdLow": 17,
                        "perekIdHigh": 22,
                        "seferId": null,
                        "helekId": null,
                        "parashaId": null,
                        "articleId": null,
                        "entryId": null,
                        "expiresAt": null
                      },
                      {
                        "kind": "SEFER",
                        "perekIdLow": null,
                        "perekIdHigh": null,
                        "seferId": 1,
                        "helekId": null,
                        "parashaId": null,
                        "articleId": null,
                        "entryId": null,
                        "expiresAt": "2027-01-01T00:00:00Z"
                      }
                    ]
                  }
                ]
              }
            }
            """);
        var service = CreateService(transport);

        var dedications = await service.GetDedicationsAsync(
            new DedicationContext { PerekIds = [17] }, TestContext.Current.CancellationToken);

        dedications.Should().HaveCount(1);
        var dedication = dedications[0];
        dedication.Id.Should().Be(7);
        dedication.Subject.Should().Be("Fulano de Tal");
        dedication.Purposes.Should().Equal("Falecimento", "Em louvor a Deus");
        dedication.ExpiresAt.Should().Be("2026-12-31T23:59:59Z");
        dedication.Scopes.Should().HaveCount(2);
        dedication.Scopes[0].Kind.Should().Be("PEREK");
        dedication.Scopes[0].PerekIdLow.Should().Be(17);
        dedication.Scopes[0].PerekIdHigh.Should().Be(22);
        dedication.Scopes[1].Kind.Should().Be("SEFER");
        dedication.Scopes[1].SeferId.Should().Be(1);
        dedication.Scopes[1].ExpiresAt.Should().Be("2027-01-01T00:00:00Z");
        transport.Requests[0].Should().Contain("dedications");
        transport.Requests[0].Should().Contain("\"perekIds\":[17]");
    }

    [Fact]
    public async Task GetDedicationsAsync_serializes_full_context()
    {
        var transport = new GraphQLTransport("{\"data\":{\"dedications\":[]}}");
        var service = CreateService(transport);

        await service.GetDedicationsAsync(new DedicationContext
        {
            PerekIds = [1, 2],
            SeferIds = [5],
            HelekIds = [2],
            ParashaIds = [30],
            EntryIds = ["e1"],
            ArticleIds = [9],
            Masora = true,
        }, TestContext.Current.CancellationToken);

        var request = transport.Requests[0];
        request.Should().Contain("\"perekIds\":[1,2]");
        request.Should().Contain("\"seferIds\":[5]");
        request.Should().Contain("\"helekIds\":[2]");
        request.Should().Contain("\"parashaIds\":[30]");
        request.Should().Contain("\"entryIds\":[\"e1\"]");
        request.Should().Contain("\"articleIds\":[9]");
        request.Should().Contain("\"masora\":true");
    }

    [Fact]
    public async Task GetDedicationsAsync_empty_result_returns_empty_list()
    {
        var transport = new GraphQLTransport("{\"data\":{\"dedications\":[]}}");
        var service = CreateService(transport);

        var dedications = await service.GetDedicationsAsync(
            new DedicationContext { PerekIds = [999] }, TestContext.Current.CancellationToken);

        dedications.Should().BeEmpty();
    }

    [Fact]
    public async Task GetDedicationsAsync_null_data_returns_empty_list()
    {
        var transport = new GraphQLTransport("{\"data\":null}");
        var service = CreateService(transport);

        var dedications = await service.GetDedicationsAsync(
            new DedicationContext { PerekIds = [999] }, TestContext.Current.CancellationToken);

        dedications.Should().BeEmpty();
    }

    [Fact]
    public async Task GetDedicationsAsync_graphql_errors_throw()
    {
        var transport = new GraphQLTransport("{\"errors\":[{\"message\":\"field dedications does not exist\"}]}");
        var service = CreateService(transport);

        var act = () => service.GetDedicationsAsync(
            new DedicationContext { PerekIds = [1] }, TestContext.Current.CancellationToken);

        await act.Should().ThrowAsync<GraphQLException>();
    }

    [Theory]
    [InlineData("{\"data\":{}}")]
    [InlineData("{\"data\":{\"dedications\":null}}")]
    public async Task GetDedicationsAsync_missing_dedications_returns_empty_list(string json)
    {
        var service = CreateService(new GraphQLTransport(json));

        var dedications = await service.GetDedicationsAsync(new DedicationContext(), TestContext.Current.CancellationToken);

        dedications.Should().BeEmpty();
    }

    [Fact]
    public async Task GetDedicationsAsync_normalizes_nullable_response_fields()
    {
        var service = CreateService(new GraphQLTransport("""
            {"data":{"dedications":[
              {"id":1,"subject":null,"purposes":null,"scopes":null},
              {"id":2,"scopes":[{"kind":null}]}
            ]}}
            """));

        var dedications = await service.GetDedicationsAsync(new DedicationContext(), TestContext.Current.CancellationToken);

        dedications.Should().HaveCount(2);
        dedications[0].Subject.Should().BeEmpty();
        dedications[0].Purposes.Should().BeEmpty();
        dedications[0].Scopes.Should().BeEmpty();
        dedications[0].ExpiresAt.Should().BeNull();
        dedications[1].Scopes.Should().ContainSingle().Which.Kind.Should().BeEmpty();
    }

    [Fact]
    public async Task GetDedicationsAsync_preserves_each_non_perek_scope_identity()
    {
        var service = CreateService(new GraphQLTransport("""
            {"data":{"dedications":[{"id":1,"subject":"שרה","scopes":[
              {"kind":"HELEK","helekId":2},
              {"kind":"PARASHA","parashaId":30},
              {"kind":"ARTICLE","articleId":42},
              {"kind":"TANAHPEDIA_ENTRY","entryId":"entry-1"},
              {"kind":"MASORA"}
            ]}]}}
            """));

        var dedications = await service.GetDedicationsAsync(new DedicationContext(), TestContext.Current.CancellationToken);

        var scopes = dedications.Should().ContainSingle().Which.Scopes;
        scopes.Select(s => s.Kind).Should().Equal("HELEK", "PARASHA", "ARTICLE", "TANAHPEDIA_ENTRY", "MASORA");
        scopes[0].HelekId.Should().Be(2);
        scopes[1].ParashaId.Should().Be(30);
        scopes[2].ArticleId.Should().Be(42);
        scopes[3].EntryId.Should().Be("entry-1");
        scopes[4].PerekIdLow.Should().BeNull();
        scopes[4].PerekIdHigh.Should().BeNull();
        scopes[4].SeferId.Should().BeNull();
        scopes[4].HelekId.Should().BeNull();
        scopes[4].ParashaId.Should().BeNull();
        scopes[4].ArticleId.Should().BeNull();
        scopes[4].EntryId.Should().BeNull();
        scopes[4].ExpiresAt.Should().BeNull();
    }
}

public class DedicationFormatterTests
{
    [Fact]
    public void Format_subject_only()
    {
        var dedication = new Dedication { Subject = "Fulano de Tal" };

        DedicationFormatter.Format(dedication).Should().Be("מוקדש לFulano de Tal");
    }

    [Fact]
    public void Format_subject_with_purposes()
    {
        var dedication = new Dedication
        {
            Subject = "Fulano de Tal",
            Purposes = ["Falecimento", "Em louvor a Deus"],
        };

        DedicationFormatter.Format(dedication).Should().Be("מוקדש לFulano de Tal (Falecimento, Em louvor a Deus)");
    }

    [Fact]
    public void Format_blank_purposes_are_dropped()
    {
        var dedication = new Dedication
        {
            Subject = "Fulano de Tal",
            Purposes = ["Falecimento", "  ", ""],
        };

        DedicationFormatter.Format(dedication).Should().Be("מוקדש לFulano de Tal (Falecimento)");
    }

    [Fact]
    public void FormatAll_maps_every_dedication()
    {
        var dedications = new[]
        {
            new Dedication { Subject = "A" },
            new Dedication { Subject = "B", Purposes = ["P"] },
        };

        DedicationFormatter.FormatAll(dedications)
            .Should().Equal("מוקדש לA", "מוקדש לB (P)");
    }
}
