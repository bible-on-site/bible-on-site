using System.Windows.Input;
using BibleOnSite.Helpers;

namespace BibleOnSite.Controls;

/// <summary>
/// Renders a PERSON entity's family neighborhood as a vertical card tree -
/// the narrow-screen layout of the website's <c>PersonFamilyTree</c>: labeled
/// tiers (הורים → focal → אחים → בני/בנות זוג → ילדים) on one spine, each
/// person a card with its relationship ribbons above it. Cards with an entry
/// tap through via <see cref="EntryTappedCommand"/>.
/// </summary>
public class TanahpediaFamilyTreeView : ContentView
{
    private const double CardMinWidth = 140;
    private const double CardMaxWidth = 280;
    private const double RibbonMaxWidth = 230;

    /// <summary>The built tree to render (<see cref="TanahpediaFamily.BuildTree"/>).</summary>
    public static readonly BindableProperty TreeProperty = BindableProperty.Create(
        nameof(Tree),
        typeof(TanahpediaFamilyTree),
        typeof(TanahpediaFamilyTreeView),
        propertyChanged: (bindable, _, _) => ((TanahpediaFamilyTreeView)bindable).Render());

    public TanahpediaFamilyTree? Tree
    {
        get => (TanahpediaFamilyTree?)GetValue(TreeProperty);
        set => SetValue(TreeProperty, value);
    }

    /// <summary>Invoked with the canonical entry slug when a linked card is tapped.</summary>
    public static readonly BindableProperty EntryTappedCommandProperty = BindableProperty.Create(
        nameof(EntryTappedCommand),
        typeof(ICommand),
        typeof(TanahpediaFamilyTreeView),
        propertyChanged: (bindable, _, _) => ((TanahpediaFamilyTreeView)bindable).Render());

    public ICommand? EntryTappedCommand
    {
        get => (ICommand?)GetValue(EntryTappedCommandProperty);
        set => SetValue(EntryTappedCommandProperty, value);
    }

    private void Render()
    {
        var tree = Tree;
        if (tree is null)
        {
            Content = null;
            return;
        }

        var axis = new VerticalStackLayout { Spacing = 0 };

        if (tree.ParentGroups.Count > 0)
        {
            axis.Add(TierLabel("הורים"));
            foreach (var group in tree.ParentGroups)
            {
                axis.Add(GroupView(group));
            }
            axis.Add(Connector());
        }

        axis.Add(CardView(tree.Focal));

        foreach (var cluster in tree.SiblingClusters)
        {
            axis.Add(Connector());
            axis.Add(GroupView(cluster));
        }

        if (tree.SpouseUnits.Count > 0)
        {
            axis.Add(Connector());
            axis.Add(TierLabel(tree.SpousesLabel!));
            var spouseTier = new VerticalStackLayout { Spacing = 14 };
            foreach (var unit in tree.SpouseUnits)
            {
                spouseTier.Add(StackView(unit.Spouse));
                if (unit.Children.Count > 0)
                {
                    spouseTier.Add(Connector());
                    spouseTier.Add(WrapRow(unit.Children));
                }
            }
            axis.Add(spouseTier);

            if (tree.LooseChildren.Count > 0)
            {
                axis.Add(Connector());
                axis.Add(TierLabel(tree.LooseChildrenLabel!));
                axis.Add(WrapRow(tree.LooseChildren));
            }
        }

        if (tree.ChildGroups.Count > 0)
        {
            axis.Add(Connector());
            axis.Add(TierLabel("ילדים"));
            foreach (var group in tree.ChildGroups)
            {
                axis.Add(GroupView(group));
            }
        }

        // The section surface - right accent bar like the website's
        // border-right on the RTL surface (Start in RTL = physical right).
        var body = new VerticalStackLayout { Spacing = 2 };
        body.Add(new Label
        {
            Text = "משפחה",
            FontSize = 17,
            FontAttributes = FontAttributes.Bold,
            HorizontalTextAlignment = TextAlignment.Center,
            TextColor = Res("Primary", "#1552AC"),
            Margin = new Thickness(0, 0, 0, 6),
        });
        body.Add(axis);

        var surface = new Grid();
        var accent = new BoxView
        {
            WidthRequest = 4,
            HorizontalOptions = LayoutOptions.Start,
            VerticalOptions = LayoutOptions.Fill,
            Color = Res("Primary", "#1552AC"),
        };
        surface.Add(accent);
        surface.Add(body);

        var section = new Border
        {
            StrokeShape = new Microsoft.Maui.Controls.Shapes.RoundRectangle { CornerRadius = 14 },
            Padding = new Thickness(14, 18, 18, 20),
            StrokeThickness = 1,
            Content = surface,
        };
        section.SetAppThemeColor(Border.BackgroundColorProperty,
            Color.FromArgb("#F0F5FC"), Color.FromArgb("#25303D"));
        section.SetAppThemeColor(Border.StrokeProperty,
            Color.FromArgb("#C9DBF2"), Color.FromArgb("#3D4C5E"));

        Content = section;
    }

