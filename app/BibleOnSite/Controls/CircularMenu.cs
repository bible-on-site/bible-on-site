using Microsoft.Maui.Controls.Shapes;

namespace BibleOnSite.Controls;

/// <summary>
/// A circular menu control that expands from a central button.
/// Inspired by the Flutter circular_menu package used in the legacy app.
/// </summary>
public partial class CircularMenu : ContentView
{
    private bool _isExpanded;
    private readonly Grid _container;
    private readonly Button _toggleButton;
    private readonly List<CircularMenuItem> _menuItems = [];
    private readonly double _startAngle;
    private readonly double _endAngle;
    private readonly double _radius;

    /// <summary>
    /// Bindable property for menu items.
    /// </summary>
    public static readonly BindableProperty ItemsProperty = BindableProperty.Create(
        nameof(Items),
        typeof(IList<CircularMenuItem>),
        typeof(CircularMenu),
        defaultValue: null,
        propertyChanged: OnItemsChanged);

    /// <summary>
    /// Bindable property for the menu radius.
    /// </summary>
    public static readonly BindableProperty RadiusProperty = BindableProperty.Create(
        nameof(Radius),
        typeof(double),
        typeof(CircularMenu),
        80.0);

    /// <summary>
    /// Bindable property for toggle button size.
    /// </summary>
    public static readonly BindableProperty ToggleButtonSizeProperty = BindableProperty.Create(
        nameof(ToggleButtonSize),
        typeof(double),
        typeof(CircularMenu),
        56.0);

    /// <summary>
    /// Bindable property for toggle button color.
    /// </summary>
    public static readonly BindableProperty ToggleButtonColorProperty = BindableProperty.Create(
        nameof(ToggleButtonColor),
        typeof(Color),
        typeof(CircularMenu),
        Colors.Blue);

    /// <summary>
    /// Gets or sets the menu items.
    /// </summary>
    public IList<CircularMenuItem>? Items
    {
        get => (IList<CircularMenuItem>?)GetValue(ItemsProperty);
        set => SetValue(ItemsProperty, value);
    }

    /// <summary>
    /// Gets or sets the expansion radius.
    /// </summary>
    public double Radius
    {
        get => (double)GetValue(RadiusProperty);
        set => SetValue(RadiusProperty, value);
    }

    /// <summary>
    /// Gets or sets the toggle button size.
    /// </summary>
    public double ToggleButtonSize
    {
        get => (double)GetValue(ToggleButtonSizeProperty);
        set => SetValue(ToggleButtonSizeProperty, value);
    }

    /// <summary>
    /// Gets or sets the toggle button color.
    /// </summary>
    public Color ToggleButtonColor
    {
        get => (Color)GetValue(ToggleButtonColorProperty);
        set => SetValue(ToggleButtonColorProperty, value);
    }

    /// <summary>
    /// Gets whether the menu is currently expanded.
    /// </summary>
    public bool IsExpanded => _isExpanded;

    /// <summary>
    /// Event raised when the menu opens or closes.
    /// </summary>
    public event EventHandler<bool>? ExpandedChanged;

    /// <summary>
    /// Creates a new CircularMenu.
    /// </summary>
    /// <param name="startAngle">Start angle in radians (default: ~1.22π for bottom arc)</param>
    /// <param name="endAngle">End angle in radians (default: ~1.78π for bottom arc)</param>
    public CircularMenu(double startAngle = 3.8336, double endAngle = 5.5945)
    {
        _startAngle = startAngle;
        _endAngle = endAngle;
        _radius = 80;
        _isExpanded = false;

        _container = new Grid
        {
            HorizontalOptions = LayoutOptions.Center,
            VerticalOptions = LayoutOptions.End
        };

        // Create toggle button with circular shape
        _toggleButton = new Button
        {
            Text = "☰",
            FontSize = 24,
            WidthRequest = ToggleButtonSize,
            HeightRequest = ToggleButtonSize,
            CornerRadius = (int)(ToggleButtonSize / 2),
            BackgroundColor = ToggleButtonColor,
            TextColor = Colors.White,
            Padding = 0,
            Shadow = new Shadow
            {
                Brush = Brush.Black,
                Offset = new Point(0, 2),
                Radius = 4,
                Opacity = 0.3f
            }
        };
        _toggleButton.Clicked += OnToggleClicked;

        _container.Add(_toggleButton);

        Content = _container;
    }

    private static void OnItemsChanged(BindableObject bindable, object oldValue, object newValue)
    {
        if (bindable is CircularMenu menu && newValue is IList<CircularMenuItem> items)
        {
            menu.SetupMenuItems(items);
        }
    }

    private void SetupMenuItems(IList<CircularMenuItem> items)
    {
        _menuItems.Clear();
        _menuItems.AddRange(items);

        // Create visual elements for each menu item (initially hidden)
        foreach (var item in _menuItems)
        {
            item.IsVisible = false;
            item.Opacity = 0;
            item.Scale = 0;
            _container.Insert(0, item); // Add behind toggle button
        }

        PositionMenuItems(false);
    }

    private void OnToggleClicked(object? sender, EventArgs e)
    {
        Toggle();
    }

    /// <summary>
    /// Toggles the menu open/closed state.
    /// </summary>
    public void Toggle()
    {
        _isExpanded = !_isExpanded;
        AnimateMenu();
        ExpandedChanged?.Invoke(this, _isExpanded);
    }

    /// <summary>
    /// Opens the menu if closed.
    /// </summary>
    public void Open()
    {
        if (!_isExpanded)
        {
            Toggle();
        }
    }

    /// <summary>
    /// Closes the menu if open.
    /// </summary>
    public void Close()
    {
        if (_isExpanded)
        {
            Toggle();
        }
    }

