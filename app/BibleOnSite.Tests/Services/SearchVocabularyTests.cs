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
}
