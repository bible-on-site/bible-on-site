using BibleOnSite.Helpers;
using BibleOnSite.Models;
using FluentAssertions;

namespace BibleOnSite.Tests.Helpers;

public class TikkunFlowLayoutTests
{
    private const float BaseFontSize = 18f;
    private const float LineHeightFactor = 1.4f;
    private const float CharWidth = 10f;

    // Deterministic measure: every character is CharWidth wide at base size.
    // The stuma probe "אשר אשר אשר" (11 chars incl. spaces) therefore measures 110.
    private static float Measure(string text, float fontSize, bool isBold) =>
        text.Length * CharWidth * (fontSize / BaseFontSize) * (isBold ? 1.2f : 1f);

    private static List<TikkunWord> Words(params string[] texts) =>
        texts.Select(t => new TikkunWord(t, null, 1f, false)).ToList();

    private static List<TikkunFlowLayout.PlacedWord> LineWords(
        TikkunFlowLayout.Result result, int line) =>
        result.Words.Where(w => Math.Abs(w.Y - line * LineHeight) < 0.01f).ToList();

    private static float LineHeight => BaseFontSize * LineHeightFactor;

    private static float RightEdge(TikkunFlowLayout.PlacedWord w) => w.X + w.Width;

    // The stuma gap equals nine Hebrew letters in the active font — the probe
    // "אשר אשר אשר" measures 11 chars wide with this fake measure.
    private static float StumaGap => Measure(TikkunFlowLayout.StumaProbe, BaseFontSize, false);

    public class Wrapping
    {
        [Fact]
        public void packs_words_greedily_and_wraps_when_the_next_word_fits_no_more()
        {
            // spaceWidth = 1 char = 10; "cc" (20) won't fit after aaaa+bbbb (90).
            var result = TikkunFlowLayout.Layout(Words("aaaa", "bbbb", "cc", "dd"),
                Measure, BaseFontSize, maxWidth: 100, LineHeightFactor);

            result.LineCount.Should().Be(2);
            LineWords(result, 0).Select(w => w.Text)
                .Should().Equal("aaaa", "bbbb");
            LineWords(result, 1).Select(w => w.Text).Should().Equal("cc", "dd");
            result.Height.Should().Be(2 * LineHeight);
        }

        [Fact]
        public void gives_an_overlong_word_its_own_line_without_dropping_it()
        {
            var result = TikkunFlowLayout.Layout(Words("aaaaaaaaaaaaaa", "bb"),
                Measure, BaseFontSize, maxWidth: 100, LineHeightFactor);

            result.Words.Should().HaveCount(2);
            result.Words[0].Text.Should().Be("aaaaaaaaaaaaaa");
        }

        [Fact]
        public void handles_an_empty_word_list()
        {
            var result = TikkunFlowLayout.Layout(Words(), Measure, BaseFontSize, 100, LineHeightFactor);

            result.Words.Should().BeEmpty();
            result.Height.Should().Be(0);
            result.LineCount.Should().Be(0);
        }
    }

    public class Justification
    {
        [Fact]
        public void fills_every_complete_line_to_the_full_width()
        {
            // Line0: aa+bbb+cc (90 used of 110) must stretch its gaps to span the
            // column; the paragraph-final line stays natural (see below).
            var result = TikkunFlowLayout.Layout(Words("aa", "bbb", "cc", "dd", "ee"),
                Measure, BaseFontSize, maxWidth: 110, LineHeightFactor);

            result.LineCount.Should().Be(2);
            var firstLine = LineWords(result, 0);
            firstLine.Min(w => w.X).Should().BeApproximately(0, 0.01f);
            firstLine.Max(RightEdge).Should().BeApproximately(110, 0.01f);
        }

