using BibleOnSite.Helpers;
using BibleOnSite.Models;

namespace BibleOnSite.Tests.Helpers;

public class TanahpediaFamilyTests
{
    private static TanahpediaFamilyPerson Person(
        string name,
        string? entry = null,
        string? sex = null,
        string entityId = "e") => new()
    {
        DisplayName = name,
        EntryUniqueName = entry,
        Sex = sex,
        EntityId = entityId,
    };

    [Theory]
    [InlineData("FATHER", "אב")]
    [InlineData("MOTHER", "אם")]
    [InlineData("BIOLOGICAL", "ביולוגי")]
    [InlineData("ADOPTIVE", "אימוץ")]
    [InlineData("STEP", "חורג")]
    [InlineData("MARRIAGE", "נישואין")]
    [InlineData("PILEGESH", "פילגש")]
    [InlineData("BETROTHAL", "אירוסין")]
    [InlineData("FORBIDDEN_WITH_GENTILE", "קשר פסול עם גויה")]
    [InlineData("BANNED_INCEST", "קשר אסור (ערוה)")]
    [InlineData("DEATH", "פטירה")]
    [InlineData("DIVORCE", "גירושין")]
    public void LookupLabels_MapCodes(string code, string expected)
    {
        TanahpediaFamily.ParentRoleLabel(code).Should().BeOneOf(expected, code);
        var all = new[]
        {
            TanahpediaFamily.ParentRoleLabel(code),
            TanahpediaFamily.RelationshipTypeLabel(code),
            TanahpediaFamily.UnionTypeLabel(code),
            TanahpediaFamily.UnionEndReasonLabel(code),
        };
        all.Should().Contain(expected);
    }

    [Fact]
    public void LookupLabels_UnknownCode_PassesThrough()
    {
        TanahpediaFamily.UnionTypeLabel("LEVIRATE").Should().Be("LEVIRATE");
        TanahpediaFamily.ParentRoleLabel(null).Should().BeEmpty();
    }

    [Theory]
    [InlineData(21081215, "2108-12-15")]
    [InlineData(999, "999")]
    public void FormatYyyymmdd_FormatsEightDigitDates(int value, string expected)
    {
        TanahpediaFamily.FormatYyyymmdd(value).Should().Be(expected);
    }

    [Fact]
    public void FormatYyyymmdd_Null_ReturnsNull()
    {
        TanahpediaFamily.FormatYyyymmdd(null).Should().BeNull();
    }

    [Theory]
    [InlineData("MALE", "בנות זוג")]
    [InlineData("FEMALE", "בני זוג")]
    [InlineData(null, "זיווגים")]
    [InlineData("UNKNOWN", "זיווגים")]
    public void SpousesSectionLabel_FollowsFocalSex(string? sex, string expected)
    {
        TanahpediaFamily.SpousesSectionLabel(sex).Should().Be(expected);
    }

    [Theory]
    [InlineData("MALE", "ז")]
    [InlineData("FEMALE", "נ")]
    [InlineData(null, null)]
    [InlineData("UNKNOWN", null)]
    public void SexMark_MapsCodes(string? sex, string? expected)
    {
        TanahpediaFamily.SexMark(sex).Should().Be(expected);
    }

    [Fact]
    public void BuildSections_ParentsOrderFatherFirst()
    {
        var family = new TanahpediaPersonFamily
        {
            Parents =
            [
                new TanahpediaFamilyParentEdge
                {
                    Related = Person("רבקה", sex: "FEMALE"),
                    ParentRole = "MOTHER",
                    RelationshipType = "BIOLOGICAL",
                },
                new TanahpediaFamilyParentEdge
                {
                    Related = Person("יצחק", entry: "יצחק", sex: "MALE"),
                    ParentRole = "FATHER",
                    RelationshipType = "BIOLOGICAL",
                    SourceCitation = "בראשית כה יט",
                },
            ],
        };

        var sections = TanahpediaFamily.BuildSections(family);

        sections.Should().ContainSingle();
        var section = sections[0];
        section.Title.Should().Be("הורים");
        section.Rows.Should().HaveCount(2);
        section.Rows[0].DisplayName.Should().Be("יצחק");
        section.Rows[0].Meta.Should().Be("אב");
        section.Rows[0].IsLink.Should().BeTrue();
        section.Rows[0].EntryUniqueName.Should().Be("יצחק");
        section.Rows[0].SexMark.Should().Be("ז");
        section.Rows[0].SourceCitation.Should().Be("בראשית כה יט");
        section.Rows[1].DisplayName.Should().Be("רבקה");
        section.Rows[1].Meta.Should().Be("אם");
        section.Rows[1].IsLink.Should().BeFalse();
    }

