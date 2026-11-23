using BibleOnSite.Helpers;
using FluentAssertions;

namespace BibleOnSite.Tests.Helpers;

public class SearchTextTests
{
    public class PlainText
    {
        // The same cases are asserted in search-normalize.test.ts (website),
        // search_text.rs (the delivered index builder) and article_search/text.rs
        // (api): every open or close block-level tag is a word break in all four ports.
        [Theory]
        [InlineData("<td>foo</td><td>bar</td>", "foo bar")]
        [InlineData("<th>א</th><td>ב</td>", "א ב")]
        [InlineData("<h4>א</h4>ב", "א ב")]
        [InlineData("<ul><li>א</li><li>ב</li></ul>", "א ב")]
        [InlineData("<table><tr><td>א</td><td>ב</td></tr></table>", "א ב")]
        [InlineData("<blockquote>א</blockquote><section>ב</section>", "א ב")]
        [InlineData("<header>א</header><article>ב</article>", "א ב")]
        [InlineData("<footer>א</footer>ב", "א ב")]
        [InlineData("א<hr>ב", "א ב")]
        [InlineData("<div>א", "א")]
        [InlineData("<p>א</p><p>ב</p>", "א ב")]
        [InlineData("א<br>ב", "א ב")]
        public void breaks_words_on_every_block_tag_like_the_other_ports(string html, string expected)
        {
            SearchText.Normalize(SearchText.PlainText(html)).Should().Be(expected);
        }
    }

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
