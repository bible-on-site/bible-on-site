using System.Globalization;
using BibleOnSite.Helpers;
using FluentAssertions;

namespace BibleOnSite.Tests.Helpers;

public class HtmlRunsRegressionTests
{
    [Fact]
    public void OrderedListMarkers_FindTheListThroughAnExtraWrapper()
    {
        var runs = HtmlRuns.FromHtml("<ol><div><li>שלום</li></div></ol>");
        string.Concat(runs.Select(run => run.Text)).Should().Be("1. שלום");
    }

    [Theory]
    [InlineData("strong", true, false, false, false)]
    [InlineData("em", false, true, false, false)]
    [InlineData("ins", false, false, true, false)]
    [InlineData("strike", false, false, false, true)]
    [InlineData("del", false, false, false, true)]
    public void FormattingAliases_ChangeOnlyTheMarkedText(string tag, bool bold, bool italic, bool underline, bool strike)
    {
        var runs = HtmlRuns.FromHtml($"א<{tag}>ב</{tag}>");
        runs.Should().HaveCount(2);
        runs[0].Should().BeEquivalentTo(new HtmlRun { Text = "א" });
        runs[1].Should().BeEquivalentTo(new HtmlRun
        {
            Text = "ב", Bold = bold, Italic = italic, Underline = underline, Strikethrough = strike
        });
    }

    [Theory]
    [InlineData("bold")]
    [InlineData("bolder")]
    [InlineData("600")]
    [InlineData("700")]
    [InlineData("800")]
    [InlineData("900")]
    public void SupportedCssWeights_PreserveInheritedEmphasis(string weight)
    {
        var run = HtmlRuns.FromHtml($"<em><span style=\"font-weight:{weight}\">שלום</span></em>").Single();
        run.Bold.Should().BeTrue();
        run.Italic.Should().BeTrue();
    }

    [Theory]
    [InlineData("h1", 1)]
    [InlineData("h2", 2)]
    [InlineData("h3", 3)]
    [InlineData("h4", 4)]
    [InlineData("h5", 5)]
    [InlineData("h6", 6)]
    [InlineData("h0", 0)]
    [InlineData("h7", 0)]
    [InlineData("h", 0)]
    [InlineData("x1", 0)]
    public void OnlySupportedHeadingTags_ReceiveHeadingFormatting(string tag, int level)
    {
        var run = HtmlRuns.FromHtml($"<{tag}>כותרת</{tag}>").First();
        run.Text.Should().Be("כותרת");
        run.HeadingLevel.Should().Be(level);
        run.Bold.Should().Be(level > 0);
    }

    [Theory]
    [InlineData("x-small", 0.83)]
    [InlineData("xx-small", 0.83)]
    [InlineData("xx-large", 1.17)]
    public void NamedCssSizes_ScaleInheritedFormatting(string size, double scale)
    {
        var run = HtmlRuns.FromHtml($"<b><span style=\"font-size:{size}\">שלום</span></b>").Single();
        run.FontScale.Should().BeApproximately(scale, 0.0001);
        run.Bold.Should().BeTrue();
    }

    [Fact]
    public void UnderflowingNestedSizes_KeepTheLastPositiveSize()
    {
        var run = HtmlRuns.FromHtml("<span style=\"font-size:5e-324em\"><span style=\"font-size:0.1em\">שלום</span></span>").Single();
        run.FontScale.Should().Be(double.Epsilon);
    }

    [Theory]
    [InlineData("fr-FR", "0.5em", 0.5)]
    [InlineData("de-DE", "125.5%", 1.255)]
    public void CssDecimals_AreIndependentOfDeviceCulture(string culture, string size, double expected)
    {
        var previous = CultureInfo.CurrentCulture;
        try
        {
            CultureInfo.CurrentCulture = CultureInfo.GetCultureInfo(culture);
            HtmlRuns.FromHtml($"<span style=\"font-size:{size}\">שלום</span>")
                .Should().ContainSingle().Which.FontScale.Should().BeApproximately(expected, 0.0001);
        }
        finally
        {
            CultureInfo.CurrentCulture = previous;
        }
    }

    [Theory]
    [InlineData("-100%")]
    [InlineData("0em")]
    [InlineData("NaNem")]
    [InlineData("Infinityem")]
    [InlineData("1e999em")]
    [InlineData("bad%")]
    [InlineData("badem")]
    [InlineData("12px")]
    public void InvalidFontSizes_KeepTheInheritedSize(string size)
    {
        var runs = HtmlRuns.FromHtml($"<big><span style=\"font-size:{size}\">שלום</span></big>");
        runs.Should().ContainSingle().Which.FontScale.Should().Be(1.17);
    }

    [Fact]
    public void OverflowingNestedSizes_KeepTheLastFiniteSize()
    {
        var runs = HtmlRuns.FromHtml("<span style=\"font-size:1e200em\"><span style=\"font-size:1e200em\">שלום</span></span>");
        runs.Should().ContainSingle().Which.FontScale.Should().Be(1e200);
    }

    [Theory]
    [InlineData("text-decoration")]
    [InlineData("text-decoration-line")]
    public void CombinedDecoration_PreservesBothStyles(string property)
    {
        var run = HtmlRuns.FromHtml($"<span style=\"{property}:underline line-through\">שלום</span>").Single();
        run.Underline.Should().BeTrue();
        run.Strikethrough.Should().BeTrue();
    }

    [Fact]
    public void EmptyBlocksAndComments_DoNotCreateBlankRuns()
    {
        HtmlRuns.FromHtml("<div> \n </div><!-- comment --><p><i> </i></p>").Should().BeEmpty();
    }
}
