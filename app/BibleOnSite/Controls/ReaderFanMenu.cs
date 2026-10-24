using System.Collections.ObjectModel;
using BibleOnSite.Helpers;
using Microsoft.Maui.Layouts;

namespace BibleOnSite.Controls;

/// <summary>
/// The reader's expandable navigation fan shared by the perek, parasha and
/// masora readers: a scrim that dims the page, the satellite buttons laid out
/// on the elliptical fan computed by <see cref="FanMenuGeometry"/>, and the
/// central FAB that toggles the whole thing with animation.
///
/// Pages supply the satellites (each with its own AutomationId/Command/Clicked
/// wiring) and handle domain actions; the control owns the scrim, the toggle,
/// geometry, open/close animation and pressed-state logging, so the layer
/// cannot drift between readers.
/// </summary>
public class ReaderFanMenu : Grid
{
    private readonly Grid _scrim;
    private readonly AbsoluteLayout _container;
    private readonly ObservableCollection<View> _satellites = [];

    private bool _isOpen;

    /// <summary>
    /// The satellite views, in fan order (left-most to right-most along the
    /// arc). Pages populate this in XAML; each item is usually a
    /// <see cref="ReaderFanMenuSatellite"/>.
    /// </summary>
    public IList<View> Satellites => _satellites;

    /// <summary>The central open/close FAB (exposed for touch hit-testing).</summary>
    public Button ToggleButton { get; }

    /// <summary>Whether the fan is currently open.</summary>
    public bool IsOpen => _isOpen;

    /// <summary>
    /// Raised synchronously at the start of the open animation — the page
    /// refreshes per-satellite enabled state there (e.g. prev/next CanExecute),
    /// so disabled buttons fade in at their dimmed opacity.
    /// </summary>
#pragma warning disable S3264 // Subscribed by the reader pages' code-behind; Codacy's per-file analysis misses them.
    public event EventHandler? Opening;
#pragma warning restore S3264

    public ReaderFanMenu()
    {
        // The control fills the page grid row but must not hit-test outside its
        // buttons (the original AbsoluteLayout had InputTransparent + no cascade);
        // otherwise on iOS it swallows every hit-test and WDA reports all covered
        // elements as not displayed.
        InputTransparent = true;
        CascadeInputTransparent = false;

        // Scrim: dims the page (verses included) while the fan is open.
        // A tap anywhere dismisses the menu instead of hitting what is behind it.
        _scrim = new Grid
        {
            AutomationId = "CircularMenuScrim",
            IsVisible = false,
            Opacity = 0,
            BackgroundColor = Color.FromArgb("#66000000")
        };
        var scrimTap = new TapGestureRecognizer();
        scrimTap.Tapped += OnScrimTapped;
        _scrim.GestureRecognizers.Add(scrimTap);

        // Satellite + toggle overlay — AbsoluteLayout for precise positioning.
        _container = new AbsoluteLayout
        {
            InputTransparent = true,
            CascadeInputTransparent = false,
            BackgroundColor = Colors.Transparent
        };

        ToggleButton = new Button
        {
            AutomationId = "CircularMenuButton",
            Text = Fonts.FluentUI.navigation_24_regular,
            FontFamily = "FluentIcons",
            FontSize = 22,
            WidthRequest = 56,
            HeightRequest = 56,
            CornerRadius = 28,
            TextColor = Colors.White,
            Shadow = new Shadow
            {
                Brush = Brush.Black,
                Offset = new Point(0, 3),
                Radius = 6,
                Opacity = 0.3f
            }
        };
        if (Microsoft.Maui.Controls.Application.Current?.Resources.TryGetValue("Primary", out var primary) == true
            && primary is Color primaryColor)
        {
            ToggleButton.BackgroundColor = primaryColor;
        }
        ToggleButton.Pressed += OnTogglePressed;
        ToggleButton.Released += OnToggleReleased;
        ToggleButton.Clicked += OnToggleClicked;
        _container.Children.Add(ToggleButton);

        Children.Add(_scrim);
        Children.Add(_container);

        _satellites.CollectionChanged += (_, e) =>
        {
            if (e.NewItems == null)
            {
                return;
            }
            foreach (View item in e.NewItems)
            {
                _container.Children.Insert(0, item); // satellites sit under the toggle
            }
            LayoutFan();
        };
        _container.SizeChanged += (_, _) => LayoutFan();
    }

    /// <summary>
    /// Applies the bottom safe-area inset: the fan floats above the gesture
    /// bar, and the padding keeps the fan geometry inside the usable canvas.
    /// </summary>
    public void SetBottomInset(double bottom)
    {
        _container.TranslationY = bottom;
        _container.Padding = new Thickness(0, 0, 0, bottom);
        LayoutFan();
    }

