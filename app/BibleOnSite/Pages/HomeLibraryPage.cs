using BibleOnSite.Controls;
using BibleOnSite.Helpers;
using BibleOnSite.Services;

namespace BibleOnSite.Pages;

/// <summary>Secondary learning destinations, away from the daily reading path.</summary>
public class HomeLibraryPage : ContentPage, IAnalyticsScreenName
{
    private readonly bool _about;
    public string AnalyticsScreenName => _about ? "About" : "Library";

    public HomeLibraryPage() : this(false) { }

    protected HomeLibraryPage(bool about)
    {
        _about = about;
        Title = about ? "מידע ועזרה" : "הספרייה";
        FlowDirection = FlowDirection.RightToLeft;
        Shell.SetNavBarIsVisible(this, false);
        this.SetAppThemeColor(BackgroundColorProperty, Color.FromArgb("#F5F7FB"), Color.FromArgb("#111C2C"));
        var title = Text(Title, 22, true);
        var bar = new SharedTopBar { CenterContent = title };
        var body = new VerticalStackLayout { Padding = new Thickness(22, 18, 22, 36), Spacing = 14 };
        body.Add(Text(about ? "נשארים בקשר." : "התנ\"ך,\nמכל כיוון.", 36, true));
        if (about)
        {
            AddCard(body, "צור קשר", "שאלות, רעיונות ומשוב", Fonts.FluentUI.mail_24_regular, AppRoutes.Contact);
            AddCard(body, "תמיכה במיזם", "עוזרים להמשיך ולפתח", Fonts.FluentUI.heart_24_regular, AppRoutes.Donations);
            AddCard(body, "תנאי שימוש", "תנאי השימוש והפרטיות", Fonts.FluentUI.document_24_regular, AppRoutes.Terms);
        }
        else
        {
            body.Add(Text("להעמיק, להכיר וללמוד בדרך שלך", 15, false));
            body.Add(DiscoveryCard("תנכפדיה", "מאחורי כל פסוק יש עולם.\nאנשים, מקומות ומושגים.",
                Fonts.FluentUI.globe_24_regular, AppRoutes.Tanahpedia, "HomeLibraryTanahpedia", "#102648", true, 170));
            var pair = new Grid { ColumnDefinitions = [new(GridLength.Star), new(GridLength.Star)], ColumnSpacing = 12 };
            pair.Add(DiscoveryCard("פרשת השבוע", "לימוד לפי פרשות", Fonts.FluentUI.book_open_24_regular,
                AppRoutes.ParashaList, "HomeLibraryParasha", "#2866E7", true, 156));
            pair.Add(DiscoveryCard("מועדים", "ללמוד עם מעגל השנה", Fonts.FluentUI.calendar_date_24_regular,
                AppRoutes.Moadim, "HomeLibraryMoadim", "#E4ECFC", false, 156), 1, 0);
            body.Add(pair);
            body.Add(DiscoveryCard("עלון יומי", "הפרק של היום, בדף אחד.", Fonts.FluentUI.document_24_regular,
                AppRoutes.DailyBulletin, "HomeLibraryBulletin", "#102648", true, 120));
            AddCard(body, "מידע ועזרה", "צור קשר, תמיכה ותנאי שימוש", Fonts.FluentUI.info_24_regular, nameof(HomeAboutPage));
        }
        var grid = new Grid { RowDefinitions = [new(GridLength.Auto), new(GridLength.Star)] };
        grid.Add(bar);
        grid.Add(new ScrollView { Content = body }, 0, 1);
        Content = grid;
    }

    private static Label Text(string text, double size, bool bold)
    {
        var label = new Label { Text = text, FontSize = size, FontAttributes = bold ? FontAttributes.Bold : FontAttributes.None };
        label.SetAppThemeColor(Label.TextColorProperty, Color.FromArgb("#192B45"), Color.FromArgb("#F5F7FB"));
        return label;
    }