    [Fact]
    public void BuildSections_NonBiologicalParent_ShowsRelationship()
    {
        var family = new TanahpediaPersonFamily
        {
            Parents =
            [
                new TanahpediaFamilyParentEdge
                {
                    Related = Person("אברם"),
                    ParentRole = "FATHER",
                    RelationshipType = "STEP",
                },
            ],
        };

        var row = TanahpediaFamily.BuildSections(family)[0].Rows[0];

        row.Meta.Should().Be("אב · חורג");
    }

    [Fact]
    public void BuildSections_SpousesOrderedByUnionOrderWithMeta()
    {
        var family = new TanahpediaPersonFamily
        {
            FocalSex = "MALE",
            Spouses =
            [
                new TanahpediaFamilySpouseEdge
                {
                    Related = Person("רחל", entry: "רחל"),
                    UnionType = "MARRIAGE",
                    UnionOrder = 2,
                    UnionEndReason = "DEATH",
                },
                new TanahpediaFamilySpouseEdge
                {
                    Related = Person("לאה"),
                    UnionType = "MARRIAGE",
                    UnionOrder = 1,
                    SourceCitation = "בראשית כט כג",
                },
            ],
        };

        var sections = TanahpediaFamily.BuildSections(family);

        var section = sections.Should().ContainSingle().Subject;
        section.Title.Should().Be("בנות זוג");
        section.Rows[0].DisplayName.Should().Be("לאה");
        section.Rows[0].Meta.Should().Be("נישואין");
        section.Rows[0].SourceCitation.Should().Be("בראשית כט כג");
        section.Rows[1].DisplayName.Should().Be("רחל");
        section.Rows[1].Meta.Should().Be("נישואין · פטירה");
    }

    [Fact]
    public void BuildSections_SpouseMeta_IncludesEndDates()
    {
        var family = new TanahpediaPersonFamily
        {
            Spouses =
            [
                new TanahpediaFamilySpouseEdge
                {
                    Related = Person("מרי"),
                    UnionType = "PILEGESH",
                    UnionEndReason = "DIVORCE",
                    UnionStartDate = 29000101,
                    UnionEndDate = 29150101,
                },
            ],
        };

        var row = TanahpediaFamily.BuildSections(family)[0].Rows[0];

        row.Meta.Should().Be("פילגש · התחלה 2900-01-01 · גירושין 2915-01-01");
    }

    [Fact]
    public void BuildSections_SpouseMeta_OngoingUnion_ShowsStartDate()
    {
        var family = new TanahpediaPersonFamily
        {
            Spouses =
            [
                new TanahpediaFamilySpouseEdge
                {
                    Related = Person("לאה"),
                    UnionType = "MARRIAGE",
                    UnionStartDate = 29000101,
                },
            ],
        };

        var row = TanahpediaFamily.BuildSections(family)[0].Rows[0];

        // A live union has no end reason — the start date must still surface.
        row.Meta.Should().Be("נישואין · התחלה 2900-01-01");
    }

    [Fact]
    public void BuildSections_SpouseMeta_EndDateWithoutReason_UsesGenericEnd()
    {
        var family = new TanahpediaPersonFamily
        {
            Spouses =
            [
                new TanahpediaFamilySpouseEdge
                {
                    Related = Person("לאה"),
                    UnionType = "MARRIAGE",
                    UnionEndDate = 29150101,
                },
            ],
        };

        var row = TanahpediaFamily.BuildSections(family)[0].Rows[0];

        row.Meta.Should().Be("נישואין · סיום 2915-01-01");
    }

    [Fact]
    public void BuildSections_SpouseCitations_UnionAndPersonKeptSeparate()
    {
        var family = new TanahpediaPersonFamily
        {
            Spouses =
            [
                new TanahpediaFamilySpouseEdge
                {
                    Related = Person("רחל"),
                    UnionType = "MARRIAGE",
                    SourceCitation = "בראשית כט כח",
                    PersonSourceCitation = "בראשית כט ו",
                },
            ],
        };

        var row = TanahpediaFamily.BuildSections(family)[0].Rows[0];

        // SourceCitation stays the union/marriage citation; the spouse's own
        // (e.g. birth-verse) citation renders separately — it must not replace it.
        row.SourceCitation.Should().Be("בראשית כט כח");
        row.PersonSourceCitation.Should().Be("בראשית כט ו");
    }

