using BibleOnSite.Helpers;
using FluentAssertions;
using Microsoft.Maui.Graphics;

namespace BibleOnSite.Tests.Helpers;

public class TikkunGlyphRunTests
{
    [Fact]
    public void the_bundled_font_reproduces_the_within_word_movement_that_stripping_would_cause()
    {
        var marked = TikkunFont.Shape("וַיַּ֧רְא", 18);
        var bare = TikkunFont.Shape("וירא", 18);
        marked.Glyphs.Single(g => g.Name == "vav").X.Should().BeApproximately(21.9287109f, 0.001f);
        bare.Glyphs.Single(g => g.Name == "vav").X.Should().BeApproximately(21.0498047f, 0.001f);
        marked.Width.Should().BeApproximately(26.4111328f, 0.001f);
        marked.Bases.Count.Should().BeGreaterThan(0);
        marked.Marks.Count.Should().BeGreaterThan(0);
    }

    [Theory]
    [InlineData("יּ", "yoddagesh")]
    [InlineData("שׁ", "trueshin")]
    [InlineData("שׂ", "sin")]
    [InlineData("וֹ", "vavxolam")]
    [InlineData("ײַ", "yodyod")]
    public void annotations_inside_letter_glyphs_have_their_own_paint_layer(string text, string name)
    {
        var run = TikkunFont.Shape(text, 18);
        run.Glyphs.Should().Contain(g => g.Name == name);
        run.Bases.Count.Should().BeGreaterThan(0);
        run.Marks.Count.Should().BeGreaterThan(0);
        run.Bases.Should().NotBeSameAs(run.Marks);
    }

    [Fact]
    public void punctuation_and_base_ligatures_are_not_mistaken_for_vocalization()
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
        using var outlines = typeof(TikkunFont).Assembly.GetManifestResourceStream("TikkunFont.outlines.json")!;
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
