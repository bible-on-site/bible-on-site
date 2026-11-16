namespace BibleOnSite.Controls;

using BibleOnSite.Helpers;
using BibleOnSite.Config;

/// <summary>
/// The reader's notched bottom bar — perushim chevron, text-mode, articles
/// (with count badge) and fullscreen buttons — shared by the perek, parasha
/// and masora readers so the layer cannot drift.
/// </summary>
#pragma warning disable S2333 // MAUI XAML generates the other partial declaration.
public partial class ReaderBottomBar : Grid, IReaderBottomBarSurface
#pragma warning restore S2333
{
    private Button? _previewText;
    private Button? _previewPerushim;
    private Button? _previewArticles;
    private Border? _previewArticleBadge;
    private Label? _previewArticleCount;
    /// <summary>Height of the bar before the safe-area inset is added.</summary>
    public static double TotalHeight => HomeUxPreview.Enabled ? 108 : 90;

#pragma warning disable S3264 // Subscribed by the reader pages' code-behind; Codacy's per-file analysis misses them.
    /// <summary>Perushim chevron tapped — the page toggles the perushim sheet.</summary>
    public event EventHandler? PerushimToggleRequested;

    /// <summary>Text-mode (א ב ג) button tapped.</summary>
    public event EventHandler? TextModeRequested;

    /// <summary>Articles button tapped — the page toggles the articles view.</summary>
    public event EventHandler? ArticlesRequested;

    /// <summary>Fullscreen button tapped — the page enters fullscreen.</summary>
    public event EventHandler? FullScreenRequested;
#pragma warning restore S3264

    public static readonly BindableProperty ArticlesBadgeCountProperty =
        BindableProperty.Create(nameof(ArticlesBadgeCount), typeof(int), typeof(ReaderBottomBar), 0,
            propertyChanged: (bindable, _, value) => ((ReaderBottomBar)bindable).ApplyBadgeCount((int)value));

    /// <summary>Article count shown on the badge; 0 or less hides it.</summary>
    public int ArticlesBadgeCount
    {
        get => (int)GetValue(ArticlesBadgeCountProperty);
        set => SetValue(ArticlesBadgeCountProperty, value);
    }

    public static readonly BindableProperty IsPerushimOpenProperty =
        BindableProperty.Create(nameof(IsPerushimOpen), typeof(bool), typeof(ReaderBottomBar), false,
            propertyChanged: (bindable, _, value) => ((ReaderBottomBar)bindable).ApplyPerushimState((bool)value));

    /// <summary>Whether the perushim sheet is open — flips the chevron glyph.</summary>
    public bool IsPerushimOpen
    {
        get => (bool)GetValue(IsPerushimOpenProperty);
        set => SetValue(IsPerushimOpenProperty, value);
    }

    public static readonly BindableProperty IsArticlesActiveProperty =
        BindableProperty.Create(nameof(IsArticlesActive), typeof(bool), typeof(ReaderBottomBar), false,
            propertyChanged: (bindable, _, value) => ((ReaderBottomBar)bindable).ApplyArticlesState((bool)value));

    /// <summary>Whether the articles view is shown — tints the articles button.</summary>
    public bool IsArticlesActive
    {
        get => (bool)GetValue(IsArticlesActiveProperty);
        set => SetValue(IsArticlesActiveProperty, value);
    }

    public ReaderBottomBar()
    {
        InitializeComponent();
        if (HomeUxPreview.Enabled) { ConfigurePreviewDock(); }
        // The bar fill is resolved from the requested theme inside
        // BottomBarDrawable.Draw — repaint it when the theme flips (#2601).
        if (Microsoft.Maui.Controls.Application.Current is { } app)
        {
            // Loaded/Unloaded so a re-presented bar re-subscribes and repaints
            // with the theme that is active then.
            Loaded += (_, _) =>
            {
                app.RequestedThemeChanged += OnAppRequestedThemeChanged;
                BarSurface.Invalidate();
            };
            Unloaded += (_, _) => app.RequestedThemeChanged -= OnAppRequestedThemeChanged;
        }
    }

    private void OnAppRequestedThemeChanged(object? sender, AppThemeChangedEventArgs e) =>
        BarSurface.Invalidate();

    private void ApplyBadgeCount(int count)
    {
        if (_previewArticles is { } preview && _previewArticleBadge is { } badge && _previewArticleCount is { } label)
        {
            badge.IsVisible = count > 0 && !IsArticlesActive;
            label.Text = count.ToString();
            SemanticProperties.SetDescription(preview, IsArticlesActive ? "חזרה לפרק"
                : count > 0 ? $"מאמרי הפרק, {count} מאמרים" : "מאמרי הפרק");
        }
        ArticlesBadge.IsVisible = count > 0;
        if (count > 0)
        {
            ArticlesBadgeLabel.Text = count.ToString();
        }
    }

    private void ApplyPerushimState(bool isOpen)
    {
        ApplyPreviewDockState();
        PerushimChevronButton.Text = isOpen
            ? Fonts.FluentUI.chevron_down_24_regular
            : Fonts.FluentUI.chevron_up_24_regular;
    }

    private void ApplyArticlesState(bool isActive)
    {
        ApplyPreviewDockState();
        PerushimChevronButton.IsEnabled = !isActive;
        // The shared selected face marks the active articles action the same
        // way the preview dock marks its selected action — CompactIconSelected
        // keeps the FluentIcons glyph and 44dp target that Selected would drop.
        ArticlesButton.Style = isActive ? AppButtonStyles.CompactIconSelected : AppButtonStyles.CompactIcon;
    }

    private void ConfigurePreviewDock()
    {
        HeightRequest = TotalHeight;
        Loaded += (_, _) =>
        {
            for (Element? ancestor = Parent; ancestor is not null; ancestor = ancestor.Parent)
            {
                if (ancestor is ContentPage page)
                {
                    page.Resources["BottomBarTotalHeight"] = Math.Max(TotalHeight, HeightRequest);
                    break;
                }
            }
        };
        _previewText = PreviewAction("ניווט\nבתנ\"ך", "TextButton", Fonts.FluentUI.library_24_regular, OnTextButtonClicked);
        _previewPerushim = PreviewAction("בחירת\nפירושים", "PerushimChevronButton", Fonts.FluentUI.text_bullet_list_square_24_regular, OnPerushimChevronClicked);
        _previewArticles = PreviewAction("מאמרי\nהפרק", "ArticlesButton", Fonts.FluentUI.document_24_regular, OnArticlesButtonClicked);
        SemanticProperties.SetDescription(_previewPerushim, "בחירת הפירושים שיוצגו לצד הפסוקים");
        _previewArticleCount = new Label { FontSize = 11, FontAttributes = FontAttributes.Bold, TextColor = Colors.White };
        _previewArticleBadge = new Border
        {
            Content = _previewArticleCount, BackgroundColor = Color.FromArgb("#2866E7"),
            StrokeThickness = 0, StrokeShape = new Microsoft.Maui.Controls.Shapes.RoundRectangle { CornerRadius = 10 },
            Padding = new Thickness(6, 1), HorizontalOptions = LayoutOptions.Center, VerticalOptions = LayoutOptions.Start,
            Margin = new Thickness(32, 0, 0, 0), InputTransparent = true, IsVisible = false,
            AutomationId = "ReaderArticlesCount"
        };
        AutomationProperties.SetIsInAccessibleTree(_previewArticleBadge, false);
        var articles = new Grid();
        articles.Add(_previewArticles);
        articles.Add(_previewArticleBadge);
        var actions = new Grid
        {
            ColumnDefinitions = [new(GridLength.Star), new(GridLength.Star), new(GridLength.Star)],
            ColumnSpacing = 6,
            Padding = 6
        };
        actions.Add(_previewText);
        actions.Add(_previewPerushim, 1, 0);
        actions.Add(articles, 2, 0);
        var surface = new Border
        {
            Content = actions,
            Margin = new Thickness(14, 0, 14, 10),
            StrokeThickness = 1,
            StrokeShape = new Microsoft.Maui.Controls.Shapes.RoundRectangle { CornerRadius = 26 },
            Shadow = new Shadow { Brush = Brush.Black, Offset = new Point(0, 4), Radius = 16, Opacity = 0.10f }
        };
        surface.SetAppThemeColor(BackgroundColorProperty, Colors.White, Color.FromArgb("#1D2D43"));
        surface.SetAppTheme<Brush>(Border.StrokeProperty,
            new SolidColorBrush(Color.FromArgb("#D7E1F2")), new SolidColorBrush(Color.FromArgb("#334B6C")));
        Children.Clear();
        Add(surface);
        ApplyBadgeCount(ArticlesBadgeCount);
        ApplyPreviewDockState();
    }

    private static Button PreviewAction(string text, string id, string glyph, EventHandler tapped)
    {
        var icon = new FontImageSource { Glyph = glyph, FontFamily = "FluentIcons", Size = 24 };
        icon.SetAppThemeColor(FontImageSource.ColorProperty, AppButtonStyles.InkLight, AppButtonStyles.InkDark);
        var button = new Button
        {
            Text = text, AutomationId = id, Style = AppButtonStyles.Secondary, FontSize = 14, FontAttributes = FontAttributes.Bold,
            LineBreakMode = LineBreakMode.WordWrap,
            Padding = new Thickness(4, 5), MinimumHeightRequest = 78,
            ContentLayout = new Button.ButtonContentLayout(Button.ButtonContentLayout.ImagePosition.Top, 3),
            ImageSource = icon
        };
        button.Clicked += tapped;
        return button;
    }

    private void ApplyPreviewDockState()
    {
        if (_previewText is null || _previewPerushim is null || _previewArticles is null) { return; }
        var selected = IsArticlesActive ? _previewArticles : IsPerushimOpen ? _previewPerushim : null;
        SemanticProperties.SetDescription(_previewText, "ניווט בתנ\"ך ובחירת ספר ופרק");
        _previewArticles.Text = IsArticlesActive ? "חזרה\nלפרק" : "מאמרי\nהפרק";
        if (_previewArticles.ImageSource is FontImageSource icon)
        {
            icon.Glyph = IsArticlesActive ? Fonts.FluentUI.book_open_24_regular : Fonts.FluentUI.document_24_regular;
        }
        ApplyBadgeCount(ArticlesBadgeCount);
        foreach (var action in new[] { _previewText, _previewPerushim, _previewArticles })
        {
            action.Style = action == selected ? AppButtonStyles.Selected : AppButtonStyles.Secondary;
        }
        _previewPerushim.IsEnabled = !IsArticlesActive;
    }

    private void OnPerushimChevronClicked(object? sender, EventArgs e) =>
        PerushimToggleRequested?.Invoke(this, EventArgs.Empty);

    private void OnTextButtonClicked(object? sender, EventArgs e) =>
        TextModeRequested?.Invoke(this, EventArgs.Empty);

    private void OnArticlesButtonClicked(object? sender, EventArgs e) =>
        ArticlesRequested?.Invoke(this, EventArgs.Empty);

    private void OnFullScreenClicked(object? sender, EventArgs e) =>
        FullScreenRequested?.Invoke(this, EventArgs.Empty);
}
