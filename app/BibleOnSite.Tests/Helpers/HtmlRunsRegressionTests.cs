using System.Globalization;
using BibleOnSite.Helpers;
using FluentAssertions;

namespace BibleOnSite.Tests.Helpers;

public class HtmlRunsRegressionTests
{
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
