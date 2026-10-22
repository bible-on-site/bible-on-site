using System.Text;
using BibleOnSite.Services;
using GraphQL;

namespace BibleOnSite.Tests.Services;

/// <summary>
/// Deserializes response shapes captured from the production GraphQL API through the
/// app's System.Text.Json serializer. The test project disables reflection-based
/// serialization, so every case proves GraphQLJsonContext covers the type.
/// </summary>
public class GraphQLSerializationTests
{
    private static async Task<GraphQLResponse<T>> Deserialize<T>(string json)
    {
        using var stream = new MemoryStream(Encoding.UTF8.GetBytes(json));
        return await BaseGraphQLService.CreateSerializer()
            .DeserializeFromUtf8StreamAsync<T>(stream, TestContext.Current.CancellationToken);
    }

    public class Request
    {
        [Fact]
        public void SerializesOperationAndVariablesWithoutEscapingHebrew()
        {
            var json = BaseGraphQLService.CreateSerializer().SerializeToString(new GraphQLRequest
            {
                Query = "query Q($phrase: String!) { q }",
                OperationName = "Q",
                Variables = new Dictionary<string, object?> { ["phrase"] = "משה", ["limit"] = 10, ["sub"] = null }
            });

            json.Should().Contain("\"operationName\":\"Q\"")
                .And.Contain("\"variables\":{\"phrase\":\"משה\",\"limit\":10,\"sub\":null}");
        }
    }

    public class Starter
    {
        [Fact]
        public async Task ReadsAuthorsArticlesAndCounters()
        {
            var response = await Deserialize<StarterService.StarterResponse>("""
                {"data":{"starter":{
                  "authors":[{"id":1,"articlesCount":4,"details":"אב\"ד, רב העיר רמת גן","name":"הרב יעקב אריאל שליט\"א"}],
                  "articles":[{"id":594,"perekId":1,"authorId":7,"abstract":null,"name":"התורה - סיפורה של ארץ ישראל","priority":0}],
                  "perekArticlesCounters":[5,0,2]}}}
                """);

            var starter = response.Data!.Starter;
            starter.Authors.Should().ContainSingle().Which.Should().Be(
                new StarterService.AuthorData(1, 4, "אב\"ד, רב העיר רמת גן", "הרב יעקב אריאל שליט\"א"));
            starter.Articles.Should().ContainSingle().Which.Should().Be(
                new StarterService.ArticleData(594, 1, 7, null, "התורה - סיפורה של ארץ ישראל", 0));
            starter.PerekArticlesCounters.Should().Equal(5, 0, 2);
        }

        [Fact]
        public async Task NullIntoNonNullableNumberFails()
        {
            await FluentActions.Awaiting(() => Deserialize<StarterService.StarterResponse>(
                    """{"data":{"starter":{"authors":[{"id":null,"articlesCount":0,"details":"","name":""}],"articles":[],"perekArticlesCounters":[]}}}"""))
                .Should().ThrowAsync<System.Text.Json.JsonException>("Newtonsoft also rejected null for int");
        }
    }

    public class Articles
    {
        [Fact]
        public async Task ReadsArticlesByPerekId_WithCaseMismatchedAndUnknownFields()
        {
            var response = await Deserialize<ArticleService.ArticlesByPerekIdResponse>("""
                {"data":{"ArticlesByPerekId":[{"ID":594,"PerekId":1,"AUTHORID":7,"abstract":"<h1>התורה - סיפורה של ארץ ישראל</h1>","name":"התורה - סיפורה של ארץ ישראל","priority":0,"extra":true}]}}
                """);

            var article = response.Data!.ArticlesByPerekId.Should().ContainSingle().Subject;
            article.Id.Should().Be(594);
            article.PerekId.Should().Be(1);
            article.AuthorId.Should().Be(7);
            article.Abstract.Should().Be("<h1>התורה - סיפורה של ארץ ישראל</h1>");
            article.Name.Should().Be("התורה - סיפורה של ארץ ישראל");
            article.ArticleContent.Should().BeNull("missing fields keep their defaults");
        }