        [Fact]
        public void leaves_the_paragraph_last_line_naturally_aligned()
        {
            // The flow's final line ends the section — it hugs the right edge
            // instead of stretching its gap across the column.
            var result = TikkunFlowLayout.Layout(Words("aa", "bb", "cc", "dd"),
                Measure, BaseFontSize, maxWidth: 60, LineHeightFactor);

            var lines = result.Words.GroupBy(w => w.Y).OrderBy(g => g.Key).ToList();
            lines.Should().HaveCount(2);
            var last = lines[1].OrderByDescending(w => w.X).ToList();
            RightEdge(last[0]).Should().BeApproximately(60, 0.01f);
            // Ragged left edge: the gap stays one space, not stretched to fill.
            // cc (20) at the right edge + one space (10) + dd (20) → dd starts at 10.
            last[1].X.Should().BeApproximately(60 - 20 - 10 - 20, 0.01f);
            last[1].X.Should().BeGreaterThan(0);
        }

        [Fact]
        public void right_aligns_a_single_word_line_since_it_cannot_stretch()
        {
            var result = TikkunFlowLayout.Layout(Words("aa"), Measure, BaseFontSize, 100, LineHeightFactor);

            result.Words.Should().ContainSingle();
            result.Words[0].X.Should().BeApproximately(100 - 2 * CharWidth, 0.01f);
        }
    }

    public class RtlOrder
    {
        [Fact]
        public void places_the_first_word_at_the_right_edge_and_flows_left()
        {
            var result = TikkunFlowLayout.Layout(Words("aa", "bb"), Measure,
                BaseFontSize, maxWidth: 100, LineHeightFactor);

            result.Words[0].X.Should().BeGreaterThan(result.Words[1].X);
            RightEdge(result.Words[0]).Should().BeApproximately(100, 0.01f);
        }
    }

    public class Ptuha
    {
        [Fact]
        public void ends_the_line_and_starts_the_next_section_at_the_right_edge()
        {
            var words = Words("aaa", "bbb", "ccc");
            words.Insert(2, TikkunWord.PtuhaBreak);

            var result = TikkunFlowLayout.Layout(words, Measure, BaseFontSize,
                maxWidth: 200, LineHeightFactor);

            var before = LineWords(result, 0);
            before.Select(w => w.Text).Should().Equal("aaa", "bbb");
            // Paragraph-final line: natural alignment — the remainder stays blank.
            before.Min(w => w.X).Should().BeGreaterThan(0);
            var after = LineWords(result, 1);
            after.Should().ContainSingle();
            after[0].Text.Should().Be("ccc");
            RightEdge(after[0]).Should().BeApproximately(200, 0.01f);
        }

        [Fact]
        public void leaves_a_blank_line_when_the_section_ends_exactly_at_the_line_edge()
        {
            // "aaaaaaaaaa" fills the 100-wide line exactly; {פ} must then leave a
            // whole blank line before the next section.
            var words = Words("aaaaaaaaaa", "bb");
            words.Insert(1, TikkunWord.PtuhaBreak);

            var result = TikkunFlowLayout.Layout(words, Measure, BaseFontSize,
                maxWidth: 100, LineHeightFactor);

            result.LineCount.Should().Be(3);
            LineWords(result, 1).Should().BeEmpty();
            var next = LineWords(result, 2);
            next.Should().ContainSingle();
            RightEdge(next[0]).Should().BeApproximately(100, 0.01f);
        }

        [Fact]
        public void emits_no_drawable_word_for_the_marker_itself()
        {
            var words = Words("aa", "bb");
            words.Insert(1, TikkunWord.PtuhaBreak);

            var result = TikkunFlowLayout.Layout(words, Measure, BaseFontSize, 200, LineHeightFactor);

            result.Words.Should().OnlyContain(w => w.Text.Length > 0);
            result.Words.Select(w => w.Text).Should().NotContain("{פ}");
        }