    /// <summary>Positions the toggle and the satellites on the fan.</summary>
    private void LayoutFan()
    {
        var width = _container.Width - _container.Padding.HorizontalThickness;
        var height = _container.Height - _container.Padding.VerticalThickness;
        if (width <= 0 || height <= 0 || _satellites.Count == 0)
        {
            return;
        }

        var layout = FanMenuGeometry.Compute(width, height, _satellites.Count);
        ApplyBounds(ToggleButton, layout.Toggle);
        for (var i = 0; i < _satellites.Count && i < layout.Items.Count; i++)
        {
            ApplyBounds(_satellites[i], layout.Items[i]);
        }
    }

    private static void ApplyBounds(View view, Rect bounds)
    {
        AbsoluteLayout.SetLayoutFlags(view, AbsoluteLayoutFlags.None);
        AbsoluteLayout.SetLayoutBounds(view, bounds);
    }

    private void OnTogglePressed(object? sender, EventArgs e) =>
        DebugLog.Write($"[CircularMenu] Pressed: open={_isOpen}");

    private void OnToggleReleased(object? sender, EventArgs e) =>
        DebugLog.Write($"[CircularMenu] Released: open={_isOpen}");

    private async void OnToggleClicked(object? sender, EventArgs e)
    {
        DebugLog.Write($"[CircularMenu] Clicked: open={!_isOpen}");

        if (_isOpen)
        {
            await CloseAsync();
        }
        else
        {
            await OpenAsync();
        }
    }

    /// <summary>Opens the fan if it is closed.</summary>
    public Task OpenAsync() => _isOpen ? Task.CompletedTask : ToggleAsync();

    /// <summary>Closes the fan if it is open.</summary>
    public Task CloseAsync() => _isOpen ? ToggleAsync() : Task.CompletedTask;

    /// <summary>Toggles the fan with animation.</summary>
    public async Task ToggleAsync()
    {
        _isOpen = !_isOpen;
        if (_isOpen)
        {
            await AnimateOpenAsync();
        }
        else
        {
            await AnimateCloseAsync();
        }
    }

    /// <summary>Opens the fan with animated expansion.</summary>
    private async Task AnimateOpenAsync()
    {
        // Let the page refresh per-satellite enabled state before the fade-in
        // picks each button's target opacity.
        Opening?.Invoke(this, EventArgs.Empty);

        // Enable clicks and set initial opacity (buttons at final positions via AbsoluteLayout)
        foreach (var satellite in _satellites)
        {
            satellite.InputTransparent = false;
            satellite.Opacity = 0;
        }

        _scrim.IsVisible = true;

        // Change FAB icon to X
        ToggleButton.Text = Fonts.FluentUI.dismiss_24_regular;
        ToggleButton.BackgroundColor = Colors.Red;

        // Animate FAB rotation and fade in all buttons (disabled = 0.4, enabled = 1)
        var animations = new List<Task>
        {
            ToggleButton.RotateToAsync(180, 250, Easing.SpringOut),
            _scrim.FadeToAsync(1, 200)
        };

        foreach (var satellite in _satellites)
        {
            var targetOpacity = satellite.IsEnabled ? 1.0 : 0.4;
            animations.Add(satellite.FadeToAsync(targetOpacity, 200));
        }

        await Task.WhenAll(animations);
        DebugLog.Write($"[CircularMenu] Open animation complete: open={_isOpen}");
    }

    /// <summary>Closes the fan with animated contraction.</summary>
    private async Task AnimateCloseAsync()
    {
        ToggleButton.Text = Fonts.FluentUI.navigation_24_regular;
        ToggleButton.BackgroundColor = (Color)Microsoft.Maui.Controls.Application.Current!.Resources["Primary"];

        var animations = new List<Task>
        {
            ToggleButton.RotateToAsync(0, 200, Easing.SpringOut),
            _scrim.FadeToAsync(0, 150)
        };

        foreach (var satellite in _satellites)
        {
            animations.Add(satellite.FadeToAsync(0, 150));
        }

        await Task.WhenAll(animations);

        // A reopen during the close animation wins — leave scrim and satellites alone
        if (_isOpen)
        {
            return;
        }

        _scrim.IsVisible = false;

        // Disable clicks on hidden buttons
        foreach (var satellite in _satellites)
        {
            satellite.InputTransparent = true;
        }
        DebugLog.Write($"[CircularMenu] Close animation complete: open={_isOpen}");
    }

    /// <summary>Handles tap on the scrim — dismisses the open fan.</summary>
    private async void OnScrimTapped(object? sender, TappedEventArgs e)
    {
        if (_isOpen)
        {
            _isOpen = false;
            await AnimateCloseAsync();
        }
    }

    /// <summary>
    /// Snaps the fan to its fully closed visual state without animation —
    /// used when the reader enters fullscreen with the fan mid-open.
    /// </summary>
    public void ResetToClosed()
    {
        _isOpen = false;
        foreach (var satellite in _satellites)
        {
            satellite.Opacity = 0;
            satellite.InputTransparent = true;
        }
        ToggleButton.Text = Fonts.FluentUI.navigation_24_regular;
        ToggleButton.BackgroundColor = (Color)Microsoft.Maui.Controls.Application.Current!.Resources["Primary"];
        ToggleButton.Rotation = 0;
        _scrim.Opacity = 0;
        _scrim.IsVisible = false;
    }
}