        [Fact]
        public async Task ReadsArticlesByAuthorId()
        {
            var response = await Deserialize<ArticleService.ArticlesByAuthorIdResponse>("""
                {"data":{"articlesByAuthorId":[{"id":134,"perekId":37,"authorId":1,"abstract":"<h1>שתי הנהגות מאוחדות</h1>","name":"שתי הנהגות מאוחדות","priority":3}]}}
                """);

            var article = response.Data!.ArticlesByAuthorId.Should().ContainSingle().Subject;
            (article.Id, article.PerekId, article.AuthorId, article.Priority).Should().Be((134, 37, 1, 3));
        }

        [Fact]
        public async Task ReadsArticleByIdWithContent()
        {
            var response = await Deserialize<ArticleService.ArticleByIdResponse>("""
                {"data":{"articleById":{"id":594,"perekId":1,"authorId":7,"abstract":"<h1>התורה</h1>","articleContent":"<h1 style=\"color: rgb(0, 0, 0);\">התורה</h1>","name":"התורה","priority":0}}}
                """);

            response.Data!.ArticleById!.ArticleContent.Should().Be("<h1 style=\"color: rgb(0, 0, 0);\">התורה</h1>");
        }

        [Fact]
        public async Task ReadsErrorsWithLocationsPathAndExtensions()
        {
            var response = await Deserialize<ArticleService.ArticleByIdResponse>("""
                {"data":null,"errors":[{"message":"Article Not Found","locations":[{"line":1,"column":19}],"path":["articleById"],"extensions":{"code":"NOT_FOUND","statusCode":404}}]}
                """);

            response.Data.Should().BeNull();
            var error = response.Errors.Should().ContainSingle().Subject;
            error.Message.Should().Be("Article Not Found");
            error.Locations.Should().ContainSingle().Which.Column.Should().Be(19u);
            error.Path.Should().Equal("articleById");
            error.Extensions!["code"].Should().Be("NOT_FOUND");
        }

        [Fact]
        public async Task ReadsSearchArticlesWithFloatScore()
        {
            var response = await Deserialize<ArticleService.SearchArticlesResponse>("""
                {"data":{"searchArticles":{"total":568,"hits":[{"articleId":499,"name":"יהושע בנעליו של משה רבנו","authorName":"הרב אבנר בוטוש שליט\"א","authorId":21,"perekId":188,"source":"יהושע א","excerpt":"יהושע בנעליו של משה רבנו…","score":0.5258857011795044}]}}}
                """);

            var page = response.Data!.SearchArticles!;
            page.Total.Should().Be(568);
            var hit = page.Hits.Should().ContainSingle().Subject;
            (hit.ArticleId, hit.AuthorId, hit.PerekId).Should().Be((499, 21, 188));
            hit.AuthorName.Should().Be("הרב אבנר בוטוש שליט\"א");
            hit.Source.Should().Be("יהושע א");
            hit.Excerpt.Should().Be("יהושע בנעליו של משה רבנו…");
            hit.Score.Should().BeApproximately(0.5258857f, 1e-6f);
        }
    }

    public class Tanahpedia
    {
        [Fact]
        public async Task ReadsEntriesAndRecentEntries()
        {
            const string entry = """{"id":"3721e426-d82b-4f47-aa03-790babf1bbbb","uniqueName":"אברהם","title":"אברהם","updatedAt":"2026-08-06 05:51:37"}""";
            var entries = await Deserialize<TanahpediaService.EntriesResponse>("{\"data\":{\"tanahpediaEntries\":[" + entry + "]}}");
            var recent = await Deserialize<TanahpediaService.RecentEntriesResponse>("{\"data\":{\"tanahpediaRecentEntries\":[" + entry + "]}}");

            foreach (var dto in new[] { entries.Data!.TanahpediaEntries!.Single(), recent.Data!.TanahpediaEntries!.Single() })
            {
                dto.Id.Should().Be("3721e426-d82b-4f47-aa03-790babf1bbbb");
                dto.UniqueName.Should().Be("אברהם");
                dto.Title.Should().Be("אברהם");
                dto.UpdatedAt.Should().Be("2026-08-06 05:51:37");
                dto.Content.Should().BeNull();
            }
        }

