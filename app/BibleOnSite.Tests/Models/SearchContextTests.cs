using BibleOnSite.Models;

namespace BibleOnSite.Tests.Models;

public class SearchContextTests
{
    [Theory]
    [InlineData("משה" + "012345678901234567890123456789012345678901234567890123456789", false, true)]
    [InlineData("012345678901234567890123456789012345678901234567890123456789משה", true, false)]
    [InlineData("012345678901234567890123456789משה012345678901234567890123456789", true, true)]
    public void Highlighting_PreservesMatchAndContext_AndMarksTruncatedEnds(string text, bool before, bool after)
    {
        var verse = new PasukSearchResult(new Pasuk { PasukNum = 1, Text = text }, 1, "משה");
        var commentary = new PerushSearchResult("rashi", text, 1, 1, "משה");
        foreach (var result in new[] { verse.HighlightedResult, commentary.HighlightedResult })
        {
            result.Should().Contain("<b>משה</b>");
            result.StartsWith("...").Should().Be(before);
            result.EndsWith("...").Should().Be(after);
        }
    }

    [Theory]
    [InlineData("", "short")]
    [InlineData("missing", "short")]
    [InlineData(null, "short")]
    public void Commentary_WithNoMatchOrNoPhrase_PreservesShortText(string? phrase, string expected)
    {
        new PerushSearchResult("rashi", "short", 1, 1, phrase!).HighlightedResult.Should().Be(expected);
        new PerushSearchResult("rashi", new string('א', 60), 1, 1, phrase!).HighlightedResult.Should().Be(new string('א', 50) + "...");
    }
}
