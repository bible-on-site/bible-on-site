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

    [Fact]
    public void ImageLink_CaptionText_JoinsCaptionAndCredit()
    {
        var link = new TanahpediaImageLink
        {
            Image = new TanahpediaImage
            {
                Caption = "שמשון הגיבור",
                CreditLine = "Wikimedia Commons",
            },
        };

        link.CaptionText.Should().Be("שמשון הגיבור · Wikimedia Commons");
    }

    [Fact]
    public void ImageLink_CaptionText_FallsBackToCreditThenNull()
    {
        // No caption → the concise credit alone (creditLine, else creator,
        // else source name); nothing at all → null hides the line.
        new TanahpediaImageLink
        {
            Image = new TanahpediaImage { CreditLine = "קרדיט" },
        }.CaptionText.Should().Be("קרדיט");
        new TanahpediaImageLink
        {
            Image = new TanahpediaImage { Creator = "אמן" },
        }.CaptionText.Should().Be("אמן");
        new TanahpediaImageLink
        {
            Image = new TanahpediaImage { SourceName = "מקור" },
        }.CaptionText.Should().Be("מקור");
        new TanahpediaImageLink().CaptionText.Should().BeNull();
    }

    [Fact]
    public void ImageLink_AttributionText_ListedProvenanceAndPublicDomain()
    {
        var link = new TanahpediaImageLink
        {
            Image = new TanahpediaImage
            {
                Creator = "אמן",
                SourceName = "Wikimedia Commons",
                LicenseName = "CC BY-SA 4.0",
                Modifications = "חיתוך",
            },
        };

        link.AttributionText.Should().Be(
            "יוצר/צלם: אמן · מקור: Wikimedia Commons · רישיון: CC BY-SA 4.0 · שינויים: חיתוך");

        // Public domain replaces the license line — the public-domain /
        // license distinction the issue requires.
        new TanahpediaImageLink
        {
            Image = new TanahpediaImage { IsPublicDomain = true },
        }.AttributionText.Should().Be("רישיון: נחלת הכלל");
        new TanahpediaImageLink().AttributionText.Should().BeNull();
    }

    [Fact]
    public void ImageLink_AttributionText_LicenseUrlOnly_KeepsLinkDiscoverable()
    {
        var link = new TanahpediaImageLink
        {
            Image = new TanahpediaImage
            {
                LicenseUrl = "https://creativecommons.org/licenses/by-sa/4.0/",
            },
        };

        // The URL itself is the actionable evidence, but the expandable row
        // and the disclosure visibility need a non-empty Hebrew caption.
        link.Image.HasLicenseLink.Should().BeTrue();
        link.Image.LicenseDisplay.Should().Be("קישור לרישיון");
        link.AttributionText.Should().Be("רישיון: קישור לרישיון");
    }

    [Fact]
    public void Image_RightsAndSourceFlags_CoverEachCombination()
    {
        new TanahpediaImage { IsPublicDomain = true, LicenseUrl = "https://x" }
            .LicenseDisplay.Should().Be("נחלת הכלל");
        new TanahpediaImage().LicenseDisplay.Should().BeNull();

        var withUrl = new TanahpediaImage { SourceUrl = "https://x" };
        withUrl.HasSourceLink.Should().BeTrue();
        withUrl.HasPlainSource.Should().BeFalse();

        var namedOnly = new TanahpediaImage { SourceName = "מקור" };
        namedOnly.HasSourceLink.Should().BeFalse();
        namedOnly.HasPlainSource.Should().BeTrue();

        // A license URL under a public-domain flag is not a linkable license.
        new TanahpediaImage { IsPublicDomain = true, LicenseUrl = "https://x" }
            .HasLicenseLink.Should().BeFalse();
        new TanahpediaImage { LicenseName = "CC" }
            .HasPlainLicense.Should().BeTrue();
        new TanahpediaImage { IsPublicDomain = true }
            .HasPlainLicense.Should().BeTrue();
        new TanahpediaImage().HasPlainLicense.Should().BeFalse();
    }

    [Fact]
    public void ImageLink_AttributionText_FallsBackToSourceUrl()
    {
        new TanahpediaImageLink
        {
            Image = new TanahpediaImage { SourceUrl = "https://x" },
        }.AttributionText.Should().Be("מקור: https://x");
    }

    [Fact]
    public void ImageLink_CaptionText_TreatsEmptyStringsAsAbsent()
    {
        new TanahpediaImageLink
        {
            Image = new TanahpediaImage { Caption = "", CreditLine = "קרדיט" },
        }.CaptionText.Should().Be("קרדיט");
        new TanahpediaImageLink
        {
            Image = new TanahpediaImage { Caption = "כיתוב", CreditLine = "" },
        }.CaptionText.Should().Be("כיתוב");
    }

    private static TanahpediaEntryStub Stub(string uniqueName, string title) => new()
    {
        Id = uniqueName,
        UniqueName = uniqueName,
        Title = title,
    };
}
