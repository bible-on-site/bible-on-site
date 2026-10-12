using BibleOnSite.Models;

namespace BibleOnSite.Tests.Models;

public class TanahpediaModelsTests
{
    [Fact]
    public void Taxonomy_TopLevelKeysMatchWebsite()
    {
        TanahpediaTaxonomy.Hierarchy
            .Select(c => c.Key)
            .Should().Equal(
                "PERSON", "PLACE", "EVENT", "SAYING", "OBJECT",
                "ANIMAL", "PLANT", "SEFER", "NATION");
    }

    [Fact]
    public void Taxonomy_KeysAreUnique()
    {
        TanahpediaTaxonomy.All.Select(c => c.Key).Should().OnlyHaveUniqueItems();
    }

    [Fact]
    public void Taxonomy_SubcategoryQueryContract()
    {
        // Person roles and animal kinds/purities filter the base entity type
        // through `sub`; every other category queries its own entity type.
        foreach (var category in TanahpediaTaxonomy.All)
        {
            if (category.Sub is null)
            {
                category.EntityType.Should().Be(category.Key, $"plain category {category.Key} queries itself");
            }
            else
            {
                new[] { "PERSON", "ANIMAL" }.Should()
                    .Contain(category.EntityType, $"only PERSON/ANIMAL have sub filters ({category.Key})");
            }
        }
    }

    [Fact]
    public void Taxonomy_FindCoversTopLevelAndChildren()
    {
        TanahpediaTaxonomy.Find("PERSON")!.Label.Should().Be("אישים");
        TanahpediaTaxonomy.Find("KING")!.Label.Should().Be("מלכים");
        TanahpediaTaxonomy.Find("KING")!.Sub.Should().Be("KING");
        TanahpediaTaxonomy.Find("TAHOR")!.EntityType.Should().Be("ANIMAL");
        TanahpediaTaxonomy.Find("PERSON")!.HasChildren.Should().BeTrue();
        TanahpediaTaxonomy.Find("NATION")!.HasChildren.Should().BeFalse();
    }

    [Fact]
    public void Taxonomy_Find_ReturnsNullForNullOrUnknown()
    {
        TanahpediaTaxonomy.Find(null).Should().BeNull();
        TanahpediaTaxonomy.Find("NOPE").Should().BeNull();
    }

    [Fact]
    public void Taxonomy_LabelFor_ReturnsEmptyForNull()
    {
        TanahpediaTaxonomy.LabelFor(null).Should().BeEmpty();
    }

    [Theory]
    [InlineData("WAR", "מלחמות")]
    [InlineData("TANAH_SEFER", "ספרי תנ\"ך")]
    [InlineData("UNKNOWN_KEY", "UNKNOWN_KEY")]
    public void Taxonomy_LabelFor_ReturnsLabelOrKey(string key, string expected)
    {
        TanahpediaTaxonomy.LabelFor(key).Should().Be(expected);
    }

    [Fact]
    public void ForListing_NoEntries_ShowsBadge()
    {
        var item = TanahpediaEntityItem.ForListing(new TanahpediaEntityWithEntries
        {
            EntityName = "דתן",
            EntityType = "PERSON",
        });

        item.ShowNamePlain.Should().BeTrue();
        item.ShowNoEntryBadge.Should().BeTrue();
        item.IsSingleLink.Should().BeFalse();
        item.ShowLinks.Should().BeFalse();
    }

    [Fact]
    public void ForListing_OneEntry_NameBecomesLink()
    {
        var item = TanahpediaEntityItem.ForListing(new TanahpediaEntityWithEntries
        {
            EntityName = "שמשון",
            LinkedEntries = [Stub("שמשון", "שמשון הגיבור")],
        });

        item.IsSingleLink.Should().BeTrue();
        item.SingleUniqueName.Should().Be("שמשון");
        item.ShowNamePlain.Should().BeFalse();
        item.ShowNoEntryBadge.Should().BeFalse();
    }

    [Fact]
    public void ForListing_ManyEntries_NamePlusBracketedLinks()
    {
        var item = TanahpediaEntityItem.ForListing(new TanahpediaEntityWithEntries
        {
            EntityName = "דתן",
            LinkedEntries = [Stub("דתן", "דתן"), Stub("דתן-ואבירם", "דתן ואבירם")],
        });

        item.ShowNamePlain.Should().BeTrue();
        item.ShowLinks.Should().BeTrue();
        item.Links.Should().HaveCount(2);
        item.Links[0].Prefix.Should().Be(" [");
        item.Links[0].Suffix.Should().BeEmpty();
        item.Links[1].Prefix.Should().Be(", ");
        item.Links[1].Suffix.Should().Be("]");
    }

    [Fact]
    public void ForToday_NoEntries_PlainNameNoBadge()
    {
        var item = TanahpediaEntityItem.ForToday(new TanahpediaEntityWithEntries
        {
            EntityName = "מתתיהו",
        });

        item.ShowNamePlain.Should().BeTrue();
        item.ShowNoEntryBadge.Should().BeFalse();
        item.ShowLinks.Should().BeFalse();
    }

    [Fact]
    public void ForToday_WithEntries_SlashSeparatedLinks()
    {
        var item = TanahpediaEntityItem.ForToday(new TanahpediaEntityWithEntries
        {
            EntityName = "מתתיהו",
            LinkedEntries = [Stub("a", "ערך א"), Stub("b", "ערך ב")],
        });

        item.ShowNamePlain.Should().BeFalse();
        item.ShowLinks.Should().BeTrue();
        item.Links[0].Prefix.Should().BeEmpty();
        item.Links[1].Prefix.Should().Be(" / ");
    }

    private static TanahpediaEntryStub Stub(string uniqueName, string title) => new()
    {
        Id = uniqueName,
        UniqueName = uniqueName,
        Title = title,
    };
}