        [Fact]
        public void ignores_a_marker_that_arrives_before_any_content()
        {
            // {פ} as the very first token: there is no line to end and no
            // previous content, so no blank remainder can be left.
            var words = Words("aa");
            words.Insert(0, TikkunWord.PtuhaBreak);

            var result = TikkunFlowLayout.Layout(words, Measure, BaseFontSize,
                maxWidth: 200, LineHeightFactor);

            result.LineCount.Should().Be(1);
            result.Words.Should().ContainSingle();
            RightEdge(result.Words[0]).Should().BeApproximately(200, 0.01f);
        }

        [Fact]
        public void a_marker_on_an_already_empty_line_leaves_a_whole_blank_line()
        {
            // The first {פ} flushes "aa"; the second arrives on an empty line,
            // so the paragraph break becomes a full blank line before "bb".
            var words = Words("aa", "bb");
            words.Insert(1, TikkunWord.PtuhaBreak);
            words.Insert(2, TikkunWord.PtuhaBreak);

            var result = TikkunFlowLayout.Layout(words, Measure, BaseFontSize,
                maxWidth: 200, LineHeightFactor);

            result.LineCount.Should().Be(3);
            LineWords(result, 0).Select(w => w.Text).Should().Equal("aa");
            LineWords(result, 1).Should().BeEmpty();
            LineWords(result, 2).Select(w => w.Text).Should().Equal("bb");
        }
    }

    public class Stuma
    {
        [Fact]
        public void leaves_a_nine_letter_gap_between_sections_on_the_same_line()
        {
            var words = Words("aa", "bb");
            words.Insert(1, TikkunWord.StumaGap);

            var result = TikkunFlowLayout.Layout(words, Measure, BaseFontSize,
                maxWidth: 200, LineHeightFactor);

            var line = LineWords(result, 0);
            line.Should().HaveCount(2);
            // "aa" sits at the right edge; the gap between its left edge and "bb"'s
            // right edge is exactly the nine-letter probe, not a stretched slot.
            var gap = line[0].X - RightEdge(line[1]);
            gap.Should().BeApproximately(StumaGap, 0.01f);
        }

        [Fact]
        public void the_gap_survives_full_justification_without_stretching()
        {
            // Line 0 (aa bb {ס} cc) fills 180 of 200 and wraps on "dd", so it is
            // a complete line and gets justified. The סתומה slot stays exactly
            // the nine-letter gap; the 20 leftover lands on the ordinary space.
            var words = Words("aa", "bb", "cc", "dd", "ee", "ff");
            words.Insert(2, TikkunWord.StumaGap);

            var result = TikkunFlowLayout.Layout(words, Measure, BaseFontSize,
                maxWidth: 200, LineHeightFactor);

            var line = LineWords(result, 0).OrderByDescending(w => w.X).ToList();
            line.Select(w => w.Text).Should().Equal("aa", "bb", "cc");
            // Fully justified: both edges reach the column edges.
            RightEdge(line[0]).Should().BeApproximately(200, 0.01f);
            line[^1].X.Should().BeApproximately(0, 0.01f);
            // The ordinary space absorbed the stretch: 10 space + 20 leftover.
            (line[0].X - RightEdge(line[1])).Should().BeApproximately(30, 0.01f);
            // The slot around the marker keeps the measured nine-letter gap.
            var gapAroundStuma = line[1].X - RightEdge(line[2]);
            gapAroundStuma.Should().BeApproximately(StumaGap, 0.01f);
        }

        [Fact]
        public void indents_the_continuation_line_when_the_gap_fits_but_the_word_does_not()
        {
            // maxWidth 130: "aa" + gap(110) = 140 already overflows, so "bb" wraps
            // to a new line that starts indented by the gap (סתומה fallback).
            var words = Words("aa", "bb");
            words.Insert(1, TikkunWord.StumaGap);

            var result = TikkunFlowLayout.Layout(words, Measure, BaseFontSize,
                maxWidth: 130, LineHeightFactor);

            result.LineCount.Should().Be(2);
            var before = LineWords(result, 0);
            before.Should().ContainSingle();
            // The ending line is a section boundary — natural, not stretched.
            before[0].X.Should().BeApproximately(130 - 20, 0.01f);
            var after = LineWords(result, 1);
            after.Should().ContainSingle();
            // Indented continuation: the gap leads the line.
            RightEdge(after[0]).Should().BeApproximately(130 - StumaGap, 0.01f);
        }

