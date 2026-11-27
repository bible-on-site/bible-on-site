namespace BibleOnSite.Controls;

using BibleOnSite.Helpers;

/// <summary>
/// The reader's ⋮ options dropdown shared by the perek and parasha readers:
/// שניים מקרא, תיקון קוראים and הסתר שם השם toggles. Tapping an item raises
/// its event and closes the panel; tapping the dimmed page around it just
/// dismisses it. In articles mode (<see cref="IsArticlesMode"/>) only the
/// הסתר שם השם row is available — the scripture reading modes do not apply
/// to an article catalogue (#3401).
/// </summary>
#pragma warning disable S2333 // MAUI XAML generates the other partial declaration.
public partial class ReaderMenuPanel : Grid, IReaderMenuSurface
#pragma warning restore S2333
{
#pragma warning disable S3264 // Subscribed by the reader pages' code-behind; Codacy's per-file analysis misses them.
    /// <summary>שניים מקרא row tapped — the page flips the view-model flag.</summary>
    public event EventHandler? ShnayimMikraToggled;

    /// <summary>תיקון קוראים row tapped — the page flips the view-model flag.</summary>
    public event EventHandler? TikkunKorimToggled;

    /// <summary>הסתר שם השם row tapped — the page flips the view-model flag.</summary>
    public event EventHandler? DivineNameMaskingToggled;
    public event EventHandler? SearchRequested;
#pragma warning restore S3264

    public static readonly BindableProperty IsArticlesModeProperty =
        BindableProperty.Create(nameof(IsArticlesMode), typeof(bool), typeof(ReaderMenuPanel), false);

    /// <summary>
    /// Whether the active content is the articles view. The shared reader
    /// chrome drives this with its articles/text swap; the XAML rows bind
    /// their visibility to it so a hidden action leaves no layout space,
    /// hit target, focus stop or accessibility node (#3401).
    /// </summary>
    public bool IsArticlesMode
    {
        get => (bool)GetValue(IsArticlesModeProperty);
        set => SetValue(IsArticlesModeProperty, value);
    }

    public ReaderMenuPanel()
    {
        InitializeComponent();
        if (Config.HomeUxPreview.Enabled) { ConfigurePreviewTools(); }
    }

    private void ConfigurePreviewTools()
    {
        BackgroundColor = Color.FromArgb("#40000000");
        if (Children.OfType<Border>().FirstOrDefault() is not { Content: VerticalStackLayout rows } panel) { return; }
        panel.HorizontalOptions = LayoutOptions.Fill;
        panel.VerticalOptions = LayoutOptions.End;
        panel.Margin = new Thickness(16, 0, 16, ReaderBottomBar.TotalHeight + 14);
        panel.Padding = 16;
        panel.StrokeShape = new Microsoft.Maui.Controls.Shapes.RoundRectangle { CornerRadius = 26 };
        rows.Spacing = 4;
        rows.Insert(0, new Label { Text = "כלי הקריאה", FontSize = 26, FontAttributes = FontAttributes.Bold, Margin = new Thickness(8, 0, 8, 10) });
        foreach (var target in rows.Children.OfType<TappableView>())
        {
            target.MinimumHeightRequest = 60;
            if (target.Content is Grid row)
            {
                row.MinimumHeightRequest = 60;
                foreach (var label in row.Children.OfType<Grid>().SelectMany(grid => grid.Children.OfType<Label>()))
                {
                    label.FontSize = 18;
                }
            }
        }
        rows.Add(ToolAction("חיפוש", "ReaderGlobalSearch", (_, _) => SearchRequested?.Invoke(this, EventArgs.Empty)));
        panel.Content = null;
        panel.Content = new ScrollView { Content = rows, VerticalOptions = LayoutOptions.Start };
        SizeChanged += (_, _) => panel.MaximumHeightRequest = Math.Max(220, Height - ReaderBottomBar.TotalHeight - 40);
    }

    private Button ToolAction(string title, string id, EventHandler selected)
    {
        var action = new Button
        {
            Text = title, AutomationId = id, Style = AppButtonStyles.Secondary, HeightRequest = 56, FontSize = 17,
            FontAttributes = FontAttributes.Bold
        };
        action.Clicked += (_, args) => { Close(); selected(this, args); };
        return action;
    }

    /// <summary>Whether the dropdown is currently shown.</summary>
    public bool IsOpen => IsVisible;

    /// <summary>Toggles the dropdown's visibility.</summary>
    public void Toggle() => IsVisible = !IsVisible;

    /// <summary>Dismisses the dropdown.</summary>
    public void Close() => IsVisible = false;

    private void OnDismissed(object? sender, TappedEventArgs e) => Close();

    // Internal so unit tests drive the same activation the XAML's
    // Activated="…" wiring raises (the TappableView.SendActivated contract).
    internal void OnShnayimMikraTapped(object? sender, TappedEventArgs e)
    {
        Close();
        // A stale callback must not flip a scripture mode while articles are
        // shown — the hidden row has no live hit target of its own (#3401).
        if (IsArticlesMode)
        {
            return;
        }

        ShnayimMikraToggled?.Invoke(this, EventArgs.Empty);
    }

    internal void OnTikkunKorimTapped(object? sender, TappedEventArgs e)
    {
        Close();
        if (IsArticlesMode)
        {
            return;
        }

        TikkunKorimToggled?.Invoke(this, EventArgs.Empty);
    }

    internal void OnDivineNameMaskingTapped(object? sender, TappedEventArgs e)
    {
        Close();
        DivineNameMaskingToggled?.Invoke(this, EventArgs.Empty);
    }
}
