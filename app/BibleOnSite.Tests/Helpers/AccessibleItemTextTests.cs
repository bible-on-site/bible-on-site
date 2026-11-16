using BibleOnSite.Helpers;

namespace BibleOnSite.Tests.Helpers;

/// <summary>
/// Narrator names for Windows CollectionView rows (#2766) are composed from
/// the row's visible text — never the CLR item wrapper type name.
/// </summary>
public class AccessibleItemTextTests
{
    [Fact]
    public void Compose_JoinsVisibleParts()
    {
        AccessibleItemText.Compose(["א", "וַיַּגֵּד אַחְאָב לְאִיזֶבֶל"])
            .Should().Be("א, וַיַּגֵּד אַחְאָב לְאִיזֶבֶל");
    }

    [Fact]
    public void Compose_DropsIconFontGlyphsAndEmptyParts()
    {
        AccessibleItemText.Compose(["\uE70D", null, "  ", "מאמרים", "\U000F0001"])
            .Should().Be("מאמרים");
    }

    [Fact]
    public void Compose_CollapsesWhitespaceAndKeepsCantillation()
    {
        AccessibleItemText.Compose(["  וַיֹּ֣אמֶר \n\t ה֑'  "])
            .Should().Be("וַיֹּ֣אמֶר ה֑'");
    }

    [Fact]
    public void Compose_NothingVisible_IsEmpty()
    {
        AccessibleItemText.Compose(["\uE70D"]).Should().BeEmpty();
    }

    [Theory]
    [InlineData("Microsoft.Maui.Controls.Platform.ItemTemplateContext")]
    [InlineData("BibleOnSite.Models.PasukDisplayItem")]
    [InlineData("BibleOnSite.Models.MoedUnit")]
    public void IsClrTypeName_FrameworkNames_AreRejected(string name)
    {
        AccessibleItemText.IsClrTypeName(name).Should().BeTrue(
            "the framework stamps the item wrapper's CLR name on row containers — Narrator must never read it");
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("וַיֹּאמֶר")]
    [InlineData("א, וַיַּגֵּד אַחְאָב לְאִיזֶבֶל")]
    [InlineData("מאמרים")]
    [InlineData("Article card")]
    [InlineData("1.2.3")]
    public void IsClrTypeName_ReadableText_IsKept(string? name)
    {
        AccessibleItemText.IsClrTypeName(name).Should().BeFalse(
            "authored names contain spaces or Hebrew and must survive the filter");
    }
}