        [Fact]
        public async Task ReadsEntryDetailWithEntitiesAndOccurrences()
        {
            var response = await Deserialize<TanahpediaService.EntryDetailResponse>("""
                {"data":{"tanahpediaEntry":{"id":"623439fe-8376-11f1-a25d-0a326e67ac07","uniqueName":"משה-רבנו","title":"משה רבנו","content":"<p></p>","updatedAt":"2026-08-09 18:58:39",
                  "entities":[{"id":"623b1a9e-8376-11f1-a25d-0a326e67ac07","entityId":"621c0ed0-8376-11f1-a25d-0a326e67ac07","entityType":"PERSON","entityName":"משה רבנו"}],
                  "occurrences":[{"perekId":188,"pasukNumber":1,"segmentStart":3,"segmentEnd":3},{"perekId":189,"pasukNumber":2,"segmentStart":null,"segmentEnd":null}]}}}
                """);

            var detail = response.Data!.TanahpediaEntry!;
            detail.UniqueName.Should().Be("משה-רבנו");
            detail.Content.Should().Be("<p></p>");
            var entity = detail.Entities.Should().ContainSingle().Subject;
            (entity.Id, entity.EntityId, entity.EntityType, entity.EntityName).Should().Be(
                ("623b1a9e-8376-11f1-a25d-0a326e67ac07", "621c0ed0-8376-11f1-a25d-0a326e67ac07", "PERSON", "משה רבנו"));
            detail.Occurrences.Should().HaveCount(2);
            (detail.Occurrences![0].PerekId, detail.Occurrences[0].PasukNumber, detail.Occurrences[0].SegmentStart, detail.Occurrences[0].SegmentEnd)
                .Should().Be((188, 1, 3, 3));
            detail.Occurrences[1].SegmentStart.Should().BeNull();
        }

        [Fact]
        public async Task ReadsSearchHits()
        {
            var response = await Deserialize<TanahpediaService.SearchHitsResponse>("""
                {"data":{"searchTanahpediaEntries":[{"id":"623439fe-8376-11f1-a25d-0a326e67ac07","uniqueName":"משה-רבנו","title":"משה רבנו","excerpt":"…שנמשה מן המים…","score":200}]}}
                """);

            var hit = response.Data!.SearchTanahpediaEntries.Should().ContainSingle().Subject;
            (hit.Id, hit.UniqueName, hit.Title, hit.Excerpt, hit.Score).Should().Be(
                ("623439fe-8376-11f1-a25d-0a326e67ac07", "משה-רבנו", "משה רבנו", "…שנמשה מן המים…", 200));
        }

        [Fact]
        public async Task ReadsSynonymTargets()
        {
            var response = await Deserialize<TanahpediaService.SynonymTargetsResponse>("""
                {"data":{"tanahpediaSynonymTargets":[{"entryId":"3721e426-d82b-4f47-aa03-790babf1bbbb","uniqueName":"אברהם","title":"אברהם","label":null}]}}
                """);

            var target = response.Data!.TanahpediaSynonymTargets.Should().ContainSingle().Subject;
            (target.EntryId, target.UniqueName, target.Title, target.Label).Should().Be(
                ("3721e426-d82b-4f47-aa03-790babf1bbbb", "אברהם", "אברהם", (string?)null));
        }

