using BibleOnSite.Helpers;
using BibleOnSite.Models;
using FluentAssertions;

namespace BibleOnSite.Tests.Helpers;

/// <summary>
/// Match-location coverage for #2078: normalized offsets, excerpt anchoring,
/// note identity inside combined perush displays and normalized→raw mapping.
/// </summary>
public class SearchMatchTests
{
    #region Locate

    [Fact]
    public void Locate_finds_whole_word_phrase_position()
    {
        var span = SearchMatch.Locate("דבור בראשית ברא אלהים", "בראשית ברא");

        span.Should().Be(new SearchMatchSpan(5, 10));
    }

    [Fact]
    public void Locate_matches_through_niqqud_and_taamim()
    {
        // Rendered text carries combining marks the normalized index dropped.
        var span = SearchMatch.Locate("בְּרֵאשִׁית בָּרָא אֱלֹהִים", "ברא");

        span.Should().Be(new SearchMatchSpan(7, 3));
    }

    [Fact]
    public void Locate_ignores_html_markup_and_entities()
    {
        var span = SearchMatch.Locate("<p>אמר שליט&quot;א בברכה</p>", "שליטא");

        // Normalized: "אמר שליטא בברכה" — match at index 4.
        span.Should().Be(new SearchMatchSpan(4, 5));
    }

    [Fact]
    public void Locate_returns_the_first_occurrence_for_repeated_queries()
    {
        var span = SearchMatch.Locate("אחד בראשית ועוד בראשית", "בראשית");

        span.Should().Be(new SearchMatchSpan(4, 6));
    }

    [Fact]
    public void Locate_finds_substring_inside_a_longer_word()
    {
        var span = SearchMatch.Locate("אמר בראשית", "ראש");

        span.Should().Be(new SearchMatchSpan(5, 3));
    }

    [Fact]
    public void Locate_marks_whole_words_for_fuzzy_term_matches()
    {
        // "בראשים" differs from "בראשית" by one letter — no substring path, so
        // the scoring word fallback highlights the whole matched word.
        var span = SearchMatch.Locate("אמר בראשית", "בראשים");

        span.Should().Be(new SearchMatchSpan(4, 6));
    }

    [Fact]
    public void Locate_returns_null_when_nothing_matches()
    {
        SearchMatch.Locate("אמר דבר אחר", "קוראים").Should().BeNull();
        SearchMatch.Locate("אמר דבר אחר", null).Should().BeNull();
        SearchMatch.Locate("", "דבר").Should().BeNull();
    }

    [Fact]
    public void Locate_handles_null_content()
    {
        SearchMatch.Locate(null!, "דבר").Should().BeNull();
    }

    #endregion

    #region LocateByExcerpt

    [Fact]
    public void LocateByExcerpt_anchors_a_later_occurrence()
    {
        // The query word appears twice; the excerpt names the second window.
        var content = "בראשית נאמר ראשון ואחר כך בראשית נאמר שני";
        var excerpt = "ואחר כך בראשית נאמר שני";

        var span = SearchMatch.LocateByExcerpt(content, excerpt, "בראשית");

        // Normalized content == content; "בראשית" second occurrence starts at 26.
        span.Should().Be(new SearchMatchSpan(26, 6));
    }

    [Fact]
    public void LocateByExcerpt_narrows_to_the_query_inside_the_window()
    {
        var content = "אחד שתיים שלוש ארבע חמש שש שבע שמונה";
        var excerpt = "שלוש ארבע חמש";

        var span = SearchMatch.LocateByExcerpt(content, excerpt, "ארבע");

        span.Should().Be(new SearchMatchSpan(15, 4));
    }

    [Fact]
    public void LocateByExcerpt_falls_back_to_query_locate_for_stale_excerpts()
    {
        var span = SearchMatch.LocateByExcerpt("בראשית ברא אלהים", "חלון שאינו קיים", "אלהים");

        span.Should().Be(new SearchMatchSpan(11, 5));
    }

    [Fact]
    public void LocateByExcerpt_returns_position_only_span_when_query_absent_from_window()
    {
        var span = SearchMatch.LocateByExcerpt("אחד בראשית ברא אלהים", "ברא אלהים", "שמיים");

        // Semantic hit: excerpt anchors the passage but holds no query words —
        // a zero-length span still marks where to scroll.
        span.Should().Be(new SearchMatchSpan(11, 0));
    }

    [Fact]
    public void LocateByExcerpt_returns_null_without_any_anchor()
    {
        SearchMatch.LocateByExcerpt("אחד שתיים", null, "שלוש").Should().BeNull();
    }

