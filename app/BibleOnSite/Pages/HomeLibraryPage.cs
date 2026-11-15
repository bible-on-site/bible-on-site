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
        this.SetAppThemeColor(BackgroundColorProperty, Color.FromArgb("#F2EFE6"), Color.FromArgb("#111C2C"));
        var title = Text(Title, 22, true);
        var bar = new SharedTopBar { CenterContent = title };
        var body = new VerticalStackLayout { Padding = new Thickness(22, 18, 22, 36), Spacing = 14 };
        body.Add(Text(about ? "נשארים בקשר." : "עוד עולם\nלגלות.", 38, true));
        if (about)
        {
            AddCard(body, "צור קשר", "שאלות, רעיונות ומשוב", Fonts.FluentUI.mail_24_regular, AppRoutes.Contact);
            AddCard(body, "תמיכה במיזם", "עוזרים להמשיך ולפתח", Fonts.FluentUI.heart_24_regular, AppRoutes.Donations);
            AddCard(body, "תנאי שימוש", "תנאי השימוש והפרטיות", Fonts.FluentUI.document_24_regular, AppRoutes.Terms);
        }
        else
        {
            body.Add(Text("לגלות מתוך התנ\"ך", 15, false));
            AddCard(body, "תנכפדיה", "אנשים, מקומות ומושגים", Fonts.FluentUI.globe_24_regular, AppRoutes.Tanahpedia);
            body.Add(Text("ללמוד עם הזמן", 15, false));
            AddCard(body, "פרשת השבוע", "לימוד פרשות התורה", Fonts.FluentUI.book_open_24_regular, AppRoutes.ParashaList);
            AddCard(body, "מועדים", "לימוד לחגים ולמועדים", Fonts.FluentUI.calendar_date_24_regular, AppRoutes.Moadim);
            AddCard(body, "עלון יומי", "דף הלימוד של היום", Fonts.FluentUI.document_24_regular, AppRoutes.DailyBulletin);
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
        label.SetAppThemeColor(Label.TextColorProperty, Color.FromArgb("#192B45"), Color.FromArgb("#F2EFE6"));
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
}

/// <summary>Project information is separate from learning destinations.</summary>
public sealed class HomeAboutPage : HomeLibraryPage
{
    public HomeAboutPage() : base(true) { }
}
