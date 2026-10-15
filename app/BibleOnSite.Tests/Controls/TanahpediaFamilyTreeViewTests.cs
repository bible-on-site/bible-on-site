using BibleOnSite.Controls;
using BibleOnSite.Helpers;
using BibleOnSite.Models;
using Microsoft.Maui;

namespace BibleOnSite.Tests.Controls;

public class TanahpediaFamilyTreeViewTests
{
    private static IEnumerable<string> LabelTexts(IVisualTreeElement? root)
    {
        if (root is null)
        {
            yield break;
        }
        if (root is Label label)
        {
            yield return label.Text ?? string.Empty;
        }
        foreach (var child in root.GetVisualChildren())
        {
            foreach (var text in LabelTexts(child))
            {
                yield return text;
            }
        }
    }

    private static IEnumerable<TapGestureRecognizer> TapRecognizers(IVisualTreeElement? root)
    {
        if (root is null)
        {
            yield break;
        }
        if (root is View view)
        {
            foreach (var recognizer in view.GestureRecognizers.OfType<TapGestureRecognizer>())
            {
                yield return recognizer;
            }
        }
        foreach (var child in root.GetVisualChildren())
        {
            foreach (var recognizer in TapRecognizers(child))
            {
                yield return recognizer;
            }
        }
    }

    private static TanahpediaPersonFamily SampleFamily() => new()
    {
        FocalEntityId = "e-focal",
        FocalDisplayName = "יעקב",
        FocalSex = "MALE",
        Parents =
        [
            new TanahpediaFamilyParentEdge
            {
                Related = new TanahpediaFamilyPerson { EntityId = "e-isaac", DisplayName = "יצחק" },
                ParentRole = "FATHER",
                RelationshipType = "BIOLOGICAL",
            },
        ],
        Spouses =
        [
            new TanahpediaFamilySpouseEdge
            {
                Related = new TanahpediaFamilyPerson
                {
                    EntityId = "e-leah",
                    DisplayName = "לאה",
                    EntryUniqueName = "לאה",
                    Sex = "FEMALE",
                },
                UnionType = "MARRIAGE",
                SourceCitation = "בראשית כט כג",
            },
        ],
        Children =
        [
            new TanahpediaFamilyChildEdge
            {
                Related = new TanahpediaFamilyPerson { EntityId = "e-reuven", DisplayName = "ראובן" },
                RelationshipType = "BIOLOGICAL",
            },
        ],
        Siblings =
        [
            new TanahpediaFamilySibling { EntityId = "e-esau", DisplayName = "עשו" },
        ],
    };

    [Fact]
    public void Render_NullTree_LeavesContentEmpty()
    {
        var view = new TanahpediaFamilyTreeView();

        view.Content.Should().BeNull();
    }

    [Fact]
    public void Render_Tree_TiersCardsAndRibbons()
    {
        var view = new TanahpediaFamilyTreeView { Tree = TanahpediaFamily.BuildTree(SampleFamily()) };

        view.Content.Should().BeOfType<Border>();
        var texts = LabelTexts(view.Content).ToList();

        // Tier pills, section title, focal card, related names, ribbons.
        texts.Should().Contain("משפחה");
        texts.Should().Contain("הורים");
        texts.Should().Contain("אחים");
        texts.Should().Contain("בנות זוג");
        texts.Should().Contain("ילדים");
        texts.Should().Contain("יעקב");
        texts.Should().Contain("יצחק");
        texts.Should().Contain("לאה");
        texts.Should().Contain("ראובן");
        texts.Should().Contain("עשו");
        texts.Should().Contain("אב");
        texts.Should().Contain("נישואין");
        texts.Should().Contain("בראשית כט כג");
        texts.Should().Contain("נ");
    }

    [Fact]
    public void Render_LinkedCard_TapInvokesEntryCommand()
    {
        var captured = new List<object?>();
        var command = new Command(parameter => captured.Add(parameter));
        var view = new TanahpediaFamilyTreeView
        {
            Tree = TanahpediaFamily.BuildTree(SampleFamily()),
            EntryTappedCommand = command,
        };

        var taps = TapRecognizers(view.Content).ToList();

        // Exactly one card links - the spouse with an EntryUniqueName.
        taps.Should().ContainSingle();
        taps[0].CommandParameter.Should().Be("לאה");
        taps[0].Command!.Execute(taps[0].CommandParameter);
        captured.Should().Equal("לאה");
    }