        [Fact]
        public async Task ReadsCategoryCounts()
        {
            var response = await Deserialize<TanahpediaService.CategoryCountsResponse>("""
                {"data":{"tanahpediaCategoryCounts":[{"category":"PERSON","count":32},{"category":"PLACE","count":1}]}}
                """);

            response.Data!.TanahpediaCategoryCounts!.Select(c => (c.Category, c.Count))
                .Should().Equal(("PERSON", 32), ("PLACE", 1));
        }

        [Fact]
        public async Task ReadsEntitiesAndTodayEntities()
        {
            const string entity = """{"entityId":"0d1f7f2e-3a54-4b8e-9c67-a1b2c3d4e501","entityType":"PERSON","entityName":"אברהם","linkedEntries":[{"id":"3721e426-d82b-4f47-aa03-790babf1bbbb","uniqueName":"אברהם","title":"אברהם"}]}""";
            var all = await Deserialize<TanahpediaService.EntitiesResponse>("{\"data\":{\"tanahpediaEntities\":[" + entity + "]}}");
            var today = await Deserialize<TanahpediaService.TodayEntitiesResponse>("{\"data\":{\"tanahpediaTodayEntities\":[" + entity + "]}}");

            foreach (var dto in new[] { all.Data!.TanahpediaEntities!.Single(), today.Data!.TanahpediaTodayEntities!.Single() })
            {
                (dto.EntityId, dto.EntityType, dto.EntityName).Should().Be(("0d1f7f2e-3a54-4b8e-9c67-a1b2c3d4e501", "PERSON", "אברהם"));
                var linked = dto.LinkedEntries.Should().ContainSingle().Subject;
                (linked.Id, linked.UniqueName, linked.Title).Should().Be(("3721e426-d82b-4f47-aa03-790babf1bbbb", "אברהם", "אברהם"));
            }
        }

        [Fact]
        public async Task ReadsCategoryHomepage()
        {
            var response = await Deserialize<TanahpediaService.CategoryHomepageResponse>("""
                {"data":{"tanahpediaCategoryHomepage":{"entityType":"PERSON","layoutType":"GRID","content":null}}}
                """);

            var home = response.Data!.TanahpediaCategoryHomepage!;
            (home.EntityType, home.LayoutType, home.Content).Should().Be(("PERSON", "GRID", (string?)null));
        }