    private void AnimateMenu()
    {
        // Animate toggle button rotation
        _toggleButton.RotateTo(_isExpanded ? 45 : 0, 300, Easing.BounceOut);

        // Position and animate menu items
        PositionMenuItems(_isExpanded);
    }

    private void PositionMenuItems(bool expanded)
    {
        if (_menuItems.Count == 0) return;

        var itemCount = _menuItems.Count;
        var angleStep = (itemCount > 1) ? (_endAngle - _startAngle) / (itemCount - 1) : 0;
        var radius = Radius;

        for (int i = 0; i < itemCount; i++)
        {
            var item = _menuItems[i];
            var angle = _startAngle + (angleStep * i);

            if (expanded)
            {
                // Calculate position on arc
                var x = Math.Cos(angle) * radius;
                var y = Math.Sin(angle) * radius;

                item.IsVisible = true;
                item.TranslationX = 0;
                item.TranslationY = 0;

                // Animate to position
                item.TranslateTo(x, y, 300, Easing.BounceOut);
                item.FadeTo(1, 200);
                item.ScaleTo(1, 300, Easing.BounceOut);
            }
            else
            {
                // Animate back to center
                item.TranslateTo(0, 0, 200, Easing.CubicIn);
                item.FadeTo(0, 150);
                item.ScaleTo(0, 200, Easing.CubicIn);

                // Hide after animation
                _ = Task.Delay(200).ContinueWith(_ =>
                {
                    MainThread.BeginInvokeOnMainThread(() => item.IsVisible = false);
                });
            }
        }
    }
}

/// <summary>
/// A single item in a CircularMenu.
/// </summary>
public class CircularMenuItem : Border
{
    /// <summary>
    /// Bindable property for the icon.
    /// </summary>
    public static readonly BindableProperty IconProperty = BindableProperty.Create(
        nameof(Icon),
        typeof(string),
        typeof(CircularMenuItem),
        "●",
        propertyChanged: OnIconChanged);

    /// <summary>
    /// Bindable property for the item color.
    /// </summary>
    public static readonly BindableProperty ItemColorProperty = BindableProperty.Create(
        nameof(ItemColor),
        typeof(Color),
        typeof(CircularMenuItem),
        Colors.Blue,
        propertyChanged: OnColorChanged);

    /// <summary>
    /// Bindable property for the icon color.
    /// </summary>
    public static readonly BindableProperty IconColorProperty = BindableProperty.Create(
        nameof(IconColor),
        typeof(Color),
        typeof(CircularMenuItem),
        Colors.White,
        propertyChanged: OnIconColorChanged);

    /// <summary>
    /// Bindable property for the item size.
    /// </summary>
    public static readonly BindableProperty ItemSizeProperty = BindableProperty.Create(
        nameof(ItemSize),
        typeof(double),
        typeof(CircularMenuItem),
        48.0,
        propertyChanged: OnSizeChanged);

    private readonly Label _iconLabel;

    /// <summary>
    /// Gets or sets the icon text (Unicode character or emoji).
    /// </summary>
    public string Icon
    {
        get => (string)GetValue(IconProperty);
        set => SetValue(IconProperty, value);
    }

    /// <summary>
    /// Gets or sets the background color.
    /// </summary>
    public Color ItemColor
    {
        get => (Color)GetValue(ItemColorProperty);
        set => SetValue(ItemColorProperty, value);
    }

    /// <summary>
    /// Gets or sets the icon color.
    /// </summary>
    public Color IconColor
    {
        get => (Color)GetValue(IconColorProperty);
        set => SetValue(IconColorProperty, value);
    }

    /// <summary>
    /// Gets or sets the item size (diameter).
    /// </summary>
    public double ItemSize
    {
        get => (double)GetValue(ItemSizeProperty);
        set => SetValue(ItemSizeProperty, value);
    }

    /// <summary>
    /// Event raised when the item is tapped.
    /// </summary>
    public event EventHandler? Tapped;

    public CircularMenuItem()
    {
        _iconLabel = new Label
        {
            Text = Icon,
            FontSize = 24,
            TextColor = IconColor,
            HorizontalTextAlignment = TextAlignment.Center,
            VerticalTextAlignment = TextAlignment.Center
        };

        Content = _iconLabel;
        WidthRequest = ItemSize;
        HeightRequest = ItemSize;
        StrokeShape = new Ellipse();
        BackgroundColor = ItemColor;
        Stroke = Brush.Transparent;
        Shadow = new Shadow
        {
            Brush = Brush.Black,
            Offset = new Point(0, 2),
            Radius = 3,
            Opacity = 0.25f
        };

        var tapGesture = new TapGestureRecognizer();
        tapGesture.Tapped += OnItemTapped;
        GestureRecognizers.Add(tapGesture);
    }

    private void OnItemTapped(object? sender, TappedEventArgs e)
    {
        Tapped?.Invoke(this, EventArgs.Empty);
    }

    private static void OnIconChanged(BindableObject bindable, object oldValue, object newValue)
    {
        if (bindable is CircularMenuItem item && newValue is string icon)
        {
            item._iconLabel.Text = icon;
        }
    }

    private static void OnColorChanged(BindableObject bindable, object oldValue, object newValue)
    {
        if (bindable is CircularMenuItem item && newValue is Color color)
        {
            item.BackgroundColor = color;
        }
    }

    private static void OnIconColorChanged(BindableObject bindable, object oldValue, object newValue)
    {
        if (bindable is CircularMenuItem item && newValue is Color color)
        {
            item._iconLabel.TextColor = color;
        }
    }

    private static void OnSizeChanged(BindableObject bindable, object oldValue, object newValue)
    {
        if (bindable is CircularMenuItem item && newValue is double size)
        {
            item.WidthRequest = size;
            item.HeightRequest = size;
        }
    }
}