        [Fact]
        public void indents_when_the_marker_arrives_exactly_at_a_line_boundary()
        {
            // "aaaaaaaaaa" ends exactly at the edge; {ס} then puts its gap at the
            // start of the next line and the continuation is indented.
            var words = Words("aaaaaaaaaa", "bb");
            words.Insert(1, TikkunWord.StumaGap);

            var result = TikkunFlowLayout.Layout(words, Measure, BaseFontSize,
                maxWidth: 130, LineHeightFactor);

            result.LineCount.Should().Be(2);
            var after = LineWords(result, 1);
            after.Should().ContainSingle();
            RightEdge(after[0]).Should().BeApproximately(130 - StumaGap, 0.01f);
        }

        [Fact]
        public void keeps_the_word_on_the_line_when_it_alone_is_too_wide_for_the_gap()
        {
            // Width 60 < gap 110: the indent shrinks so the word still fits.
            var words = Words("aa", "bbbbbb");
            words.Insert(1, TikkunWord.StumaGap);

            var result = TikkunFlowLayout.Layout(words, Measure, BaseFontSize,
                maxWidth: 60, LineHeightFactor);

            var after = LineWords(result, 1);
            after.Should().ContainSingle();
            after[0].X.Should().BeGreaterThanOrEqualTo(0);
            RightEdge(after[0]).Should().BeApproximately(60, 0.01f);
        }

        [Fact]
        public void a_leading_marker_indents_the_first_word_by_the_gap()
        {
            // {ס} before the first word still applies its nine-letter indent
            // to the continuation that opens the flow.
            var words = Words("aa");
            words.Insert(0, TikkunWord.StumaGap);

            var result = TikkunFlowLayout.Layout(words, Measure, BaseFontSize,
                maxWidth: 200, LineHeightFactor);

            var line = LineWords(result, 0);
            line.Should().ContainSingle();
            RightEdge(line[0]).Should().BeApproximately(200 - StumaGap, 0.01f);
        }
    }

    public class LetterCap
    {
        // A column wide enough that width never drives the wrap: every break
        // in these tests comes from the 34-letter budget alone.
        private const float WideWidth = 100_000f;

        private static string HebrewRun(int letters) => new('א', letters);

        private static int LettersOnLine(TikkunFlowLayout.Result result, int line) =>
            LineWords(result, line).Sum(w => TikkunFlowLayout.HebrewLetters(w.Text));

        [Fact]
        public void fits_exactly_thirty_four_letters_on_one_line()
        {
            var result = TikkunFlowLayout.Layout(
                Words(HebrewRun(30), HebrewRun(4)), Measure, BaseFontSize,
                WideWidth, LineHeightFactor);

            result.LineCount.Should().Be(1);
            LettersOnLine(result, 0).Should().Be(TikkunFlowLayout.MaxLineLetters);
        }

        [Fact]
        public void wraps_the_word_that_would_reach_thirty_five_letters()
        {
            // 34 + the next word's single letter would make 35 → it moves whole
            // to the next line even though width is unlimited.
            var result = TikkunFlowLayout.Layout(
                Words(HebrewRun(30), HebrewRun(4), "ב"), Measure, BaseFontSize,
                WideWidth, LineHeightFactor);

            result.LineCount.Should().Be(2);
            LineWords(result, 0).Select(w => w.Text)
                .Should().Equal(HebrewRun(30), HebrewRun(4));
            LineWords(result, 1).Select(w => w.Text).Should().Equal("ב");
        }

