using BibleOnSite.Helpers;
using BibleOnSite.Services;

namespace BibleOnSite.Controls;

/// <summary>
/// The shared top bar used by every ordinary app page so its chrome cannot
/// drift: a 56px band with a navigation capsule at the start edge, a center
/// slot (title pill / search field) and a trailing slot for page actions,
/// plus the reader's hairline separator.
///
/// The capsule is the fixed navigation group required by #2467: an
/// elliptical pill, visually related to the title pill, containing the
/// flyout hamburger and Back as separate labelled hit targets with stable
/// positions. In the app's RTL band the hamburger is always the far-right
/// control and Back sits immediately beside it toward the center; an LTR
/// interface mirrors the same order. The Back slot is reserved — it stays
/// visible and genuinely disabled at a root destination instead of
/// appearing/disappearing and shifting the hamburger — while the Android
/// Show/Hide preference still removes the affordance entirely.
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
    internal static readonly Color DisabledGlyphLight = Color.FromArgb("#8A97A8");
    internal static readonly Color DisabledGlyphDark = Color.FromArgb("#5A6B85");

    /// <summary>
    /// The capsule's own platform default before <see cref="BackChrome"/>
    /// applies the preference: Android starts hidden (system Back covers it),
    /// Windows stays hidden forever (the title bar owns Back), everything
    /// else shows the reserved slot.
    /// </summary>
    private static readonly bool CapsuleBackDefault =
        BackChromePolicy.ShowCapsuleBack(BackChrome.CurrentPlatform,
            InAppBackButtonPreference.PlatformDefault);

    private readonly Grid _band;
    private readonly Border _capsuleBorder;
    private readonly HorizontalStackLayout _capsule;
    private readonly ContentView _centerHost = new();
    private readonly ContentView _trailingHost = new();

    /// <summary>The hamburger inside the capsule; always opens the Shell flyout.</summary>
    public Button NavigationButton { get; }

    /// <summary>
    /// The capsule's Back slot: a FluentUI arrow whose glyph follows the
    /// effective interface direction, kept visible-but-disabled when there is
    /// no applicable in-app return. Rides the same shared back pipeline as
    /// every other Back input — it can never become an app-exit control.
    /// </summary>
    public Button BackButton { get; }

    /// <summary>The capsule layout holding hamburger first and Back second.</summary>
    public HorizontalStackLayout NavCapsule => _capsule;

    /// <summary>
    /// Override for the flyout action, kept injectable for tests. The
    /// hamburger has exactly one job — opening the flyout — and is never
    /// repurposed into Back/Close (#2467).
    /// </summary>
    public Action? FlyoutOpener { get; set; }

    /// <summary>
    /// Reports a page-owned transient return surface (focused pasuk, open
    /// menu, fullscreen, search) that keeps Back enabled at a root
    /// destination — the same surfaces the shared pipeline consumes first.
    /// </summary>
    public Func<bool>? BackStateProvider { get; set; }

    /// <summary>
    /// Routes the enabled Back press; defaults to the shared
    /// <see cref="Microsoft.Maui.IWindow.BackButtonClicked"/> pipeline.
    /// Injectable for tests.
    /// </summary>
    public Func<bool>? BackInvoker { get; set; }

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

    public static readonly BindableProperty ShowBackProperty =
        BindableProperty.Create(nameof(ShowBack), typeof(bool), typeof(SharedTopBar), CapsuleBackDefault,
            propertyChanged: (bindable, _, value) =>
                ((SharedTopBar)bindable).BackButton.IsVisible = (bool)value);
    /// <summary>
    /// Whether the capsule reserves its Back slot at all. Driven by
    /// <see cref="BackChrome"/> from the persisted platform preference —
    /// visibility only; enabled state is derived separately.
    /// </summary>
    public bool ShowBack
    {
        get => (bool)GetValue(ShowBackProperty);
        set => SetValue(ShowBackProperty, value);
    }

    public static readonly BindableProperty BackEnabledProperty =
        BindableProperty.Create(nameof(BackEnabled), typeof(bool), typeof(SharedTopBar), false,
            propertyChanged: (bindable, _, _) => ((SharedTopBar)bindable).ApplyBackEnabledVisual());
    /// <summary>
    /// Whether the capsule Back is actionable. Disabled means genuinely
    /// non-actionable (<c>Button.IsEnabled</c> false plus grey glyph),
    /// not a live button merely painted grey (#2467).
    /// </summary>
    public bool BackEnabled
    {
        get => (bool)GetValue(BackEnabledProperty);
        set => SetValue(BackEnabledProperty, value);
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

        BackButton = new Button
        {
            Text = BackGlyph(FlowDirection.RightToLeft),
            FontFamily = "FluentIcons",
            FontSize = 22,
            WidthRequest = EdgeWidth,
            Padding = 0,
            BackgroundColor = Colors.Transparent,
            VerticalOptions = LayoutOptions.Fill,
            IsVisible = CapsuleBackDefault,
            IsEnabled = false,
            AutomationId = "TopBarBackButton",
        };
        SemanticProperties.SetDescription(BackButton, "חזור");
        ApplyBackEnabledVisual();
        BackButton.Clicked += OnBackClicked;

        // Flow order inside the capsule is the contract: hamburger owns the
        // start edge (far right in RTL), Back is its immediate neighbour
        // toward the title. Root versus pushed never reorders them.
        _capsule = new HorizontalStackLayout { Spacing = 0 };
        _capsule.Add(NavigationButton);
        _capsule.Add(BackButton);
        _capsuleBorder = new Border
        {
            StrokeShape = new Microsoft.Maui.Controls.Shapes.RoundRectangle
            {
                CornerRadius = PillCornerRadius,
            },
            Stroke = Colors.Transparent,
            StrokeThickness = 0,
            Padding = new Thickness(2, 0),
            HeightRequest = PillHeight,
            Margin = new Thickness(4, 0),
            VerticalOptions = LayoutOptions.Center,
            Content = _capsule,
        };
        _capsuleBorder.SetAppThemeColor(VisualElement.BackgroundColorProperty,
            ToolbarPill.LightColor, ToolbarPill.DarkColor);

        _band = new Grid
        {
            ColumnDefinitions =
            [
                new ColumnDefinition(GridLength.Auto),
                new ColumnDefinition(GridLength.Star),
                new ColumnDefinition(EdgeWidth),
            ],
            HeightRequest = BarHeight,
        };
        _band.SetAppThemeColor(VisualElement.BackgroundColorProperty, BandLight, BandDark);
        _band.Add(_capsuleBorder);
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
        Loaded += (_, _) => RefreshBackState();
    }

    /// <summary>
    /// Width reserved by both edge slots (capsule + trailing host). The
    /// search-expansion animation measures the center pill against this, so
    /// it must reflect the real capsule width rather than a fixed guess.
    /// </summary>
    public double EdgeChromeWidth => _capsuleBorder.Width + _trailingHost.Width;

    /// <summary>
    /// Shows or hides the band's controls while keeping the hairline separator,
    /// matching how the reader overlays the detached search header.
    /// </summary>
    public bool BarVisible
    {
        get => _band.IsVisible;
        set => _band.IsVisible = value;
    }

    /// <summary>
    /// Re-derives <see cref="BackEnabled"/> from the single navigation state:
    /// the Shell back stack depth plus any page-owned transient surface
    /// reported through <see cref="BackStateProvider"/>. Called on navigation
    /// (by <see cref="BackChrome"/>), on load, and whenever a page mutates a
    /// surface that owns Back.
    /// </summary>
    public void RefreshBackState() => RefreshBackState(AncestorStackDepth());

    /// <summary>Same refresh with a known stack depth (the Shell applier
    /// already resolved it, so the bar need not walk its ancestors).</summary>
    public void RefreshBackState(int stackDepth)
    {
        BackEnabled = stackDepth > 1 || (BackStateProvider?.Invoke() ?? false);
    }

    /// <summary>Resolves the Back arrow from the effective interface flow
    /// direction, not the device language: RTL points right, LTR points left
    /// (#2467). The FluentIcons glyphs are not auto-mirrored, so choosing the
    /// correct glyph here is the single mirroring step.</summary>
    internal static string BackGlyph(FlowDirection direction) =>
        direction == FlowDirection.LeftToRight
            ? Fonts.FluentUI.arrow_left_24_regular
            : Fonts.FluentUI.arrow_right_24_regular;

    protected override void OnParentSet()
    {
        base.OnParentSet();
        ApplyPersistedBackVisibility();
        ApplyBackGlyph();
        RefreshBackState();
    }

    /// <summary>
    /// Applies the persisted Back-slot visibility the moment the bar enters
    /// the tree, so chrome does not depend on the Shell reaching the page in
    /// time — the startup content swap and re-parented pages never pass
    /// through <see cref="BackChrome"/> before the first frame (#2467).
    /// Navigation-time applies still own later updates.
    /// </summary>
    private void ApplyPersistedBackVisibility()
    {
        // An explicit ShowBack (XAML value or a BackChrome apply) always
        // wins — this only fills in the default for bars nobody claimed.
        if (IsSet(ShowBackProperty))
        {
            return;
        }

        ShowBack = BackChromePolicy.ShowCapsuleBack(BackChrome.CurrentPlatform,
            PreferencesService.Instance.InAppBackButton);
    }

    private void ApplyBackGlyph() => BackButton.Text = BackGlyph(ResolveFlowDirection());

    private FlowDirection ResolveFlowDirection()
    {
        for (Element? element = this; element is not null; element = element.Parent)
        {
            // Only explicit directions count: MatchParent means "not decided
            // here", so keep walking to the ancestor that pins the flow.
            if (element is VisualElement visual &&
                visual.FlowDirection is FlowDirection.LeftToRight or FlowDirection.RightToLeft)
            {
                return visual.FlowDirection;
            }
        }
        // Every app page pins a Hebrew RTL interface; an English device keeps
        // the mirrored RTL glyph rather than falling back to the OS locale.
        return FlowDirection.RightToLeft;
    }

    private int AncestorStackDepth()
    {
        for (var element = Parent; element is not null; element = element.Parent)
        {
            if (element is Page page)
            {
                return page.Navigation.NavigationStack.Count;
            }
        }
        return 0;
    }

    private void ApplyBackEnabledVisual()
    {
        var enabled = BackEnabled;
        BackButton.IsEnabled = enabled;
        BackButton.SetAppThemeColor(Button.TextColorProperty,
            enabled ? Colors.Black : DisabledGlyphLight,
            enabled ? Colors.White : DisabledGlyphDark);
    }

    private void OnBackClicked(object? sender, EventArgs e)
    {
        // Never trust the painted state: re-derive from the live coordinator
        // first, so a stale enabled paint can't skip straight to leaving the
        // app — a disabled control must be genuinely non-actionable (#2467).
        RefreshBackState();
        if (!BackEnabled)
        {
            return;
        }
        _ = (BackInvoker ?? InvokeSharedBack)();
        // Consumption usually retires the transient surface — keep the paint
        // in step with the state the press just left behind.
        RefreshBackState();
    }

    private bool InvokeSharedBack() =>
        Window is { } window && ((Microsoft.Maui.IWindow)window).BackButtonClicked();

    private void OnBarNavigationClicked(object? sender, EventArgs e)
    {
        if (FlyoutOpener is { } opener)
        {
            opener();
            return;
        }
        if (Shell.Current is not null)
        {
            Shell.Current.FlyoutIsPresented = true;
        }
    }
}