    private static TanahpediaPersonFamily MatrixFamily() => new()
    {
        FocalEntityId = "e-focal",
        FocalDisplayName = "יעקב",
        FocalSex = "MALE",
        FocalBirthYyyymmdd = 21000101,
        Spouses =
        [
            new TanahpediaFamilySpouseEdge
            {
                Related = new TanahpediaFamilyPerson { EntityId = "e-leah", DisplayName = "לאה" },
                UnionType = "MARRIAGE",
                UnionOrder = 1,
                UnionStartDate = 29000101,
            },
            new TanahpediaFamilySpouseEdge
            {
                Related = new TanahpediaFamilyPerson { EntityId = "e-rachel", DisplayName = "רחל" },
                UnionType = "MARRIAGE",
                UnionOrder = 2,
                UnionEndReason = "DEATH",
                UnionEndDate = 29050101,
            },
        ],
        Children =
        [
            new TanahpediaFamilyChildEdge
            {
                Related = new TanahpediaFamilyPerson { EntityId = "e-reuven", DisplayName = "ראובן", Sex = "MALE" },
                RelationshipType = "ADOPTIVE",
                ParentRole = "FATHER",
                BirthOrder = 1,
                CoParentEntityId = "e-leah",
                CoParentDisplayName = "לאה",
            },
            new TanahpediaFamilyChildEdge
            {
                Related = new TanahpediaFamilyPerson { EntityId = "e-dan", DisplayName = "דן" },
                RelationshipType = "BIOLOGICAL",
            },
        ],
        Siblings =
        [
            new TanahpediaFamilySibling { EntityId = "e-esau", DisplayName = "עשו", BirthDateYyyymmdd = 20800101, SourceCitation = "בראשית כה כה" },
            new TanahpediaFamilySibling { EntityId = "e-dinah", DisplayName = "דינה", BirthDateYyyymmdd = 21200101 },
        ],
    };

    [Fact]
    public void Render_MatrixFamily_ChildrenUnderPartnersAndLooseBucket()
    {
        var view = new TanahpediaFamilyTreeView { Tree = TanahpediaFamily.BuildTree(MatrixFamily()) };

        var texts = LabelTexts(view.Content).ToList();

        // Spouse ribbons: union orders, timelines, the adoptive meta ribbon.
        texts.Should().Contain("סדר 1");
        texts.Should().Contain("סדר 2");
        texts.Should().Contain("התחלה 2900-01-01");
        texts.Should().Contain("פטירה 2905-01-01");
        texts.Should().Contain("אב · אימוץ");
        // Loose children bucket label + sibling split labels.
        texts.Should().Contain("ילדים ללא מיפוי מלא לבת זוג בגרף");
        texts.Should().Contain("אחים מבוגרים");
        texts.Should().Contain("אחים צעירים");
        texts.Should().Contain("בראשית כה כה");
        // No "ילדים" tier in the matrix layout.
        texts.Should().NotContain("ילדים");
        texts.Should().Contain("ז");
    }

    [Fact]
    public void Render_AltGroups_AlternativeLabels()
    {
        var family = new TanahpediaPersonFamily
        {
            FocalDisplayName = "דוד",
            Parents =
            [
                new TanahpediaFamilyParentEdge
                {
                    Related = new TanahpediaFamilyPerson { EntityId = "e-a", DisplayName = "אבי-א" },
                    ParentRole = "FATHER",
                    RelationshipType = "BIOLOGICAL",
                },
                new TanahpediaFamilyParentEdge
                {
                    Related = new TanahpediaFamilyPerson { EntityId = "e-b", DisplayName = "אבי-ב" },
                    ParentRole = "FATHER",
                    RelationshipType = "BIOLOGICAL",
                    AltGroupId = "alt-1",
                },
            ],
        };
        var view = new TanahpediaFamilyTreeView { Tree = TanahpediaFamily.BuildTree(family) };

        LabelTexts(view.Content).Should().Contain("חלופי");
    }

    [Fact]
    public void Render_OpinionInterpretations_OrdinalRibbons()
    {
        var family = new TanahpediaPersonFamily
        {
            FocalDisplayName = "דוד",
            Spouses =
            [
                new TanahpediaFamilySpouseEdge
                {
                    Related = new TanahpediaFamilyPerson { EntityId = "e-w", DisplayName = "אישה" },
                    UnionType = "MARRIAGE",
                    AltGroupId = "alt-1",
                },
                new TanahpediaFamilySpouseEdge
                {
                    Related = new TanahpediaFamilyPerson { EntityId = "e-w", DisplayName = "אישה" },
                    UnionType = "PILEGESH",
                    AltGroupId = "alt-1",
                },
            ],
        };
        var view = new TanahpediaFamilyTreeView { Tree = TanahpediaFamily.BuildTree(family) };

        var texts = LabelTexts(view.Content).ToList();
        texts.Should().Contain("שיטה א'");
        texts.Should().Contain("שיטה ב'");
        texts.Should().Contain("נישואין");
        texts.Should().Contain("פילגש");
        texts.Should().Contain("זיווגים");
    }

    [Fact]
    public void Render_ResetToNull_ClearsContent()
    {
        var view = new TanahpediaFamilyTreeView { Tree = TanahpediaFamily.BuildTree(SampleFamily()) };
        view.Content.Should().NotBeNull();

        view.Tree = null;

        view.Content.Should().BeNull();
    }
}