        [Fact]
        public async Task ReadsPersonFamily()
        {
            var response = await Deserialize<TanahpediaService.PersonFamilyResponse>("""
                {"data":{"tanahpediaPersonFamily":{"focalPersonId":"0d1f7f2e-3a54-4b8e-9c67-a1b2c3d4e502","focalEntityId":"0d1f7f2e-3a54-4b8e-9c67-a1b2c3d4e501","focalDisplayName":"אברהם","focalSex":"MALE","focalBirthYyyymmdd":null,
                  "parents":[{"related":{"personId":"9458dd10-43e8-4f09-b2b4-6a77c02e6779","entityId":"7aa083db-c77b-49a0-8bd6-80224a911013","displayName":"תרח","entryUniqueName":"תרח","entryTitle":"תרח","sex":"MALE"},"parentRole":"FATHER","relationshipType":"BIOLOGICAL","altGroupId":null,"sourceCitation":"בראשית יא כו"}],
                  "children":[{"related":{"personId":"067a4638-ac8a-4ca0-96d6-6c1ea4aed964","entityId":"535f510a-460a-49bc-9ef9-b63eb7a56f84","displayName":"יצחק","entryUniqueName":"יצחק","entryTitle":"יצחק","sex":"MALE"},"parentRole":"FATHER","relationshipType":"BIOLOGICAL","altGroupId":null,"sourceCitation":"בראשית כא ב-ג","birthOrder":2,"coParentEntityId":"0d1f7f2e-3a54-4b8e-9c67-a1b2c3d4e511","coParentDisplayName":"שרה","coParentUnionOrder":1}],
                  "spouses":[{"related":{"personId":"0d1f7f2e-3a54-4b8e-9c67-a1b2c3d4e512","entityId":"0d1f7f2e-3a54-4b8e-9c67-a1b2c3d4e511","displayName":"שרה","entryUniqueName":"שרה","entryTitle":"שרה","sex":"FEMALE"},"unionType":"MARRIAGE","unionOrder":1,"altGroupId":null,"sourceCitation":"בראשית יא כט","personSourceCitation":null,"unionEndReason":"DEATH","unionStartDate":null,"unionEndDate":21330000}],
                  "siblings":[{"personId":"p-nahor","entityId":"e-nahor","displayName":"נחור","entryUniqueName":null,"entryTitle":null,"sex":"MALE","birthDateYyyymmdd":19480000,"sourceCitation":"בראשית יא כו"}]}}}
                """);

            var family = response.Data!.TanahpediaPersonFamily!;
            (family.FocalPersonId, family.FocalEntityId, family.FocalDisplayName, family.FocalSex, family.FocalBirthYyyymmdd).Should().Be(
                ("0d1f7f2e-3a54-4b8e-9c67-a1b2c3d4e502", "0d1f7f2e-3a54-4b8e-9c67-a1b2c3d4e501", "אברהם", "MALE", (int?)null));

            var parent = family.Parents.Should().ContainSingle().Subject;
            (parent.Related!.DisplayName, parent.ParentRole, parent.RelationshipType, parent.AltGroupId, parent.SourceCitation).Should().Be(
                ("תרח", "FATHER", "BIOLOGICAL", (string?)null, "בראשית יא כו"));

            var child = family.Children.Should().ContainSingle().Subject;
            (child.Related!.PersonId, child.Related.EntryUniqueName, child.BirthOrder, child.CoParentEntityId, child.CoParentDisplayName, child.CoParentUnionOrder).Should().Be(
                ("067a4638-ac8a-4ca0-96d6-6c1ea4aed964", "יצחק", (int?)2, "0d1f7f2e-3a54-4b8e-9c67-a1b2c3d4e511", "שרה", (int?)1));

            var spouse = family.Spouses.Should().ContainSingle().Subject;
            (spouse.Related!.Sex, spouse.Related.EntryTitle, spouse.UnionType, spouse.UnionOrder, spouse.SourceCitation, spouse.PersonSourceCitation).Should().Be(
                ("FEMALE", "שרה", "MARRIAGE", (int?)1, "בראשית יא כט", (string?)null));
            (spouse.UnionEndReason, spouse.UnionStartDate, spouse.UnionEndDate).Should().Be(("DEATH", (int?)null, (int?)21330000));

            var sibling = family.Siblings.Should().ContainSingle().Subject;
            (sibling.PersonId, sibling.EntityId, sibling.DisplayName, sibling.EntryUniqueName, sibling.BirthDateYyyymmdd, sibling.SourceCitation).Should().Be(
                ("p-nahor", "e-nahor", "נחור", (string?)null, (int?)19480000, "בראשית יא כו"));
        }

        [Fact]
        public async Task ReadsPlaceMarkersWithNullModernName()
        {
            var response = await Deserialize<TanahpediaService.PlaceMarkersResponse>("""
                {"data":{"tanahpediaPlaceMarkers":[{"placeId":"pi500000-0000-4000-8000-000000000001","placeName":"ירושלים","modernName":null,"lat":31.7780132,"lng":35.2351364,"entryUniqueName":"ירושלים"}]}}
                """);

            var marker = response.Data!.TanahpediaPlaceMarkers.Should().ContainSingle().Subject;
            (marker.PlaceId, marker.PlaceName, marker.ModernName, marker.Lat, marker.Lng, marker.EntryUniqueName).Should().Be(
                ("pi500000-0000-4000-8000-000000000001", "ירושלים", (string?)null, 31.7780132, 35.2351364, "ירושלים"));
        }
    }
}