    [Fact]
    public void BuildSections_ChildrenGroupedByCoParent()
    {
        var family = new TanahpediaPersonFamily
        {
            Children =
            [
                new TanahpediaFamilyChildEdge
                {
                    Related = Person("יוסף", entityId: "e-yosef"),
                    RelationshipType = "BIOLOGICAL",
                    BirthOrder = 11,
                    CoParentEntityId = "e-rachel",
                    CoParentDisplayName = "רחל",
                    CoParentUnionOrder = 2,
                },
                new TanahpediaFamilyChildEdge
                {
                    Related = Person("ראובן", entityId: "e-reuven"),
                    RelationshipType = "BIOLOGICAL",
                    BirthOrder = 1,
                    CoParentEntityId = "e-leah",
                    CoParentDisplayName = "לאה",
                    CoParentUnionOrder = 1,
                },
                new TanahpediaFamilyChildEdge
                {
                    Related = Person("בנימין", entityId: "e-binyamin"),
                    RelationshipType = "BIOLOGICAL",
                    BirthOrder = 12,
                    CoParentEntityId = "e-rachel",
                    CoParentDisplayName = "רחל",
                    CoParentUnionOrder = 2,
                },
            ],
        };

        var sections = TanahpediaFamily.BuildSections(family);

        sections.Should().HaveCount(2);
        // לאה's union order (1) sorts her group before רחל's (2).
        sections[0].Title.Should().Be("ילדים מ-לאה");
        sections[0].Rows.Should().ContainSingle().Which.DisplayName.Should().Be("ראובן");
        sections[1].Title.Should().Be("ילדים מ-רחל");
        sections[1].Rows.Select(r => r.DisplayName).Should().Equal("יוסף", "בנימין");
    }

    [Fact]
    public void BuildSections_ChildrenWithoutCoParent_PlainTitle()
    {
        var family = new TanahpediaPersonFamily
        {
            Children =
            [
                new TanahpediaFamilyChildEdge
                {
                    Related = Person("קין"),
                    RelationshipType = "BIOLOGICAL",
                },
            ],
        };

        var sections = TanahpediaFamily.BuildSections(family);

        sections.Should().ContainSingle().Which.Title.Should().Be("ילדים");
    }

    [Fact]
    public void BuildSections_ChildrenMixedCoParent_MarksUnknownGroup()
    {
        var family = new TanahpediaPersonFamily
        {
            Children =
            [
                new TanahpediaFamilyChildEdge
                {
                    Related = Person("יוסף", entityId: "e1"),
                    RelationshipType = "BIOLOGICAL",
                    CoParentEntityId = "e-rachel",
                    CoParentDisplayName = "רחל",
                },
                new TanahpediaFamilyChildEdge
                {
                    Related = Person("דנה", entityId: "e2"),
                    RelationshipType = "BIOLOGICAL",
                },
            ],
        };

        var sections = TanahpediaFamily.BuildSections(family);

        sections.Select(s => s.Title).Should()
            .Contain("ילדים מ-רחל")
            .And.Contain("ילדים (בת זוג לא מזוהה בנתונים)");
    }

    [Fact]
    public void BuildSections_SiblingsSplitByBirthDate()
    {
        var family = new TanahpediaPersonFamily
        {
            FocalBirthYyyymmdd = 21000101,
            Siblings =
            [
                new TanahpediaFamilySibling { DisplayName = "בכור", BirthDateYyyymmdd = 20900101 },
                new TanahpediaFamilySibling { DisplayName = "צעיר", BirthDateYyyymmdd = 21100101 },
                new TanahpediaFamilySibling { DisplayName = "לא ידוע" },
            ],
        };

        var sections = TanahpediaFamily.BuildSections(family);

        sections.Should().HaveCount(2);
        sections[0].Title.Should().Be("אחים מבוגרים");
        sections[0].Rows.Should().ContainSingle().Which.DisplayName.Should().Be("בכור");
        sections[1].Title.Should().Be("אחים צעירים");
        // Younger + unknown-merge into one alphabetic cluster.
        sections[1].Rows.Select(r => r.DisplayName).Should().Equal("לא ידוע", "צעיר");
    }

    [Fact]
    public void BuildSections_SiblingsWithoutSplit_SingleGenericSection()
    {
        var family = new TanahpediaPersonFamily
        {
            Siblings =
            [
                new TanahpediaFamilySibling { DisplayName = "עשו" },
                new TanahpediaFamilySibling { DisplayName = "לאה" },
            ],
        };

        var sections = TanahpediaFamily.BuildSections(family);

        sections.Should().ContainSingle().Which.Title.Should().Be("אחים");
        sections[0].Rows.Select(r => r.DisplayName).Should().Equal("לאה", "עשו");
    }

