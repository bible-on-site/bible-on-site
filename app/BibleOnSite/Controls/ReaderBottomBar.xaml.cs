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
    /// <summary>Height of the bar before the safe-area inset is added.</summary>
    public static double TotalHeight => 90;

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
        if (_previewArticles is { } preview)
        {
            preview.Text = count > 0 ? $"מאמרים {count}" : "מאמרים";
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
        PerushimChevronButton.Opacity = isActive ? 0.4 : 1;
        // Brand accent marks the active state, muted gray marks inactive.
        // SetAppThemeColor keeps this live on theme flips.
        if (isActive)
        {
            ArticlesButton.SetAppThemeColor(Button.TextColorProperty,
                Color.FromArgb("#512BD4"), Color.FromArgb("#AACBFF"));
        }
        else
        {
            ArticlesButton.SetAppThemeColor(Button.TextColorProperty,
                Color.FromArgb("#6B7280"), Color.FromArgb("#9CA3AF"));
        }
    }

    private void ConfigurePreviewDock()
    {
        _previewText = PreviewAction("קריאה", "TextButton", Fonts.FluentUI.book_open_24_regular, OnTextButtonClicked);
        _previewPerushim = PreviewAction("פירושים", "PerushimChevronButton", Fonts.FluentUI.library_24_regular, OnPerushimChevronClicked);
        _previewArticles = PreviewAction("מאמרים", "ArticlesButton", Fonts.FluentUI.document_24_regular, OnArticlesButtonClicked);
        var actions = new Grid
        {
            ColumnDefinitions = [new(GridLength.Star), new(GridLength.Star), new(GridLength.Star)],
            ColumnSpacing = 6,
            Padding = 6
        };
        actions.Add(_previewText);
        actions.Add(_previewPerushim, 1, 0);
        actions.Add(_previewArticles, 2, 0);
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
        ApplyPreviewDockState();
    }

    private static Button PreviewAction(string text, string id, string glyph, EventHandler tapped)
    {
        var button = new Button
        {
            Text = text, AutomationId = id, FontSize = 15, FontAttributes = FontAttributes.Bold,
            CornerRadius = 19, Padding = new Thickness(4, 5), MinimumHeightRequest = 66,
            ContentLayout = new Button.ButtonContentLayout(Button.ButtonContentLayout.ImagePosition.Top, 3),
            ImageSource = new FontImageSource { Glyph = glyph, FontFamily = "FluentIcons", Size = 24, Color = Color.FromArgb("#2866E7") }
        };
        button.SetAppThemeColor(Button.TextColorProperty, Color.FromArgb("#192B45"), Color.FromArgb("#F2EFE6"));
        button.Clicked += tapped;
        return button;
    }

    private void ApplyPreviewDockState()
    {
        if (_previewText is null || _previewPerushim is null || _previewArticles is null) { return; }
        var selected = IsArticlesActive ? _previewArticles : IsPerushimOpen ? _previewPerushim : _previewText;
        foreach (var action in new[] { _previewText, _previewPerushim, _previewArticles })
        {
            action.SetAppThemeColor(BackgroundColorProperty,
                action == selected ? Color.FromArgb("#DEE7F7") : Colors.Transparent,
                action == selected ? Color.FromArgb("#314F78") : Colors.Transparent);
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
