using BibleOnSite.Helpers;
using FluentAssertions;

namespace BibleOnSite.Tests.Helpers;

/// <summary>
/// Unit tests for <see cref="HtmlMediaExtractor"/>.
/// </summary>
public class HtmlMediaExtractorTests
{
    public class ContainsMedia
    {
        [Fact]
        public void returns_false_when_html_is_null()
        {
            HtmlMediaExtractor.ContainsMedia(null).Should().BeFalse();
        }

        [Fact]
        public void returns_false_when_html_is_empty()
        {
            HtmlMediaExtractor.ContainsMedia(string.Empty).Should().BeFalse();
        }

        [Fact]
        public void returns_false_when_html_is_whitespace_only()
        {
            HtmlMediaExtractor.ContainsMedia("   \t\r\n").Should().BeFalse();
        }

        [Fact]
        public void returns_false_when_html_has_text_and_markup_but_no_video_or_audio_tags()
        {
            const string html = "<p>Plain text</p><div>no media here</div>";
            HtmlMediaExtractor.ContainsMedia(html).Should().BeFalse();
        }

        [Fact]
        public void returns_true_when_html_contains_a_video_element()
        {
            const string html = """<p>intro</p><video><source src="https://example.com/a.mp4"></video>""";
            HtmlMediaExtractor.ContainsMedia(html).Should().BeTrue();
        }

        [Fact]
        public void returns_true_when_html_contains_an_audio_element()
        {
            const string html = """<audio controls><source src="https://example.com/a.mp3"></audio>""";
            HtmlMediaExtractor.ContainsMedia(html).Should().BeTrue();
        }

        [Fact]
        public void returns_true_when_html_contains_both_video_and_audio_elements()
        {
            const string html =
                """<video><source src="https://example.com/a.mp4"></video><audio><source src="https://example.com/a.mp3"></audio>""";
            HtmlMediaExtractor.ContainsMedia(html).Should().BeTrue();
        }

        [Fact]
        public void matches_video_tag_opening_case_insensitively()
        {
            HtmlMediaExtractor.ContainsMedia("<VIDEO src=\"x\"></VIDEO>").Should().BeTrue();
        }

        [Fact]
        public void matches_audio_tag_opening_case_insensitively()
        {
            HtmlMediaExtractor.ContainsMedia("<AUDIO src=\"x\"></AUDIO>").Should().BeTrue();
        }
    }

    public class ExtractSegments
    {
        [Fact]
        public void returns_empty_collection_when_html_is_null()
        {
            var segments = HtmlMediaExtractor.ExtractSegments(null!);
            segments.Should().BeEmpty();
        }

        [Fact]
        public void returns_empty_collection_when_html_is_empty()
        {
            HtmlMediaExtractor.ExtractSegments(string.Empty).Should().BeEmpty();
        }

        [Fact]
        public void returns_empty_collection_when_html_is_whitespace_only()
        {
            HtmlMediaExtractor.ExtractSegments("   \t\r\n").Should().BeEmpty();
        }

        [Fact]
        public void returns_a_single_html_segment_when_there_is_no_media()
        {
            const string html = "<p>Hello <strong>world</strong></p>";
            var segments = HtmlMediaExtractor.ExtractSegments(html);
            segments.Should().ContainSingle();
            segments[0].Kind.Should().Be(SegmentKind.Html);
            segments[0].Html.Should().NotBeNull();
            segments[0].Html!.Should().Contain("Hello");
            segments[0].Html!.Should().Contain("world");
            segments[0].MediaUrl.Should().BeNull();
            segments[0].Type.Should().BeNull();
        }

