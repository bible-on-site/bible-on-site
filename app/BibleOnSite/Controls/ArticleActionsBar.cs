using System.Windows.Input;
using BibleOnSite.Helpers;
using Microsoft.Maui.Controls.Shapes;

namespace BibleOnSite.Controls;

/// <summary>
/// The article command group shared by the article and Tanahpedia entry
/// views (#2786): a pill mirroring the navigation capsule on the bar's
/// trailing edge, holding the page commands that used to drift — Share and
/// Fullscreen — as one control with the capsule's own geometry (40px pill,
/// 14px radius, FluentIcons glyphs, Hebrew accessible names). In the app's
/// RTL band the return affordance stays at the leading edge (the capsule
/// Back) while Share sits adjacent to the title and Fullscreen owns the
/// extreme trailing edge — matching the reader's bar, where fullscreen is
/// the trailing command.
/// </summary>
public class ArticleActionsBar : Border, IArticleActionsSurface
{
    /// <summary>Raised when the fullscreen command is tapped — the page's
    /// <see cref="ArticleChrome"/> owns the transition.</summary>
#pragma warning disable S3264 // Subscribed by the page's ArticleChrome coordinator.
    public event EventHandler? FullScreenRequested;
#pragma warning restore S3264

    /// <summary>The share command pill button — glyphs and target share the capsule treatment.</summary>
    public Button ShareButton { get; }

    /// <summary>The fullscreen-enter pill button.</summary>
    public Button FullScreenButton { get; }

    public static readonly BindableProperty ShareCommandProperty =
        BindableProperty.Create(nameof(ShareCommand), typeof(ICommand), typeof(ArticleActionsBar),
            propertyChanged: (bindable, _, value) =>
                ((ArticleActionsBar)bindable).ShareButton.Command = (ICommand?)value);

    /// <summary>The bound share command — the page's view model owns the share itself.</summary>
    public ICommand? ShareCommand
    {
        get => (ICommand?)GetValue(ShareCommandProperty);
        set => SetValue(ShareCommandProperty, value);
    }

    public ArticleActionsBar()
    {
        AutomationId = "ArticleActionsBar";
        StrokeShape = new RoundRectangle { CornerRadius = SharedTopBar.PillCornerRadius };
        Stroke = Colors.Transparent;
        StrokeThickness = 0;
        Padding = new Thickness(2, 0);
        HeightRequest = SharedTopBar.PillHeight;
        Margin = new Thickness(4, 0);
        VerticalOptions = LayoutOptions.Center;
        this.SetAppThemeColor(BackgroundColorProperty, ToolbarPill.LightColor, ToolbarPill.DarkColor);

        ShareButton = CreateButton(Fonts.FluentUI.share_android_24_regular,
            "שתף", "ArticleShareButton");
        FullScreenButton = CreateButton(Fonts.FluentUI.full_screen_maximize_24_regular,
            "מסך מלא", "ArticleFullScreenButton");
        FullScreenButton.Clicked += (_, _) => FullScreenRequested?.Invoke(this, EventArgs.Empty);

        var row = new HorizontalStackLayout { Spacing = 0 };
        row.Add(ShareButton);
        row.Add(FullScreenButton);
        Content = row;
    }

    private static Button CreateButton(string glyph, string description, string automationId)
    {
        var button = new Button
        {
            Text = glyph,
            FontFamily = "FluentIcons",
            FontSize = 22,
            WidthRequest = 44,
            Padding = 0,
            BackgroundColor = Colors.Transparent,
            VerticalOptions = LayoutOptions.Fill,
            AutomationId = automationId,
        };
        button.SetAppThemeColor(Button.TextColorProperty, Colors.Black, Colors.White);
        SemanticProperties.SetDescription(button, description);
        return button;
    }
}