    private static void AddCard(VerticalStackLayout parent, string title, string subtitle, string glyph, string route)
    {
        var copy = new VerticalStackLayout { Spacing = 6, VerticalOptions = LayoutOptions.Center };
        copy.Add(Text(title, 21, true));
        var description = Text(subtitle, 14, false);
        description.SetAppThemeColor(Label.TextColorProperty, Color.FromArgb("#63738C"), Color.FromArgb("#B8CBE5"));
        copy.Add(description);
        var icon = new Label { Text = glyph, FontFamily = "FluentIcons", FontSize = 28, VerticalOptions = LayoutOptions.Center };
        icon.SetAppThemeColor(Label.TextColorProperty, Color.FromArgb("#2866E7"), Color.FromArgb("#AACBFF"));
        var arrow = Text("←", 25, false);
        arrow.VerticalOptions = LayoutOptions.Center;
        var row = new Grid
        {
            ColumnDefinitions = [new(GridLength.Auto), new(GridLength.Star), new(GridLength.Auto)],
            ColumnSpacing = 18,
            Padding = 20,
            MinimumHeightRequest = 92
        };
        row.Add(icon);
        row.Add(copy, 1, 0);
        row.Add(arrow, 2, 0);
        var card = new Border
        {
            StrokeThickness = 0,
            StrokeShape = new Microsoft.Maui.Controls.Shapes.RoundRectangle { CornerRadius = 22 },
            Content = row
        };
        card.SetAppThemeColor(BackgroundColorProperty, Colors.White, Color.FromArgb("#233956"));
        var hit = new TappableView { Content = card, CommandParameter = route };
        SemanticProperties.SetDescription(hit, title);
        hit.Activated += async (_, _) => await ShellAppNavigator.Instance.GoToAsync(route);
        parent.Add(hit);
    }

    private static TappableView DiscoveryCard(string title, string subtitle, string glyph, string route,
        string automationId, string color, bool dark, double height)
    {
        var ink = dark ? Colors.White : Color.FromArgb("#192B45");
        var copy = new VerticalStackLayout { Spacing = 8, VerticalOptions = LayoutOptions.Center };
        var heading = Text(title, height > 160 ? 30 : 23, true);
        heading.TextColor = ink;
        copy.Add(heading);
        var detail = Text(subtitle, 14, false);
        detail.TextColor = dark ? Color.FromArgb("#D5E3FC") : Color.FromArgb("#526B91");
        copy.Add(detail);
        var arrow = Text("←", 26, true);
        arrow.TextColor = ink;
        arrow.Margin = new Thickness(0, 6, 0, 0);
        copy.Add(arrow);
        var watermark = new Label
        {
            Text = glyph, FontFamily = "FluentIcons", FontSize = height > 160 ? 130 : 90,
            TextColor = dark ? Colors.White : Color.FromArgb("#2866E7"), Opacity = 0.10,
            HorizontalOptions = LayoutOptions.End, VerticalOptions = LayoutOptions.End,
            Rotation = -12, TranslationX = 16, TranslationY = 10, InputTransparent = true
        };
        AutomationProperties.SetIsInAccessibleTree(watermark, false);
        var content = new Grid { Padding = 20, MinimumHeightRequest = height, IsClippedToBounds = true };
        content.Add(watermark);
        content.Add(copy);
        var surface = new Border
        {
            Content = content, BackgroundColor = Color.FromArgb(color), StrokeThickness = 0,
            StrokeShape = new Microsoft.Maui.Controls.Shapes.RoundRectangle { CornerRadius = 26 }
        };
        var hit = new TappableView { Content = surface, AutomationId = automationId };
        SemanticProperties.SetDescription(hit, $"{title}, {subtitle.Replace('\n', ' ')}");
        hit.Activated += async (_, _) => await ShellAppNavigator.Instance.GoToAsync(route);
        return hit;
    }
}

/// <summary>Project information is separate from learning destinations.</summary>
public sealed class HomeAboutPage : HomeLibraryPage
{
    public HomeAboutPage() : base(true) { }
}
