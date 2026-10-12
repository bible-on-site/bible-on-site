using System.Text;
using BibleOnSite.Helpers;

namespace BibleOnSite.Tests.Helpers;

public class TanahpediaLinksTests
{
    [Theory]
    [InlineData("/pedia/אברהם", "אברהם")]
    [InlineData("pedia/אברהם", "אברהם")]
    [InlineData("https://bibleon-site.web.app/pedia/רחל", "רחל")]
    [InlineData("/pedia/%D7%90%D7%91%D7%A8%D7%94%D7%9D", "אברהם")]
    [InlineData("/pedia/אברהם?x=1#frag", "אברהם")]
    public void TryGetEntryUniqueName_DecodesPediaLinks(string url, string expected)
    {
        TanahpediaLinks.TryGetEntryUniqueName(url, out var uniqueName).Should().BeTrue();
        uniqueName.Should().Be(expected);
    }

    [Theory]
    [InlineData("/category/אישים")]
    [InlineData("/other/אברהם")]
    [InlineData("https://example.com/articles/1")]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData("/pedia/")]
    public void TryGetEntryUniqueName_RejectsNonPediaLinks(string? url)
    {
        TanahpediaLinks.TryGetEntryUniqueName(url, out _).Should().BeFalse();
    }

    [Fact]
    public void TryGetEntryUniqueName_NormalizesNfc()
    {
        // Same name composed vs decomposed must resolve to the same slug,
        // matching the website's normalize('NFC') param handling.
        var composed = TanahpediaLinks.TryGetEntryUniqueName("/pedia/שָׁלֹם", out var a);
        var decomposed = TanahpediaLinks.TryGetEntryUniqueName("/pedia/שָׁלֹם".Normalize(NormalizationForm.FormD), out var b);
        composed.Should().BeTrue();
        decomposed.Should().BeTrue();
        a.Should().Be(b);
        a.Should().Be("שָׁלֹם".Normalize());
    }

    [Fact]
    public void TryGetEntryUniqueName_SurvivesMalformedEscapes()
    {
        TanahpediaLinks.TryGetEntryUniqueName("/pedia/%zz-entry", out var uniqueName)
            .Should().BeTrue();
        uniqueName.Should().Be("%zz-entry");
    }
}
