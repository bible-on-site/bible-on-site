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

    private static IEnumerable<string> RibbonTexts(
        TanahpediaFamilyCardStack stack,
        TanahpediaFamilyRibbonKind kind) =>
        stack.Ribbons.Where(line => line.Kind == kind).Select(line => line.Text);

    private static IEnumerable<string> AllRibbonTexts(TanahpediaFamilyCardStack stack) =>
        stack.Ribbons.Select(line => line.Text);

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
    public void BuildTree_NoRelatives_ReturnsNull()
    {
        TanahpediaFamily.BuildTree(new TanahpediaPersonFamily()).Should().BeNull();
    }

    [Fact]
    public void BuildTree_ParentsOrderFatherFirst()
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

        var tree = TanahpediaFamily.BuildTree(family)!;

        var group = tree.ParentGroups.Should().ContainSingle().Subject;
        group.Labels.Should().BeEmpty();
        group.Stacks.Should().HaveCount(2);
        var father = group.Stacks[0];
        father.Card.DisplayName.Should().Be("יצחק");
        RibbonTexts(father, TanahpediaFamilyRibbonKind.Main).Should().Equal("אב");
        father.Card.IsLink.Should().BeTrue();
        father.Card.EntryUniqueName.Should().Be("יצחק");
        father.Card.SexMark.Should().Be("ז");
        var mother = group.Stacks[1];
        mother.Card.DisplayName.Should().Be("רבקה");
        RibbonTexts(mother, TanahpediaFamilyRibbonKind.Main).Should().Equal("אם");
        mother.Card.IsLink.Should().BeFalse();
        // The parent-edge citation surfaces on the focal card - the website's
        // parentSourceCitation - not on the parent cards.
        tree.Focal.CardCitations.Should().Equal("בראשית כה יט");
        father.Card.CardCitations.Should().BeEmpty();
    }

    [Fact]
    public void BuildTree_NonBiologicalParent_RibbonShowsRelationship()
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

        var stack = TanahpediaFamily.BuildTree(family)!.ParentGroups[0].Stacks[0];

        RibbonTexts(stack, TanahpediaFamilyRibbonKind.Main).Should().Equal("אב · חורג");
    }

    [Fact]
    public void BuildTree_SpousesOrderedByUnionOrderWithRibbons()
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

        var tree = TanahpediaFamily.BuildTree(family)!;

        tree.SpousesLabel.Should().Be("בנות זוג");
        tree.SpouseUnits.Should().HaveCount(2);
        var leah = tree.SpouseUnits[0].Spouse;
        leah.Card.DisplayName.Should().Be("לאה");
        RibbonTexts(leah, TanahpediaFamilyRibbonKind.Main).Should().Equal("נישואין");
        RibbonTexts(leah, TanahpediaFamilyRibbonKind.Citation).Should().Equal("בראשית כט כג");
        RibbonTexts(leah, TanahpediaFamilyRibbonKind.Meta).Should().Equal("סדר 1");
        var rachel = tree.SpouseUnits[1].Spouse;
        rachel.Card.DisplayName.Should().Be("רחל");
        RibbonTexts(rachel, TanahpediaFamilyRibbonKind.Main).Should().Equal("נישואין");
        RibbonTexts(rachel, TanahpediaFamilyRibbonKind.Meta).Should()
            .Equal("סדר 2", "פטירה");
    }

    [Fact]
    public void BuildTree_SpouseTimeline_IncludesEndDates()
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

        var stack = TanahpediaFamily.BuildTree(family)!.SpouseUnits[0].Spouse;

        RibbonTexts(stack, TanahpediaFamilyRibbonKind.Main).Should().Equal("פילגש");
        RibbonTexts(stack, TanahpediaFamilyRibbonKind.Meta).Should()
            .Equal("התחלה 2900-01-01 · גירושין 2915-01-01");
        // A single partner gets no "סדר N" ribbon.
        RibbonTexts(stack, TanahpediaFamilyRibbonKind.Meta)
            .Should().NotContain(text => text.StartsWith("סדר"));
    }

    [Fact]
    public void BuildTree_SpouseTimeline_OngoingUnion_ShowsStartDate()
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

        var stack = TanahpediaFamily.BuildTree(family)!.SpouseUnits[0].Spouse;

        // A live union has no end reason - the start date must still surface.
        RibbonTexts(stack, TanahpediaFamilyRibbonKind.Meta).Should().Equal("התחלה 2900-01-01");
    }

    [Fact]
    public void BuildTree_SpouseTimeline_EndDateWithoutReason_UsesGenericEnd()
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

        var stack = TanahpediaFamily.BuildTree(family)!.SpouseUnits[0].Spouse;

        RibbonTexts(stack, TanahpediaFamilyRibbonKind.Meta).Should().Equal("סיום 2915-01-01");
    }

    [Fact]
    public void BuildTree_SpouseCitations_UnionAndPersonKeptSeparate()
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

        var stack = TanahpediaFamily.BuildTree(family)!.SpouseUnits[0].Spouse;

        // The union/marriage citation stays a ribbon; the spouse's own (e.g.
        // birth-verse) citation renders inside the card - it must not replace it.
        RibbonTexts(stack, TanahpediaFamilyRibbonKind.Citation).Should().Equal("בראשית כט כח");
        stack.Card.CardCitations.Should().Equal("בראשית כט ו");
    }

    [Fact]
    public void BuildTree_ChildrenGroupedByCoParent()
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

        var tree = TanahpediaFamily.BuildTree(family)!;

        tree.ChildGroups.Should().HaveCount(2);
        // לאה's union order (1) sorts her bucket before רחל's (2).
        tree.ChildGroups[0].Labels.Should().Equal("ילדים מ-לאה");
        tree.ChildGroups[0].Stacks.Should().ContainSingle().Which.Card.DisplayName.Should().Be("ראובן");
        tree.ChildGroups[1].Labels.Should().Equal("ילדים מ-רחל");
        tree.ChildGroups[1].Stacks.Select(s => s.Card.DisplayName).Should().Equal("יוסף", "בנימין");
    }

    [Fact]
    public void BuildTree_ChildrenWithoutCoParent_NoBucketLabel()
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

        var tree = TanahpediaFamily.BuildTree(family)!;

        // A single co-parent-less bucket needs no subtitle - the "ילדים" tier
        // label carries it (the website's shouldShowCoParentSubtitles rule).
        tree.ChildGroups.Should().ContainSingle().Which.Labels.Should().BeEmpty();
    }

    [Fact]
    public void BuildTree_ChildrenMixedCoParent_MarksUnknownBucket()
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

        var tree = TanahpediaFamily.BuildTree(family)!;

        tree.ChildGroups.Select(group => group.Labels).Should()
            .Contain(labels => labels.SequenceEqual(new[] { "ילדים מ-רחל" }))
            .And.Contain(labels => labels.SequenceEqual(new[] { "ילדים (בת זוג לא מזוהה בנתונים)" }));
    }

    [Fact]
    public void BuildTree_SiblingsSplitByBirthDate()
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

        var tree = TanahpediaFamily.BuildTree(family)!;

        tree.SiblingClusters.Should().HaveCount(2);
        tree.SiblingClusters[0].Labels.Should().Equal("אחים מבוגרים");
        tree.SiblingClusters[0].Stacks.Should().ContainSingle().Which.Card.DisplayName.Should().Be("בכור");
        tree.SiblingClusters[1].Labels.Should().Equal("אחים צעירים");
        // Younger + unknown-merge into one alphabetic cluster.
        tree.SiblingClusters[1].Stacks.Select(s => s.Card.DisplayName).Should().Equal("לא ידוע", "צעיר");
    }

    [Fact]
    public void BuildTree_SiblingsWithoutSplit_SingleGenericCluster()
    {
        var family = new TanahpediaPersonFamily
        {
            Siblings =
            [
                new TanahpediaFamilySibling { DisplayName = "עשו" },
                new TanahpediaFamilySibling { DisplayName = "לאה" },
            ],
        };

        var tree = TanahpediaFamily.BuildTree(family)!;

        var cluster = tree.SiblingClusters.Should().ContainSingle().Subject;
        cluster.Labels.Should().Equal("אחים");
        cluster.Stacks.Select(s => s.Card.DisplayName).Should().Equal("לאה", "עשו");
    }

    [Fact]
    public void BuildTree_SiblingsOnlyOlder_SingleGenericCluster()
    {
        var family = new TanahpediaPersonFamily
        {
            FocalBirthYyyymmdd = 21000101,
            Siblings =
            [
                new TanahpediaFamilySibling { DisplayName = "עשו", BirthDateYyyymmdd = 20900101 },
            ],
        };

        var tree = TanahpediaFamily.BuildTree(family)!;

        tree.SiblingClusters.Should().ContainSingle().Which.Labels.Should().Equal("אחים");
    }

    [Fact]
    public void BuildTree_RepeatEdgesInOneOpinionGroup_OneCardWithInterpretations()
    {
        // Two union edges for the SAME partner inside ONE alt group are
        // interpretations of that relationship - the website's שיטה א'/ב'
        // on a single shared card.
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

        var tree = TanahpediaFamily.BuildTree(family)!;

        var unit = tree.SpouseUnits.Should().ContainSingle().Subject;
        unit.Spouse.Card.DisplayName.Should().Be("אישה");
        RibbonTexts(unit.Spouse, TanahpediaFamilyRibbonKind.Ordinal).Should()
            .Equal("שיטה א'", "שיטה ב'");
        RibbonTexts(unit.Spouse, TanahpediaFamilyRibbonKind.Main).Should()
            .Equal("נישואין", "פילגש");
    }

    [Fact]
    public void BuildTree_SamePartnerAcrossAltGroups_SeparateUnits()
    {
        // Same partner modeled by two competing opinion groups - two separate
        // spouse units, no ordinals (the website shows no "חלופי" marker on
        // spouse units in the tree layout).
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

        var tree = TanahpediaFamily.BuildTree(family)!;

        tree.SpouseUnits.Should().HaveCount(2);
        RibbonTexts(tree.SpouseUnits[0].Spouse, TanahpediaFamilyRibbonKind.Main).Should().Equal("נישואין");
        RibbonTexts(tree.SpouseUnits[1].Spouse, TanahpediaFamilyRibbonKind.Main).Should().Equal("פילגש");
        tree.SpouseUnits.SelectMany(u => AllRibbonTexts(u.Spouse))
            .Should().NotContain(text => text.StartsWith("שיטה"));
    }

    [Fact]
    public void BuildTree_AlternativeSpouses_SeparateUnits()
    {
        // Competing models pick different partners - separate units, never a
        // merged card (and no ordinal titles).
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

        var tree = TanahpediaFamily.BuildTree(family)!;

        tree.SpouseUnits.Select(u => u.Spouse.Card.DisplayName).Should()
            .Equal("לאה", "רחל", "בלהה");
        foreach (var unit in tree.SpouseUnits)
        {
            RibbonTexts(unit.Spouse, TanahpediaFamilyRibbonKind.Main).Should().Equal("נישואין");
            RibbonTexts(unit.Spouse, TanahpediaFamilyRibbonKind.Ordinal).Should().BeEmpty();
        }
    }

    [Fact]
    public void BuildTree_MarriageAndForbiddenPair_FusedIntoInterpretations()
    {
        // The website fuses a canonical נישואין with a same-partner,
        // same-union-order קשר פסול עם גויה edge - even across alt groups -
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

        var tree = TanahpediaFamily.BuildTree(family)!;

        // One partner card, two interpretation ribbons - canonical first.
        var unit = tree.SpouseUnits.Should().ContainSingle().Subject;
        RibbonTexts(unit.Spouse, TanahpediaFamilyRibbonKind.Ordinal).Should()
            .Equal("שיטה א'", "שיטה ב'");
        RibbonTexts(unit.Spouse, TanahpediaFamilyRibbonKind.Main).Should()
            .Equal("נישואין", "קשר פסול עם גויה");
    }

    [Fact]
    public void BuildTree_AlternativeParents_MarkedAsAlternatives()
    {
        // A child with two alternative fathers on distinct alt groups -
        // the canonical group first, each alternative under a "חלופי" label.
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

        var tree = TanahpediaFamily.BuildTree(family)!;

        tree.ParentGroups.Should().HaveCount(3);
        tree.ParentGroups[0].Labels.Should().BeEmpty();
        tree.ParentGroups[0].Stacks.Should().ContainSingle().Which.Card.DisplayName.Should().Be("אבי-א");
        tree.ParentGroups[1].Labels.Should().Equal("חלופי");
        tree.ParentGroups[1].Stacks.Should().ContainSingle().Which.Card.DisplayName.Should().Be("אבי-ב");
        tree.ParentGroups[2].Labels.Should().Equal("חלופי");
        tree.ParentGroups[2].Stacks.Should().ContainSingle().Which.Card.DisplayName.Should().Be("אבי-ג");
    }

    [Fact]
    public void BuildTree_SpouseMatrix_AttachesChildrenUnderPartners()
    {
        // Several spouses + canonical children naming co-parents → the matrix
        // layout: each partner column carries its children underneath.
        var family = new TanahpediaPersonFamily
        {
            FocalSex = "MALE",
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
                },
            ],
            Children =
            [
                new TanahpediaFamilyChildEdge
                {
                    Related = Person("ראובן", entityId: "e-reuven"),
                    RelationshipType = "BIOLOGICAL",
                    BirthOrder = 1,
                    CoParentEntityId = "e-leah",
                    CoParentDisplayName = "לאה",
                },
                new TanahpediaFamilyChildEdge
                {
                    Related = Person("יוסף", entityId: "e-yosef"),
                    RelationshipType = "BIOLOGICAL",
                    BirthOrder = 11,
                    CoParentEntityId = "e-rachel",
                    CoParentDisplayName = "רחל",
                },
            ],
        };

        var tree = TanahpediaFamily.BuildTree(family)!;

        tree.ChildGroups.Should().BeEmpty();
        tree.SpouseUnits.Should().HaveCount(2);
        tree.SpouseUnits[0].Children.Select(s => s.Card.DisplayName).Should().Equal("ראובן");
        tree.SpouseUnits[1].Children.Select(s => s.Card.DisplayName).Should().Equal("יוסף");
        tree.LooseChildren.Should().BeEmpty();
    }

    [Fact]
    public void BuildTree_SpouseMatrix_UnmappedChildrenStayLoose()
    {
        var family = new TanahpediaPersonFamily
        {
            Spouses =
            [
                new TanahpediaFamilySpouseEdge
                {
                    Related = Person("לאה", entityId: "e-leah"),
                    UnionType = "MARRIAGE",
                },
                new TanahpediaFamilySpouseEdge
                {
                    Related = Person("רחל", entityId: "e-rachel"),
                    UnionType = "MARRIAGE",
                },
            ],
            Children =
            [
                new TanahpediaFamilyChildEdge
                {
                    Related = Person("יוסף", entityId: "e-yosef"),
                    RelationshipType = "BIOLOGICAL",
                    CoParentEntityId = "e-rachel",
                    CoParentDisplayName = "רחל",
                },
                new TanahpediaFamilyChildEdge
                {
                    Related = Person("תֵּימָא", entityId: "e-teima"),
                    RelationshipType = "BIOLOGICAL",
                },
            ],
        };

        var tree = TanahpediaFamily.BuildTree(family)!;

        tree.SpouseUnits[1].Children.Select(s => s.Card.DisplayName).Should().Equal("יוסף");
        tree.LooseChildren.Select(s => s.Card.DisplayName).Should().Equal("תֵּימָא");
        tree.LooseChildrenLabel.Should().Be("ילדים ללא מיפוי מלא לבת זוג בגרף");
    }

    [Fact]
    public void BuildTree_SingleSpouse_NoMatrix_ChildrenInOwnGroups()
    {
        var family = new TanahpediaPersonFamily
        {
            Spouses =
            [
                new TanahpediaFamilySpouseEdge
                {
                    Related = Person("שרה", entityId: "e-sarah"),
                    UnionType = "MARRIAGE",
                },
            ],
            Children =
            [
                new TanahpediaFamilyChildEdge
                {
                    Related = Person("יצחק", entityId: "e-isaac"),
                    RelationshipType = "BIOLOGICAL",
                    CoParentEntityId = "e-sarah",
                    CoParentDisplayName = "שרה",
                },
            ],
        };

        var tree = TanahpediaFamily.BuildTree(family)!;

        // The matrix needs several spouses - one spouse keeps the plain
        // children tier (with no "מ-שרה" subtitle, since the bucket simply
        // repeats the single partner).
        tree.ChildGroups.Should().ContainSingle().Which.Labels.Should().BeEmpty();
        tree.SpouseUnits[0].Children.Should().BeEmpty();
    }
}