    [Fact]
    public void BuildSections_SiblingsOnlyOlder_SingleGenericSection()
    {
        var family = new TanahpediaPersonFamily
        {
            FocalBirthYyyymmdd = 21000101,
            Siblings =
            [
                new TanahpediaFamilySibling { DisplayName = "עשו", BirthDateYyyymmdd = 20900101 },
            ],
        };

        var sections = TanahpediaFamily.BuildSections(family);

        sections.Should().ContainSingle().Which.Title.Should().Be("אחים");
    }

    [Fact]
    public void BuildSections_RepeatEdgesInOneOpinionGroup_MarkInterpretationOrdinals()
    {
        // Two union edges for the SAME partner inside ONE alt group are
        // interpretations of that relationship — the website's שיטה א'/ב'.
        var family = new TanahpediaPersonFamily
        {
            Spouses =
            [
                new TanahpediaFamilySpouseEdge
                {
                    Related = Person("אישה", entityId: "e-wife"),
                    UnionType = "MARRIAGE",
                    AltGroupId = "alt-1",
                },
                new TanahpediaFamilySpouseEdge
                {
                    Related = Person("אישה", entityId: "e-wife"),
                    UnionType = "PILEGESH",
                    AltGroupId = "alt-1",
                },
            ],
        };

        var rows = TanahpediaFamily.BuildSections(family)[0].Rows;

        rows.Should().HaveCount(2);
        rows[0].Meta.Should().Be("חלופי · שיטה א' · נישואין");
        rows[1].Meta.Should().Be("חלופי · שיטה ב' · פילגש");
    }

    [Fact]
    public void BuildSections_SamePartnerAcrossAltGroups_SeparateAlternatives()
    {
        // Same partner modeled by two competing opinion groups — two separate
        // alternatives, not interpretations: no ordinals, each marked חלופי.
        var family = new TanahpediaPersonFamily
        {
            Spouses =
            [
                new TanahpediaFamilySpouseEdge
                {
                    Related = Person("אישה", entityId: "e-wife"),
                    UnionType = "MARRIAGE",
                    AltGroupId = "alt-1",
                },
                new TanahpediaFamilySpouseEdge
                {
                    Related = Person("אישה", entityId: "e-wife"),
                    UnionType = "PILEGESH",
                    AltGroupId = "alt-2",
                },
            ],
        };

        var rows = TanahpediaFamily.BuildSections(family)[0].Rows;

        rows.Should().HaveCount(2);
        rows[0].Meta.Should().Be("חלופי · נישואין");
        rows[1].Meta.Should().Be("חלופי · פילגש");
    }

    [Fact]
    public void BuildSections_AlternativeSpouses_MarkedAsAlternatives()
    {
        // Competing models pick different partners — never displayed as
        // simultaneous wives.
        var family = new TanahpediaPersonFamily
        {
            Spouses =
            [
                new TanahpediaFamilySpouseEdge
                {
                    Related = Person("לאה", entityId: "e-leah"),
                    UnionType = "MARRIAGE",
                    UnionOrder = 1,
                },
                new TanahpediaFamilySpouseEdge
                {
                    Related = Person("רחל", entityId: "e-rachel"),
                    UnionType = "MARRIAGE",
                    UnionOrder = 2,
                    AltGroupId = "alt-1",
                },
                new TanahpediaFamilySpouseEdge
                {
                    Related = Person("בלהה", entityId: "e-bilhah"),
                    UnionType = "MARRIAGE",
                    UnionOrder = 3,
                    AltGroupId = "alt-2",
                },
            ],
        };

        var rows = TanahpediaFamily.BuildSections(family)[0].Rows;

        rows.Should().HaveCount(3);
        rows[0].DisplayName.Should().Be("לאה");
        rows[0].Meta.Should().Be("נישואין");
        rows[1].DisplayName.Should().Be("רחל");
        rows[1].Meta.Should().Be("חלופי · נישואין");
        rows[2].DisplayName.Should().Be("בלהה");
        rows[2].Meta.Should().Be("חלופי · נישואין");
    }