    /// <summary>A labeled block: pill labels stacked above a wrap row of stacks.</summary>
    private View GroupView(TanahpediaFamilyGroup group)
    {
        var column = new VerticalStackLayout { Spacing = 6 };
        foreach (var label in group.Labels)
        {
            column.Add(TierLabel(label));
        }
        column.Add(WrapRow(group.Stacks));
        return column;
    }

    /// <summary>A centered wrap row of card stacks.</summary>
    private View WrapRow(IReadOnlyList<TanahpediaFamilyCardStack> stacks)
    {
        var row = new FlexLayout
        {
            Wrap = Microsoft.Maui.Layouts.FlexWrap.Wrap,
            JustifyContent = Microsoft.Maui.Layouts.FlexJustify.Center,
            AlignItems = Microsoft.Maui.Layouts.FlexAlignItems.Start,
        };
        foreach (var view in stacks.Select(StackView))
        {
            view.Margin = new Thickness(6, 4);
            row.Add(view);
        }
        return row;
    }

    /// <summary>Ribbon lines stacked above the person card.</summary>
    private View StackView(TanahpediaFamilyCardStack stack)
    {
        var column = new VerticalStackLayout
        {
            Spacing = 2,
            MinimumWidthRequest = CardMinWidth,
            MaximumWidthRequest = CardMaxWidth,
        };
        foreach (var line in stack.Ribbons)
        {
            column.Add(RibbonLabel(line));
        }
        column.Add(CardView(stack.Card));
        return column;
    }

    private Label RibbonLabel(TanahpediaFamilyRibbonLine line)
    {
        var label = new Label
        {
            Text = line.Text,
            HorizontalTextAlignment = TextAlignment.Center,
            HorizontalOptions = LayoutOptions.Center,
            MaximumWidthRequest = RibbonMaxWidth,
            LineBreakMode = LineBreakMode.WordWrap,
        };
        switch (line.Kind)
        {
            case TanahpediaFamilyRibbonKind.Ordinal:
                label.FontSize = 11;
                label.FontAttributes = FontAttributes.Bold;
                label.TextColor = Res("Primary", "#1552AC");
                break;
            case TanahpediaFamilyRibbonKind.Main:
                label.FontSize = 11.5;
                label.FontAttributes = FontAttributes.Bold;
                label.SetAppThemeColor(Label.TextColorProperty,
                    Res("Gray550", "#575757"), Res("Gray300", "#ACACAC"));
                break;
            case TanahpediaFamilyRibbonKind.Citation:
                label.FontSize = 10.5;
                label.SetAppThemeColor(Label.TextColorProperty,
                    Res("Gray550", "#575757"), Res("Gray300", "#ACACAC"));
                break;
            default:
                label.FontSize = 10;
                label.SetAppThemeColor(Label.TextColorProperty,
                    Res("Gray500", "#6E6E6E"), Res("Gray400", "#919191"));
                break;
        }
        return label;
    }

