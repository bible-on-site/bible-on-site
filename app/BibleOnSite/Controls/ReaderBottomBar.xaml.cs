namespace BibleOnSite.Controls;

/// <summary>
/// The reader's notched bottom bar — perushim chevron, text-mode, articles
/// (with count badge) and fullscreen buttons — shared by the perek, parasha
/// and masora readers so the layer cannot drift.
/// </summary>
#pragma warning disable S2333 // MAUI XAML generates the other partial declaration.
public partial class ReaderBottomBar : Grid
#pragma warning restore S2333
{
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
    }

    private void ApplyBadgeCount(int count)
    {
        ArticlesBadge.IsVisible = count > 0;
        if (count > 0)
        {
            ArticlesBadgeLabel.Text = count.ToString();
        }
    }

    private void ApplyPerushimState(bool isOpen)
    {
        PerushimChevronButton.Text = isOpen
            ? Fonts.FluentUI.chevron_down_24_regular
            : Fonts.FluentUI.chevron_up_24_regular;
    }

    private void ApplyArticlesState(bool isActive)
    {
        PerushimChevronButton.IsEnabled = !isActive;
        PerushimChevronButton.Opacity = isActive ? 0.4 : 1;
        var dark = Microsoft.Maui.Controls.Application.Current?.RequestedTheme == AppTheme.Dark;
        ArticlesButton.TextColor = isActive
            ? (dark ? Color.FromArgb("#BB86FC") : Color.FromArgb("#512BD4"))
            : (dark ? Color.FromArgb("#9CA3AF") : Color.FromArgb("#6B7280"));
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
