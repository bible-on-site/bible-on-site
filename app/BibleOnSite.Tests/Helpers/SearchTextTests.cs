using BibleOnSite.Helpers;
using FluentAssertions;

namespace BibleOnSite.Tests.Helpers;

public class SearchTextTests
{
    public class Snippet
    {
        [Fact]
        public void highlights_first_match_and_wraps_in_bold()
        {
            var result = SearchText.Snippet("אאא בבב", "אאא");

            result.Should().Be("<b>אאא</b> בבב");
        }

        [Fact]
        public void returns_prefix_ellipsis_when_match_starts_late()
        {
            var result = SearchText.Snippet(new string('א', 50) + "בבב", "בבב");

            result.Should().StartWith("...");
        }

        [Fact]
        public void skips_matches_outside_the_excerpt_window()
        {
            var text = "אאא" + new string('x', 100) + "אאא";

            var result = SearchText.Snippet(text, "אאא");

            result.Should().Contain("<b>").And.EndWith("...");
            result.Split("<b>", StringSplitOptions.None).Should().HaveCount(2);
        }
    }
}