    /// <summary>
    /// A person card - centered name, optional ז/נ badge pinned to the start
    /// corner (right under RTL), optional citation lines under a separator.
    /// </summary>
    private View CardView(TanahpediaFamilyCard card)
    {
        var face = new Grid();
        var name = new Label
        {
            Text = card.DisplayName,
            FontSize = 15,
            FontAttributes = FontAttributes.Bold,
            HorizontalTextAlignment = TextAlignment.Center,
            VerticalTextAlignment = TextAlignment.Center,
            LineBreakMode = LineBreakMode.TailTruncation,
            MaxLines = 2,
            // Symmetric side padding (like the web card) keeps the name clear
            // of the corner sex badge without shifting it off-center.
            Padding = card.SexMark is not null ? new Thickness(28, 0) : new Thickness(0),
        };
        if (card.IsLink)
        {
            name.TextColor = Res("Primary", "#1552AC");
            name.TextDecorations = TextDecorations.Underline;
        }
        else
        {
            name.SetAppThemeColor(Label.TextColorProperty,
                Res("Gray900", "#212121"), Res("Gray100", "#E1E1E1"));
        }
        face.Add(name);

        if (card.SexMark is { } mark)
        {
            var badgeText = new Label
            {
                Text = mark,
                FontSize = 11,
                FontAttributes = FontAttributes.Bold,
                Padding = new Thickness(5, 1),
            };
            badgeText.SetAppThemeColor(Label.TextColorProperty,
                Res("Gray600", "#404040"), Res("Gray300", "#ACACAC"));
            var badge = new Border
            {
                StrokeShape = new Microsoft.Maui.Controls.Shapes.RoundRectangle { CornerRadius = 4 },
                StrokeThickness = 1,
                Padding = new Thickness(0),
                HorizontalOptions = LayoutOptions.Start,
                VerticalOptions = LayoutOptions.Start,
                Content = badgeText,
            };
            badge.SetAppThemeColor(Border.StrokeProperty,
                Res("Gray250", "#BABABA"), Res("Gray600", "#404040"));
            badge.SetAppThemeColor(Border.BackgroundColorProperty,
                Color.FromArgb("#F5F5F5"), Color.FromArgb("#3B3B3B"));
            face.Add(badge);
        }

        var cardColumn = new VerticalStackLayout { Spacing = 0 };
        cardColumn.Add(face);
        if (card.CardCitations.Count > 0)
        {
            var separator = new BoxView
            {
                HeightRequest = 1,
                Margin = new Thickness(0, 6, 0, 4),
            };
            separator.SetAppThemeColor(BoxView.ColorProperty,
                Res("Gray200", "#C8C8C8"), Res("Gray700", "#333333"));
            cardColumn.Add(separator);
            foreach (var citation in card.CardCitations.Select(line => new Label
            {
                Text = line,
                FontSize = 10.5,
                HorizontalTextAlignment = TextAlignment.Center,
                LineBreakMode = LineBreakMode.WordWrap,
            }))
            {
                citation.SetAppThemeColor(Label.TextColorProperty,
                    Res("Gray500", "#6E6E6E"), Res("Gray400", "#919191"));
                cardColumn.Add(citation);
            }
        }

        var border = new Border
        {
            StrokeShape = new Microsoft.Maui.Controls.Shapes.RoundRectangle { CornerRadius = 10 },
            StrokeThickness = card.IsFocal ? 1.5 : 1,
            Padding = new Thickness(12, 10),
            MinimumWidthRequest = CardMinWidth,
            MaximumWidthRequest = CardMaxWidth,
            HorizontalOptions = LayoutOptions.Center,
            Shadow = new Shadow
            {
                Opacity = card.IsFocal ? 0.18f : 0.08f,
                Radius = card.IsFocal ? 12 : 6,
                Offset = new Point(0, 2),
            },
            Content = cardColumn,
        };
        border.SetAppThemeColor(Border.BackgroundColorProperty,
            Res("Surface", "#FFFFFF"), Res("SurfaceDark", "#2D2D2D"));
        border.SetAppThemeColor(Border.StrokeProperty,
            card.IsFocal ? Res("Primary", "#1552AC") : Res("Gray200", "#C8C8C8"),
            card.IsFocal ? Res("PrimaryLight", "#4A7FC7") : Res("Gray700", "#333333"));

        if (card.IsLink)
        {
            border.GestureRecognizers.Add(new TapGestureRecognizer
            {
                Command = EntryTappedCommand,
                CommandParameter = card.EntryUniqueName,
            });
        }
        return border;
    }

    /// <summary>A centered 2px spine segment between tiers.</summary>
    private static BoxView Connector() => new()
    {
        WidthRequest = 2,
        HeightRequest = 18,
        HorizontalOptions = LayoutOptions.Center,
        Color = Res("PrimaryLight", "#4A7FC7"),
        Opacity = 0.55,
        Margin = new Thickness(0, 4),
    };

    /// <summary>A centered pill label ("הורים", "אחים", "חלופי", "ילדים מ-X").</summary>
    private static Border TierLabel(string text)
    {
        var label = new Label
        {
            Text = text,
            FontSize = 11,
            FontAttributes = FontAttributes.Bold,
            TextColor = Res("Primary", "#1552AC"),
        };
        var pill = new Border
        {
            StrokeShape = new Microsoft.Maui.Controls.Shapes.RoundRectangle { CornerRadius = 8 },
            StrokeThickness = 1,
            Padding = new Thickness(12, 3),
            Margin = new Thickness(0, 2, 0, 8),
            HorizontalOptions = LayoutOptions.Center,
            Content = label,
        };
        pill.SetAppThemeColor(Border.StrokeProperty,
            Color.FromArgb("#C9DBF2"), Color.FromArgb("#3D4C5E"));
        pill.SetAppThemeColor(Border.BackgroundColorProperty,
            Color.FromArgb("#FFFFFF"), Color.FromArgb("#2D2D2D"));
        return pill;
    }

    /// <summary>Theme color lookup with a hex fallback for non-app hosts.</summary>
    private static Color Res(string key, string fallbackHex) =>
        Application.Current?.Resources.TryGetValue(key, out var value) is true && value is Color color
            ? color
            : Color.FromArgb(fallbackHex);
}