        [Fact]
        public void ignores_niqqud_and_taamim_while_counting()
        {
            // The pointed word carries six base letters under niqqud and a taam.
            // Twenty-eight unpointed letters plus six reaches the cap exactly,
            // so the next word wraps (had marks counted, it would not fit).
            var pointed = "בְּרֵאשִׁ֖ית";
            pointed.Length.Should().BeGreaterThan(6);
            TikkunFlowLayout.HebrewLetters(pointed).Should().Be(6);

            var result = TikkunFlowLayout.Layout(
                Words(HebrewRun(28), pointed, "ב"), Measure, BaseFontSize,
                WideWidth, LineHeightFactor);

            result.LineCount.Should().Be(2);
            LineWords(result, 0).Select(w => w.Text).Should().Equal(HebrewRun(28), pointed);
            LineWords(result, 1).Select(w => w.Text).Should().Equal("ב");
        }

        [Fact]
        public void counts_final_forms_as_letters()
        {
            // ךםןףץ — five sofit letters; 30 + 5 = 35 → the sofit word wraps.
            var result = TikkunFlowLayout.Layout(
                Words(HebrewRun(30), "ךםןףץ"), Measure, BaseFontSize,
                WideWidth, LineHeightFactor);

            result.LineCount.Should().Be(2);
            LettersOnLine(result, 0).Should().Be(30);
            LettersOnLine(result, 1).Should().Be(5);
        }

        [Fact]
        public void maqaf_groups_count_their_letters_but_stay_unsplit()
        {
            // The maqaf-joined pair carries four letters and counts as one
            // layout unit — with the 33-letter word it exceeds the budget, so
            // the whole group wraps unsplit.
            const string maqafGroup = "אָב־אָב";
            TikkunFlowLayout.HebrewLetters(maqafGroup).Should().Be(4);

            var result = TikkunFlowLayout.Layout(
                Words(HebrewRun(33), maqafGroup), Measure, BaseFontSize,
                WideWidth, LineHeightFactor);

            result.LineCount.Should().Be(2);
            LineWords(result, 1).Should().ContainSingle()
                .Which.Text.Should().Be(maqafGroup);
        }

        [Fact]
        public void spaces_punctuation_and_numerals_add_zero()
        {
            TikkunFlowLayout.HebrewLetters("(קְרִי: 12").Should().Be(3);
        }

        [Fact]
        public void keeps_an_unbreakable_overlong_word_intact_on_its_own_line()
        {
            // A 40-letter word exceeds the cap by itself — it must not split or
            // drop, and the following word starts the next line.
            var overlong = HebrewRun(40);
            var result = TikkunFlowLayout.Layout(
                Words(overlong, "בב"), Measure, BaseFontSize,
                WideWidth, LineHeightFactor);

            result.LineCount.Should().Be(2);
            LineWords(result, 0).Should().ContainSingle()
                .Which.Text.Should().Be(overlong);
            LineWords(result, 1).Select(w => w.Text).Should().Equal("בב");
        }

        [Fact]
        public void counts_pasuk_markers_and_qri_notes_toward_the_line()
        {
            // The pasuk-number marker and the qri-note label are rendered
            // letters: 30-word + marker "יא" (2) + "(קרי:" (3) = 35 → the note
            // wraps whole even though width is free.
            var words = new List<TikkunWord>
            {
                new(HebrewRun(30), null, 1f, false),
                new("יא", null, 14f / 18f, true),
                new("(קְרִי:", null, 14f / 18f, false),
            };

            var result = TikkunFlowLayout.Layout(words, Measure, BaseFontSize,
                WideWidth, LineHeightFactor);

            result.LineCount.Should().Be(2);
            LineWords(result, 0).Select(w => w.Text).Should().Equal(HebrewRun(30), "יא");
            LineWords(result, 1).Select(w => w.Text).Should().Equal("(קְרִי:");
        }

