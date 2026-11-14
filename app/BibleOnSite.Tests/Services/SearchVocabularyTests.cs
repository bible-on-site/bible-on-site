using BibleOnSite.Services;

namespace BibleOnSite.Tests.Services;

public class SearchVocabularyTests
{
    [Fact]
    public void CancellationStopsAnInFlightVocabularyScan()
    {
        using var cancellation = new CancellationTokenSource();
        var visited = 0;
        IEnumerable<string> Vocabulary()
        {
            visited++;
            yield return "בראשית";
            cancellation.Cancel();
            visited++;
            yield return "בראשיט";
            visited++;
            yield return "בראשון";
        }
        var scan = () => SearchIndexService.ExpandTerm(Vocabulary(), "בראשית", 1, cancellation.Token);
        scan.Should().Throw<OperationCanceledException>();
        visited.Should().Be(2, "cancelled queries must release the search gate without scanning the remaining vocabulary");
    }

    [Fact]
    public void ExpansionRanksExactMatchesThenSpellingDistanceThenOrdinalTerm()
    {
        SearchIndexService.ExpandTerm(["בראשיט", "שונה", "בראשית", "בראשיב"], "בראשית", 1, CancellationToken.None)
            .Should().Equal("\"בראשית\"", "\"בראשיב\"", "\"בראשיט\"");
    }

    [Fact]
    public void ExpansionCapsTheKeptSetAtTwentyFour()
    {
        // 24 distance-1 variants fill the kept set; the exact term then
        // displaces the worst kept entry, and the tail variant is dropped.
        var vocabulary = new List<string>
        {
            "בראשיא", "בראשיב", "בראשיג", "בראשיד", "בראשיה", "בראשיו", "בראשיז", "בראשיח",
            "בראשיט", "בראשיי", "בראשיכ", "בראשיל", "בראשימ", "בראשין", "בראשיס", "בראשיע",
            "בראשיפ", "בראשיצ", "בראשיק", "בראשיר", "בראשיש", "בראשיתא", "בראשי", "אראשית",
            "בראשית",
        };
        var expanded = SearchIndexService.ExpandTerm(vocabulary, "בראשית", 1, CancellationToken.None);
        expanded.Should().HaveCount(24);
        expanded[0].Should().Be("\"בראשית\"");
    }

    [Fact]
    public void ExpansionSkipsCandidatesThatCannotDisplaceTheKeptSet()
    {
        // fts5vocab 'row' emits one row per term per document, so a common term
        // saturates the kept set with distance-0 duplicates; further candidates
        // either rank outside the cap or never reach the distance pass at all.
        var vocabulary = Enumerable.Repeat("בראשית", 24)
            .Append("תותתות")
            .Append("בראשיי");
        SearchIndexService.ExpandTerm(vocabulary, "בראשית", 1, CancellationToken.None)
            .Should().OnlyContain(term => term == "\"בראשית\"").And.HaveCount(24);
    }
}
