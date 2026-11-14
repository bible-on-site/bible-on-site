using BibleOnSite.Helpers;

namespace BibleOnSite.Tests.Helpers;

public class SearchSpellingMatcherTests
{
    [Fact]
    public void PreservesEditDistanceForEveryShortWordAndLimit()
    {
        var words = Enumerable.Range(0, 6).SelectMany(length =>
            Enumerable.Range(0, 1 << length).Select(bits =>
                new string(Enumerable.Range(0, length).Select(i => (bits & (1 << i)) == 0 ? 'א' : 'ב').ToArray()))).ToArray();
        foreach (var term in words)
        {
            for (var limit = 0; limit <= 3; limit++)
            {
                var matcher = new SearchSpellingMatcher(term, limit);
                foreach (var candidate in words)
                {
                    var expected = SearchText.Distance(candidate, term, limit);
                    var actual = matcher.Distance(candidate);
                    if (expected <= limit) { actual.Should().Be(expected); }
                    else { actual.Should().BeGreaterThan(limit); }
                }
            }
        }
    }

    [Theory]
    [InlineData(63)]
    [InlineData(64)]
    [InlineData(65)]
    public void HandlesWordBoundaryAndGeneralFallback(int length)
    {
        var term = new string('א', length);
        var matcher = new SearchSpellingMatcher(term, 1);
        matcher.Distance(term).Should().Be(0);
        matcher.Distance("ב" + term).Should().Be(1);
        matcher.Distance(term + "ב").Should().Be(1);
        matcher.Distance("ב" + term[1..]).Should().Be(1);
        matcher.Distance("ב" + term + "ב").Should().BeGreaterThan(1);
    }
}