        [Fact]
        public void carries_the_count_across_repeated_pasuk_copies()
        {
            // שניים מקרא emits each pasuk's words twice inline: the second copy
            // keeps counting on the same line instead of restarting.
            var result = TikkunFlowLayout.Layout(
                Words(HebrewRun(20), HebrewRun(20)), Measure, BaseFontSize,
                WideWidth, LineHeightFactor);

            result.LineCount.Should().Be(2);
            LettersOnLine(result, 0).Should().Be(20);
            LettersOnLine(result, 1).Should().Be(20);
        }

        [Fact]
        public void resets_the_budget_after_a_ptuha_break()
        {
            // {פ} ends the line after 30 letters; the next section starts a
            // fresh line with a fresh budget, so 8 + 26 = 34 fits together
            // (without the reset the accumulated 30 would split them).
            var words = Words(HebrewRun(30), HebrewRun(8), HebrewRun(26));
            words.Insert(1, TikkunWord.PtuhaBreak);

            var result = TikkunFlowLayout.Layout(words, Measure, BaseFontSize,
                WideWidth, LineHeightFactor);

            result.LineCount.Should().Be(2);
            LineWords(result, 1).Select(w => w.Text)
                .Should().Equal(HebrewRun(8), HebrewRun(26));
        }

        [Fact]
        public void stuma_gap_itself_adds_no_letters()
        {
            // {ס} between two words on one line: the gap is invisible layout,
            // so 30 + gap + 4 still fits the budget.
            var words = Words(HebrewRun(30), HebrewRun(4));
            words.Insert(1, TikkunWord.StumaGap);

            var result = TikkunFlowLayout.Layout(words, Measure, BaseFontSize,
                WideWidth, LineHeightFactor);

            result.LineCount.Should().Be(1);
            LettersOnLine(result, 0).Should().Be(34);
        }

        [Fact]
        public void the_cap_still_wraps_a_line_that_width_alone_would_extend()
        {
            // Width would happily take every word — the letter budget is what
            // ends the line: six 5-letter words fill 30, the seventh (→ 35)
            // and the rest move whole to the next line.
            var result = TikkunFlowLayout.Layout(
                Words("אאאאא", "בבבבב", "גגגגג", "דדדדד", "ההההה",
                    "ווווו", "זזזזז", "חח"),
                Measure, BaseFontSize, WideWidth, LineHeightFactor);

            result.LineCount.Should().Be(2);
            LettersOnLine(result, 0).Should().Be(30);
            LineWords(result, 1).Select(w => w.Text).Should().Equal("זזזזז", "חח");
        }
    }

    public class MixedSections
    {
        [Fact]
        public void section_tokens_survive_repeated_content_without_collapsing()
        {
            // שניים מקרא duplicates pasuk tokens — each copy keeps its own break.
            var words = Words("aa", "bb", "aa", "bb");
            words.Insert(2, TikkunWord.PtuhaBreak);

            var result = TikkunFlowLayout.Layout(words, Measure, BaseFontSize,
                maxWidth: 200, LineHeightFactor);

            result.LineCount.Should().Be(2);
            LineWords(result, 0).Select(w => w.Text).Should().Equal("aa", "bb");
            LineWords(result, 1).Select(w => w.Text).Should().Equal("aa", "bb");
        }

        [Fact]
        public void a_marker_between_pasuk_boundaries_still_breaks_the_flow()
        {
            // Simulates "…pasuk words {פ} [next pasuk marker] pasuk words…".
            var words = new List<TikkunWord>
            {
                new("aa", null, 1f, false),
                new("bb", null, 1f, false),
                TikkunWord.PtuhaBreak,
                new("ג", null, 1f, true),   // next pasuk's number marker
                new("cc", null, 1f, false),
            };

            var result = TikkunFlowLayout.Layout(words, Measure, BaseFontSize,
                maxWidth: 200, LineHeightFactor);

            LineWords(result, 0).Select(w => w.Text).Should().Equal("aa", "bb");
            var next = LineWords(result, 1);
            next.Select(w => w.Text).Should().Equal("ג", "cc");
            RightEdge(next[0]).Should().BeApproximately(200, 0.01f);
        }
    }