        [Fact]
        public void extracts_video_segment_using_child_source_element_url()
        {
            const string url = "https://example.com/clip.mp4";
            var html = $"""<p>Before</p><video controls><source src="{url}" type="video/mp4"></video><p>After</p>""";

            var segments = HtmlMediaExtractor.ExtractSegments(html);

            segments.Should().HaveCount(3);
            segments[0].Kind.Should().Be(SegmentKind.Html);
            segments[0].Html.Should().Contain("Before");

            segments[1].Should().BeEquivalentTo(
                new ContentSegment(SegmentKind.Media, null, url, MediaType.Video));

            segments[2].Kind.Should().Be(SegmentKind.Html);
            segments[2].Html.Should().Contain("After");
        }

        [Fact]
        public void extracts_audio_segment_and_sets_media_type_to_audio()
        {
            const string url = "https://example.com/track.mp3";
            var html = $"""<h2>Listen</h2><audio controls="controls"><source src="{url}"></audio>""";

            var segments = HtmlMediaExtractor.ExtractSegments(html);

            segments.Should().HaveCount(2);
            segments[0].Kind.Should().Be(SegmentKind.Html);
            segments[0].Html.Should().Contain("Listen");

            segments[1].Should().BeEquivalentTo(
                new ContentSegment(SegmentKind.Media, null, url, MediaType.Audio));
        }

        [Fact]
        public void splits_mixed_text_video_br_heading_and_audio_like_article_503()
        {
            const string mp4 =
                "https://bible-on-site-assets.s3.il-central-1.amazonaws.com/articles/188/יהושע פרק א - הרב זמיר ינון.mp4";
            const string mp3 =
                "https://bible-on-site-assets.s3.il-central-1.amazonaws.com/articles/188/יהושע פרק א - הרב זמיר ינון.mp3";

            var html =
                $"<h1>שיעור לפרק א'</h1><h2>לצפייה</h2><video id=\"movie\" autoplay=\"autoplay\" width=\"100%\" height=\"\" preload=\"\" controls=\"\"><source id=\"srcMp4\" src=\"{mp4}\"></video><br><h2>להאזנה</h2><audio controls=\"controls\"><source src=\"{mp3}\"></audio>";

            var segments = HtmlMediaExtractor.ExtractSegments(html);

            segments.Should().HaveCount(4);

            segments[0].Kind.Should().Be(SegmentKind.Html);
            segments[0].Html.Should().Contain("שיעור לפרק א'");
            segments[0].Html.Should().Contain("לצפייה");

            segments[1].Should().BeEquivalentTo(
                new ContentSegment(SegmentKind.Media, null, mp4, MediaType.Video));

            segments[2].Kind.Should().Be(SegmentKind.Html);
            segments[2].Html.Should().Contain("להאזנה");

            segments[3].Should().BeEquivalentTo(
                new ContentSegment(SegmentKind.Media, null, mp3, MediaType.Audio));
        }

        [Fact]
        public void reads_video_url_from_src_attribute_when_present()
        {
            const string url = "https://cdn.example.com/direct.mp4";
            var html = $"""<video src="{url}" controls></video>""";

            var segments = HtmlMediaExtractor.ExtractSegments(html);

            segments.Should().ContainSingle();
            segments[0].Should().BeEquivalentTo(
                new ContentSegment(SegmentKind.Media, null, url, MediaType.Video));
        }

        [Fact]
        public void skips_media_element_when_no_source_url_can_be_resolved()
        {
            var html = """<p>Intro</p><video controls></video><p>Outro</p>""";

            var segments = HtmlMediaExtractor.ExtractSegments(html);

            segments.Should().HaveCount(2);
            segments[0].Kind.Should().Be(SegmentKind.Html);
            segments[0].Html.Should().Contain("Intro");
            segments[1].Kind.Should().Be(SegmentKind.Html);
            segments[1].Html.Should().Contain("Outro");
        }

        [Fact]
        public void produces_empty_list_when_video_has_no_resolvable_url_and_no_other_content()
        {
            var html = """<video></video>""";

            var segments = HtmlMediaExtractor.ExtractSegments(html);

            segments.Should().BeEmpty();
        }
    }
}