    [Fact]
    public void LocateByExcerpt_handles_null_content_and_null_query()
    {
        // Null inputs degrade to empty strings; an empty window falls back to a
        // query locate over empty content, and an empty query anchors a
        // zero-length span at the excerpt position.
        SearchMatch.LocateByExcerpt(null!, "חלון", "בראשית").Should().BeNull();
        SearchMatch.LocateByExcerpt("אחד בראשית ברא", "בראשית ברא", null)
            .Should().Be(new SearchMatchSpan(4, 0));
    }

    #endregion

    #region LocateInJoinedNotes

    [Fact]
    public void LocateInJoinedNotes_targets_the_matched_note_not_the_first()
    {
        // Two sibling notes both contain the query word; the hit's note text
        // identifies the second one (#2078).
        var notes = new List<string> { "ראו בראשית כאן", "בראשית נוסף" };

        var span = SearchMatch.LocateInJoinedNotes(notes, "בראשית נוסף", "בראשית");

        // Joined normalized: "ראו בראשית כאן בראשית נוסף" — second בראשית at 15.
        span.Should().Be(new SearchMatchSpan(15, 6));
    }

    [Fact]
    public void LocateInJoinedNotes_maps_a_single_note()
    {
        var notes = new List<string> { "טקסט על בראשית" };

        var span = SearchMatch.LocateInJoinedNotes(notes, "טקסט על בראשית", "בראשית");

        span.Should().Be(new SearchMatchSpan(8, 6));
    }

    [Fact]
    public void LocateInJoinedNotes_falls_back_to_the_query_without_note_identity()
    {
        var notes = new List<string> { "ראו בראשית כאן", "בראשית נוסף" };

        var span = SearchMatch.LocateInJoinedNotes(notes, "טקסט שאינו בפירוש", "בראשית");

        span.Should().Be(new SearchMatchSpan(4, 6));
    }

    [Fact]
    public void LocateInJoinedNotes_returns_position_only_span_for_semantic_note()
    {
        var notes = new List<string> { "הערה ראשונה", "הערה שנייה" };

        var span = SearchMatch.LocateInJoinedNotes(notes, "הערה שנייה", "מונח נדיר");

        span.Should().Be(new SearchMatchSpan(12, 0));
    }

    [Fact]
    public void LocateInJoinedNotes_returns_null_when_no_note_matches()
    {
        var notes = new List<string> { "הערה ראשונה", "הערה שנייה" };

        SearchMatch.LocateInJoinedNotes(notes, "", "מונח נדיר").Should().BeNull();
    }

    [Fact]
    public void LocateInJoinedNotes_handles_null_identity_and_null_query()
    {
        var notes = new List<string> { "הערה ראשונה", "הערה שנייה" };

        SearchMatch.LocateInJoinedNotes(notes, null, null).Should().BeNull();
    }

    [Fact]
    public void LocateInJoinedNotes_skips_empty_notes()
    {
        // Rows adjacent to media can normalize to nothing; the identity walk
        // must skip them rather than match them.
        var notes = new List<string> { "", "הערה שנייה" };

        var span = SearchMatch.LocateInJoinedNotes(notes, "הערה שנייה", "הערה");

        span.Should().Be(new SearchMatchSpan(0, 4));
    }

    #endregion

    #region ResolvePerushTarget

    [Fact]
    public void ResolvePerushTarget_selects_the_hit_perush_and_span()
    {
        var hit = new PerushSearchResult("2", "הערה של בראשית", 1, 5, "בראשית");
        var displays = new List<PerushNoteDisplay>
        {
            new() { PerushName = "רש\"י", PerushId = 1, NoteContents = ["בראשית אחרת"] },
            new() { PerushName = "אבן עזרא", PerushId = 2, NoteContents = ["הערה של בראשית"] },
        };

        var target = SearchMatch.ResolvePerushTarget(hit, displays);

        target.Should().NotBeNull();
        target!.Value.Display.PerushId.Should().Be(2);
        target!.Value.Span.Should().Be(new SearchMatchSpan(8, 6));
    }

    [Fact]
    public void ResolvePerushTarget_searches_all_displays_for_unknown_perush_id()
    {
        var hit = new PerushSearchResult("not-a-number", "הערה של בראשית", 1, 5, "בראשית");
        var displays = new List<PerushNoteDisplay>
        {
            new() { PerushName = "רש\"י", PerushId = 1, NoteContents = ["הערה של בראשית"] },
        };

        SearchMatch.ResolvePerushTarget(hit, displays).Should().NotBeNull();
    }

    [Fact]
    public void ResolvePerushTarget_returns_null_when_no_display_carries_the_match()
    {
        var hit = new PerushSearchResult("1", "אין התאמה", 1, 5, "נדיר");
        var displays = new List<PerushNoteDisplay>
        {
            new() { PerushName = "רש\"י", PerushId = 1, NoteContents = ["הערה אחרת"] },
        };

        SearchMatch.ResolvePerushTarget(hit, displays).Should().BeNull();
    }

    #endregion

    #region ResolveArticleTarget