    /// <summary>
    /// #2839 contract against the shipped canon: the tracked tanah_view asset is
    /// the exact input the flow renders, so these checks prove real pesukim —
    /// qri notes, maqaf chains, שניים מקרא copies and section tokens included —
    /// stay within the letter budget without losing or duplicating a word.
    /// Regenerate the asset with
    /// `cd data && cargo make generate-tanah-view-sqlite-from-json`.
    /// </summary>
    public class PackagedScripture
    {
        private const string DbName = "sefaria-dump-5784-sivan-4.tanah_view.sqlite";

        private sealed class SegmentRow
        {
            [SQLite.Column("perek_id")] public int PerekId { get; set; }
            [SQLite.Column("pasuk_id")] public int PasukId { get; set; }
            [SQLite.Column("segment_type")] public string SegmentType { get; set; } = string.Empty;
            [SQLite.Column("value")] public string? Value { get; set; }
            [SQLite.Column("qri_ktiv_offset")] public int? QriKtivOffset { get; set; }
        }

        private static string? FindPackagedDbPath()
        {
            // Same project-root walk as MasoraDataServiceTests.
            var dir = new DirectoryInfo(Directory.GetCurrentDirectory());
            while (dir != null && !Directory.Exists(Path.Join(dir.FullName, "BibleOnSite")))
            {
                dir = dir.Parent;
            }

            return dir == null
                ? null
                : Path.Join(dir.FullName, "BibleOnSite", "Resources", "Raw", DbName);
        }

        private static async Task<List<SegmentRow>> LoadAllSegmentsAsync()
        {
            var dbPath = FindPackagedDbPath();
            Assert.SkipUnless(dbPath != null && File.Exists(dbPath), "Packaged tanah_view database not present");

            var db = new SQLite.SQLiteAsyncConnection(dbPath, SQLite.SQLiteOpenFlags.ReadOnly);
            try
            {
                return await db.QueryAsync<SegmentRow>(
                    "SELECT s.perek_id AS perek_id, s.pasuk_id AS pasuk_id, " +
                    "s.segment_type AS segment_type, v.value AS value, " +
                    "o.qri_ktiv_offset AS qri_ktiv_offset " +
                    "FROM tanah_pasuk_segment s " +
                    "LEFT JOIN tanah_pasuk_segment_value v ON v.id = s.id " +
                    "LEFT JOIN tanah_pasuk_segment_qri_ktiv_offset o ON o.id = s.id " +
                    "ORDER BY s.perek_id, s.pasuk_id, s.id");
            }
            finally
            {
                await db.CloseAsync();
            }
        }

        private static List<Pasuk> ToPesukim(IEnumerable<SegmentRow> rows)
        {
            var pesukim = new List<Pasuk>();
            List<PasukSegment>? segments = null;
            var current = -1;
            foreach (var row in rows)
            {
                if (row.PasukId != current)
                {
                    current = row.PasukId;
                    segments = [];
                    pesukim.Add(new Pasuk { PasukNum = current, Text = string.Empty, Segments = segments });
                }

                segments!.Add(new PasukSegment
                {
                    Type = row.SegmentType switch
                    {
                        "ktiv" => SegmentType.Ktiv,
                        "ptuha" => SegmentType.Ptuha,
                        "stuma" => SegmentType.Stuma,
                        _ => SegmentType.Qri,
                    },
                    Value = row.Value ?? string.Empty,
                    PairedOffset = row.QriKtivOffset,
                });
            }

            return pesukim;
        }

        private static List<List<TikkunFlowLayout.PlacedWord>> Lines(
            TikkunFlowLayout.Result result, float lineHeight) =>
            result.Words
                .GroupBy(w => (int)Math.Round(w.Y / lineHeight))
                .OrderBy(g => g.Key)
                .Select(g => g.ToList())
                .ToList();