    [Fact]
    public void BuildSections_MarriageAndForbiddenPair_FusedIntoInterpretations()
    {
        // The website fuses a canonical נישואין with a same-partner,
        // same-union-order קשר פסול עם גויה edge — even across alt groups —
        // into one partner card with interpretations.
        var family = new TanahpediaPersonFamily
        {
            Spouses =
            [
                new TanahpediaFamilySpouseEdge
                {
                    Related = Person("אישה", entityId: "e-wife"),
                    UnionType = "MARRIAGE",
                    UnionOrder = 1,
                },
                new TanahpediaFamilySpouseEdge
                {
                    Related = Person("אישה", entityId: "e-wife"),
                    UnionType = "FORBIDDEN_WITH_GENTILE",
                    UnionOrder = 1,
                    AltGroupId = "alt-1",
                },
            ],
        };

        var rows = TanahpediaFamily.BuildSections(family)[0].Rows;

        rows.Should().HaveCount(2);
        // One partner, two interpretations — the canonical marriage edge stays
        // unmarked; only the alternative model's edge is flagged חלופי.
        rows[0].Meta.Should().Be("שיטה א' · נישואין");
        rows[1].Meta.Should().Be("חלופי · שיטה ב' · קשר פסול עם גויה");
    }

    [Fact]
    public void BuildSections_AlternativeParents_MarkedAsAlternatives()
    {
        // A child with two alternative fathers on distinct alt groups —
        // the canonical block first, alternatives marked חלופי.
        var family = new TanahpediaPersonFamily
        {
            Parents =
            [
                new TanahpediaFamilyParentEdge
                {
                    Related = Person("אבי-א", entityId: "e-father-a"),
                    ParentRole = "FATHER",
                    RelationshipType = "BIOLOGICAL",
                },
                new TanahpediaFamilyParentEdge
                {
                    Related = Person("אבי-ב", entityId: "e-father-b"),
                    ParentRole = "FATHER",
                    RelationshipType = "BIOLOGICAL",
                    AltGroupId = "alt-1",
                },
                new TanahpediaFamilyParentEdge
                {
                    Related = Person("אבי-ג", entityId: "e-father-c"),
                    ParentRole = "FATHER",
                    RelationshipType = "BIOLOGICAL",
                    AltGroupId = "alt-2",
                },
            ],
        };

        var rows = TanahpediaFamily.BuildSections(family)[0].Rows;

        rows.Should().HaveCount(3);
        rows[0].Meta.Should().Be("אב");
        rows[1].Meta.Should().Be("חלופי · אב");
        rows[2].Meta.Should().Be("חלופי · אב");
    }

    [Fact]
    public void BuildSections_AlternativeChildren_MarkedAsAlternatives()
    {
        var family = new TanahpediaPersonFamily
        {
            Children =
            [
                new TanahpediaFamilyChildEdge
                {
                    Related = Person("בן-א", entityId: "e-son-a"),
                    RelationshipType = "BIOLOGICAL",
                },
                new TanahpediaFamilyChildEdge
                {
                    Related = Person("בן-ב", entityId: "e-son-b"),
                    RelationshipType = "BIOLOGICAL",
                    AltGroupId = "alt-1",
                },
            ],
        };

        // Each opinion block is its own section — canonical first, the
        // alternative block flagged חלופי in its title (website parity).
        var sections = TanahpediaFamily.BuildSections(family);

        sections.Should().HaveCount(2);
        sections[0].Title.Should().Be("ילדים");
        sections[0].Rows.Should().ContainSingle().Which.DisplayName.Should().Be("בן-א");
        sections[1].Title.Should().Be("חלופי · ילדים");
        sections[1].Rows.Should().ContainSingle().Which.DisplayName.Should().Be("בן-ב");
    }

    [Fact]
    public void BuildSections_EmptyFamily_NoSections()
    {
        TanahpediaFamily.BuildSections(new TanahpediaPersonFamily()).Should().BeEmpty();
    }

    [Fact]
    public void BuildSections_SectionOrder_ParentsSpousesChildrenSiblings()
    {
        var family = new TanahpediaPersonFamily
        {
            Parents = [new TanahpediaFamilyParentEdge { Related = Person("אב"), ParentRole = "FATHER" }],
            Spouses = [new TanahpediaFamilySpouseEdge { Related = Person("אשה"), UnionType = "MARRIAGE" }],
            Children = [new TanahpediaFamilyChildEdge { Related = Person("בן"), RelationshipType = "BIOLOGICAL" }],
            Siblings = [new TanahpediaFamilySibling { DisplayName = "אח" }],
        };

        var sections = TanahpediaFamily.BuildSections(family);

        sections.Select(s => s.Title).Should().Equal("הורים", "זיווגים", "ילדים", "אחים");
    }
}