    [Fact]
    public void ResolveArticleTarget_maps_the_match_to_its_segment()
    {
        var segments = new List<string>
        {
            "<p>מאמר אחד על תורה</p>",
            "<p>עוד פרטים כאן ומאמר נוסף</p>",
        };

        var target = SearchMatch.ResolveArticleTarget(segments, "פרטים כאן ומאמר", "מאמר");

        target.Should().NotBeNull();
        target!.Value.Segment.Should().Be(1);
        // Segment 1 normalized: "עוד פרטים כאן ומאמר נוסף" — מאמר inside ומאמר.
        target!.Value.Span.Should().Be(new SearchMatchSpan(15, 4));
    }

    [Fact]
    public void ResolveArticleTarget_handles_a_single_segment()
    {
        var target = SearchMatch.ResolveArticleTarget(
            new List<string> { "<div>כל התוכן על בראשית כאן</div>" }, null, "בראשית");

        target.Should().Be((0, new SearchMatchSpan(12, 6)));
    }

    [Fact]
    public void ResolveArticleTarget_returns_null_when_the_article_lacks_the_match()
    {
        var target = SearchMatch.ResolveArticleTarget(
            new List<string> { "תוכן אחר", "ועוד אחר" }, null, "נדיר");

        target.Should().BeNull();
    }

    [Fact]
    public void ResolveArticleTarget_skips_empty_segments()
    {
        // Media splits leave empty text segments between content segments for the walk to skip.
        var segments = new List<string> { "", "<p>מאמר על בראשית</p>" };

        var target = SearchMatch.ResolveArticleTarget(segments, "על בראשית", "בראשית");

        target.Should().Be((1, new SearchMatchSpan(8, 6)));
    }

    #endregion

    #region ToRawRange / NormalizedMap

    [Fact]
    public void ToRawRange_expands_normalized_offsets_over_marks()
    {
        // "בְּרֵאשִׁית" is 11 UTF-16 units; normalized "בראשית" spans the same word.
        var (start, end) = SearchMatch.ToRawRange("בְּרֵאשִׁית בָּרָא", new SearchMatchSpan(7, 3));

        start.Should().Be(12, "the second word starts after word1(11) + space");
        end.Should().Be(18, "בָּרָא ends at raw index 18 (ב12 ָ13 ּ14 ר15 ָ16 א17)");
    }

    [Fact]
    public void ToRawRange_skips_erased_quotes()
    {
        var (start, end) = SearchMatch.ToRawRange("שליט\"א", new SearchMatchSpan(4, 1));

        (start, end).Should().Be((5, 6), "the gershayim at index 4 produced no normalized char");
    }

    [Fact]
    public void ToRawRange_handles_surrogate_pairs_per_unit()
    {
        var (start, _) = SearchMatch.ToRawRange("א𝐀ב", new SearchMatchSpan(2, 1));

        // 'א'=0, surrogate pair occupies 1-2, 'ב'=3 → normalized "א ב".
        start.Should().Be(3);
    }

    [Fact]
    public void ToRawRange_returns_degenerate_ranges_gracefully()
    {
        SearchMatch.ToRawRange("", new SearchMatchSpan(0, 4)).Should().Be((0, 0));
        SearchMatch.ToRawRange("בראשית", new SearchMatchSpan(3, 0)).Should().Be((3, 3));
    }

    [Fact]
    public void ToRawRange_pulls_trailing_combining_marks_into_the_range()
    {
        // "דברֶ" — the final letter's segol mark sits after the last mapped
        // raw index; the highlight must cover the whole rendered glyph.
        var (start, end) = SearchMatch.ToRawRange("דברֶ", new SearchMatchSpan(0, 3));

        (start, end).Should().Be((0, 4));
    }

    [Fact]
    public void ToRawRange_clamps_spans_past_the_end()
    {
        var (start, end) = SearchMatch.ToRawRange("ברא", new SearchMatchSpan(1, 10));

        start.Should().Be(1);
        end.Should().Be(3);
    }

    [Fact]
    public void NormalizedMap_tracks_normalize_output_length()
    {
        var raw = " א  בְּג \"ד\" ";
        var map = SearchMatch.NormalizedMap(raw);

        map.Should().HaveCount(SearchText.Normalize(raw).Length);
        SearchText.Normalize(raw).Should().Be("א בג ד");
    }

    [Fact]
    public void NormalizedMap_decomposes_precomposed_code_points()
    {
        // יִ (yod+hiriq presentation form) decomposes under NFD; the mark is
        // then filtered, leaving 'י' — same for precomposed é → 'e'.
        SearchMatch.NormalizedMap("יִ").Should().Equal(0);
        SearchMatch.NormalizedMap("é").Should().Equal(0);
        SearchText.Normalize("איִבé").Should().Be("איבe");
    }

    #endregion
}