        [Fact]
        public async Task bereshit_yud_shnayim_mikra_caps_every_line_at_34_letters()
        {
            // The reported flow: בראשית י (perek_id 10) in שניים מקרא. A column
            // far wider than the cap isolates the letter budget as the only
            // wrap driver — width would otherwise pack ~5× more.
            var rows = await LoadAllSegmentsAsync();
            var pesukim = ToPesukim(rows.Where(r => r.PerekId == 10));
            pesukim.Should().NotBeEmpty();

            var words = TikkunKorimTextBuilder.BuildWords(pesukim, repeatEachPasuk: true, hideMarks: false);
            var result = TikkunFlowLayout.Layout(words, Measure, BaseFontSize,
                maxWidth: 1_000_000, LineHeightFactor);

            var lines = Lines(result, LineHeight);
            lines.Should().NotBeEmpty();
            lines.Select(l => l.Sum(w => TikkunFlowLayout.HebrewLetters(w.Text)))
                .Should().OnlyContain(count => count <= TikkunFlowLayout.MaxLineLetters,
                    "no rendered line may exceed the 34-Hebrew-letter cap");
            // Every input word landed once, in order — cap wrapping must never
            // drop, split or duplicate text.
            result.Words.Select(w => w.Text)
                .Should().Equal(words.Where(w => w.Kind == TikkunWordKind.Text).Select(w => w.Text));
        }

        [Fact]
        public async Task every_shipped_word_fits_the_cap_so_the_unbreakable_exception_never_fires()
        {
            // The >34-letter unbreakable-word exception is documented defensive
            // behavior; shipped scripture (incl. maqaf-joined layout units)
            // must never produce one. Guards both marked and unmarked builds.
            var rows = await LoadAllSegmentsAsync();
            var pesukim = ToPesukim(rows);
            pesukim.Should().NotBeEmpty();

            foreach (var hideMarks in new[] { false, true })
            {
                var words = TikkunKorimTextBuilder.BuildWords(pesukim, repeatEachPasuk: true, hideMarks);
                var longest = words.Where(w => w.Kind == TikkunWordKind.Text)
                    .Select(w => TikkunFlowLayout.HebrewLetters(w.Text))
                    .Max();
                longest.Should().BeLessThanOrEqualTo(TikkunFlowLayout.MaxLineLetters,
                    $"hideMarks={hideMarks}: no real word may force the unbreakable exception");
            }
        }

        [Fact]
        public async Task every_line_of_every_perek_stays_within_the_cap()
        {
            // Whole-canon sweep: every emitted line of every perek, marked and
            // unmarked, honors the budget — the flow's only input is this data.
            var rows = await LoadAllSegmentsAsync();
            var byPerek = rows.GroupBy(r => r.PerekId);

            foreach (var perek in byPerek)
            {
                var pesukim = ToPesukim(perek);
                foreach (var hideMarks in new[] { false, true })
                {
                    var words = TikkunKorimTextBuilder.BuildWords(pesukim, repeatEachPasuk: true, hideMarks);
                    var result = TikkunFlowLayout.Layout(words, Measure, BaseFontSize,
                        maxWidth: 1_000_000, LineHeightFactor);

                    Lines(result, LineHeight)
                        .Select(l => l.Sum(w => TikkunFlowLayout.HebrewLetters(w.Text)))
                        .Should().OnlyContain(count => count <= TikkunFlowLayout.MaxLineLetters,
                            $"perek {perek.Key} hideMarks={hideMarks} emitted an over-cap line");
                    result.Words.Select(w => w.Text)
                        .Should().Equal(words.Where(w => w.Kind == TikkunWordKind.Text).Select(w => w.Text),
                            $"perek {perek.Key} hideMarks={hideMarks} lost or duplicated words");
                }
            }
        }
    }
}
