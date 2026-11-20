using BibleOnSite.Helpers;
using FluentAssertions;
using Microsoft.Maui.Graphics;

namespace BibleOnSite.Tests.Helpers;

public class TikkunGlyphRunTests
{
    [Fact]
    public void marked_runs_keep_base_glyphs_where_the_bare_word_places_them()
    {
        // Al Heperek attaches every mark as a zero-advance glyph (#3685):
        // stripping a run's marks moves no base letter — exactly the repaint
        // contract HideMarks relies on (#3265).
        var marked = TikkunFont.Shape("וַיַּ֧רְא", 18);
        var bare = TikkunFont.Shape("וירא", 18);
        var markedVav = marked.Glyphs.Single(g => g.Name == "uni05D5.ss03");
        var bareVav = bare.Glyphs.Single(g => g.Name == "uni05D5.ss03");
        markedVav.X.Should().BeApproximately(bareVav.X, 0.001f);
        marked.Width.Should().BeApproximately(33.192f, 0.001f);
        marked.Bases.Count.Should().BeGreaterThan(0);
        marked.Marks.Count.Should().BeGreaterThan(0);
        bare.Marks.Count.Should().Be(0);
    }

    [Theory]
    [InlineData("יּ", "uni05D9.ss03", "uni05BC")]
    [InlineData("שׁ", "uni05E9.ss03", "uni05C1")]
    [InlineData("שׂ", "uni05E9.ss03", "uni05C2")]
    [InlineData("וֹ", "uni05D5.ss03", "uni05B9")]
    [InlineData("יַ", "uni05D9.ss03", "uni05B7")]
    public void mark_glyphs_paint_in_their_own_layer(string text, string baseGlyph, string markGlyph)
    {
        // Al Heperek draws dagesh, shin/sin dots and niqqud as separate GDEF
        // mark glyphs — each paints in the annotation layer so HideMarks can
        // hide it without touching the base letter's contours (#3685).
        var run = TikkunFont.Shape(text, 18);
        run.Glyphs.Should().Contain(g => g.Name == baseGlyph);
        run.Glyphs.Should().Contain(g => g.Name == markGlyph);
        run.Bases.Count.Should().BeGreaterThan(0);
        run.Marks.Count.Should().BeGreaterThan(0);
        run.Bases.Should().NotBeSameAs(run.Marks);
    }

    [Fact]
    public void punctuation_and_base_letters_are_not_mistaken_for_vocalization()
    {
        var run = TikkunFont.Shape("אל־מלך׃", 24);
        run.Bases.Count.Should().BeGreaterThan(0);
        run.Marks.Count.Should().Be(0);
        run.Glyphs.Should().OnlyContain(g => g.Advance >= 0);
    }

    [Fact]
    public void paseq_keeps_its_marked_advance_but_hides_with_cantillation()
    {
        TikkunKorimTextBuilder.StripMarks("׀").Should().BeEmpty();
        var run = TikkunFont.Shape("׀", 18);
        run.Width.Should().BeGreaterThan(0);
        run.Bases.Count.Should().Be(0);
        run.Marks.Count.Should().BeGreaterThan(0);
    }

    [Fact]
    public void the_font_and_derived_contours_cannot_drift_silently()
    {
        using var wrongFont = new MemoryStream([1, 2, 3]);
        using var outlines = typeof(TikkunFont).Assembly.GetManifestResourceStream("AlHeperekUI-outlines.json")!;
        var load = () => TikkunFont.Load(wrongFont, outlines);
        load.Should().Throw<InvalidDataException>().WithMessage("Regenerate*");
    }

    [Fact]
    public void contour_commands_preserve_coordinates_and_reject_corrupt_assets()
    {
        var path = new PathF();
        TikkunFont.Append(path, [0, 1, 2, 1, 3, 4, 2, 5, 6, 7, 8, 3, 9, 10, 11, 12, 13, 14, 4], 20, 30, 2);
        path[0].Should().Be(new PointF(22, 26));
        path.Closed.Should().BeTrue();
        var invalid = () => TikkunFont.Append(path, [9], 0, 0, 1);
        invalid.Should().Throw<InvalidDataException>();
    }
}
