using BibleOnSite.Controls;
using BibleOnSite.Helpers;
using Microsoft.Maui.Controls;

namespace BibleOnSite.Tests.Helpers;

/// <summary>
/// The UIA name a <see cref="TappableView"/> gets when no
/// SemanticProperties.Description was authored (#3252): composed from the
/// row's own visible text — never the CLR wrapper type name — while nested
/// interactive elements keep their own automation identity.
/// </summary>
public class AccessibleContentTextTests
{
    [Fact]
    public void ComposeName_Null_IsEmpty() =>
        AccessibleContentText.ComposeName(null).Should().BeEmpty();

    [Fact]
    public void ComposeName_EmptyView_IsEmpty() =>
        AccessibleContentText.ComposeName(new TappableView()).Should().BeEmpty();

    [Fact]
    public void ComposeName_LabelText()
    {
        var view = new TappableView { Content = new Label { Text = "הגדרות תצוגה" } };

        AccessibleContentText.ComposeName(view).Should().Be("הגדרות תצוגה");
    }

    [Fact]
    public void ComposeName_JoinsNestedLabelsInLayout()
    {
        var view = new TappableView
        {
            Content = new Grid
            {
                Children =
                {
                    new Label { Text = "שם הפרק" },
                    new Border { Content = new Label { Text = "תיאור" } }
                }
            }
        };

        AccessibleContentText.ComposeName(view).Should().Be("שם הפרק, תיאור");
    }

    [Fact]
    public void ComposeName_FormattedText_WhenPlainTextEmpty()
    {
        var label = new Label
        {
            FormattedText = new FormattedString
            {
                Spans = { new Span { Text = "מלל מעוצב" } }
            }
        };

        AccessibleContentText.ComposeName(new TappableView { Content = label })
            .Should().Be("מלל מעוצב");
    }

    [Fact]
    public void ComposeName_SkipsInvisibleSubtree()
    {
        var view = new TappableView
        {
            Content = new VerticalStackLayout
            {
                Children =
                {
                    new Label { Text = "גלוי" },
                    new VerticalStackLayout
                    {
                        IsVisible = false,
                        Children = { new Label { Text = "נסתר" } }
                    }
                }
            }
        };

        AccessibleContentText.ComposeName(view).Should().Be("גלוי");
    }

    [Fact]
    public void ComposeName_NestedInteractiveElements_KeepOwnIdentity()
    {
        var view = new TappableView
        {
            Content = new VerticalStackLayout
            {
                Children =
                {
                    new Label { Text = "כותרת" },
                    new Button { Text = "לא נקלט" },
                    new CheckBox(),
                    new Entry { Text = "לא נקלט" },
                    new TappableView { Content = new Label { Text = "לא נקלט" } },
                    new CollectionView()
                }
            }
        };

        AccessibleContentText.ComposeName(view).Should().Be("כותרת");
    }

    [Fact]
    public void ComposeName_UsesNestedSemanticDescription()
    {
        var described = new Label { Text = "מלל פנימי" };
        SemanticProperties.SetDescription(described, "תיאור נגישות");
        var view = new TappableView
        {
            Content = new VerticalStackLayout { Children = { new Label { Text = "א" }, described } }
        };

        AccessibleContentText.ComposeName(view).Should().Be("א, תיאור נגישות");
    }

    [Fact]
    public void ComposeName_DropsIconFontGlyphs()
    {
        var view = new TappableView
        {
            Content = new Grid
            {
                Children =
                {
                    new Label { Text = "מה לחפש" },
                    // FluentUI chevron — private-use glyph, not a word.
                    new Label { Text = "" }
                }
            }
        };

        AccessibleContentText.ComposeName(view).Should().Be("מה לחפש");
    }
}
