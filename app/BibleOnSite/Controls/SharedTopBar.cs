namespace BibleOnSite.Controls;

/// <summary>
/// The shared top bar used by the reader (על הפרק) and landing pages such as
/// רבנים, so their chrome cannot drift: a 56px band with the flyout hamburger
/// at the start edge, a center slot (title pill / search field) and a trailing
/// slot for page actions, plus the reader's hairline separator.
/// </summary>
public class SharedTopBar : ContentView
{
    public static double BarHeight => 56;
    public static double EdgeWidth => 48;
    public static double PillHeight => 40;
    public static double PillCornerRadius => 14;

    internal static readonly Color BandLight = Color.FromArgb("#F2F7FE");
    internal static readonly Color BandDark = Color.FromArgb("#20304A");
    internal static readonly Color SeparatorLight = Color.FromArgb("#DBE8F8");
    internal static readonly Color SeparatorDark = Color.FromArgb("#47658E");

    private readonly Grid _band;
    private readonly ContentView _centerHost = new();
    private readonly ContentView _trailingHost = new();

    /// <summary>The hamburger button at the start edge; opens the Shell flyout.</summary>
    public Button NavigationButton { get; }

    /// <summary>
    /// Runs before the flyout opens; returning true marks the tap handled so the
    /// bar can repurpose the slot (e.g. the focused pasuk's close control on
    /// platforms without a system Back).
    /// </summary>
    public Func<bool>? NavigationInterceptor { get; set; }

    public static readonly BindableProperty CenterContentProperty =
        BindableProperty.Create(nameof(CenterContent), typeof(View), typeof(SharedTopBar),
            propertyChanged: (bindable, _, value) => ((SharedTopBar)bindable)._centerHost.Content = (View?)value);
    /// <summary>Content placed in the center slot (title pill, search field).</summary>
    public View? CenterContent
    {
        get => (View?)GetValue(CenterContentProperty);
        set => SetValue(CenterContentProperty, value);
    }

    public static readonly BindableProperty TrailingContentProperty =
        BindableProperty.Create(nameof(TrailingContent), typeof(View), typeof(SharedTopBar),
            propertyChanged: (bindable, _, value) => ((SharedTopBar)bindable)._trailingHost.Content = (View?)value);
    /// <summary>Content placed in the trailing slot (page menu, clear button).</summary>
    public View? TrailingContent
    {
        get => (View?)GetValue(TrailingContentProperty);
        set => SetValue(TrailingContentProperty, value);
    }

    public static readonly BindableProperty NavigationAutomationIdProperty =
        BindableProperty.Create(nameof(NavigationAutomationId), typeof(string), typeof(SharedTopBar), string.Empty,
            propertyChanged: (bindable, _, value) =>
            {
                // Element.AutomationId may only be assigned once.
                if (value is string id && id.Length > 0)
                {
                    ((SharedTopBar)bindable).NavigationButton.AutomationId = id;
                }
            });
    /// <summary>AutomationId applied to the hamburger button.</summary>
    public string NavigationAutomationId
    {
        get => (string)GetValue(NavigationAutomationIdProperty);
        set => SetValue(NavigationAutomationIdProperty, value);
    }

    public SharedTopBar()
    {
        NavigationButton = new Button
        {
            Text = Fonts.FluentUI.navigation_24_regular,
            FontFamily = "FluentIcons",
            FontSize = 24,
            WidthRequest = EdgeWidth,
            Padding = 0,
            BackgroundColor = Colors.Transparent,
            VerticalOptions = LayoutOptions.Fill,
        };
        NavigationButton.SetAppThemeColor(Button.TextColorProperty, Colors.Black, Colors.White);
        SemanticProperties.SetDescription(NavigationButton, "פתיחת תפריט הניווט");
        NavigationButton.Clicked += OnBarNavigationClicked;

        _band = new Grid
        {
            ColumnDefinitions =
            [
                new ColumnDefinition(EdgeWidth),
                new ColumnDefinition(GridLength.Star),
                new ColumnDefinition(EdgeWidth),
            ],
            HeightRequest = BarHeight,
        };
        _band.SetAppThemeColor(VisualElement.BackgroundColorProperty, BandLight, BandDark);
        _band.Add(NavigationButton);
        _band.Add(_centerHost, 1, 0);
        _band.Add(_trailingHost, 2, 0);

        var separator = new BoxView
        {
            HeightRequest = 1,
            VerticalOptions = LayoutOptions.End,
            InputTransparent = true,
            ZIndex = 10,
        };
        separator.SetAppThemeColor(BoxView.ColorProperty, SeparatorLight, SeparatorDark);

        var container = new Grid { MinimumHeightRequest = BarHeight };
        container.Add(_band);
        container.Add(separator);
        Content = container;
    }

    /// <summary>
    /// Shows or hides the band's controls while keeping the hairline separator,
    /// matching how the reader overlays the detached search header.
    /// </summary>
    public bool BarVisible
    {
        get => _band.IsVisible;
        set => _band.IsVisible = value;
    }

    private void OnBarNavigationClicked(object? sender, EventArgs e)
    {
        if (NavigationInterceptor?.Invoke() == true)
        {
            return;
        }
        if (Shell.Current is not null)
        {
            Shell.Current.FlyoutIsPresented = true;
        }
    }
}
