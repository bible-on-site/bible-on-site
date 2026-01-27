using Microsoft.Maui.Controls.Shapes;

namespace BibleOnSite.Controls;

/// <summary>
/// A custom bottom navigation bar with a curved notch in the center for a circular menu button.
/// Inspired by the Flutter AlHaperekBottomMenuPainter from the legacy app.
/// </summary>
public class BottomNavigationBar : ContentView
{
    private readonly Grid _mainGrid;
    private readonly AbsoluteLayout _container;
    private readonly BottomBarBackground _background;
    private CircularMenu? _circularMenu;

    /// <summary>
    /// Bindable property for the left section content.
    /// </summary>
    public static readonly BindableProperty LeftContentProperty = BindableProperty.Create(
        nameof(LeftContent),
        typeof(View),
        typeof(BottomNavigationBar),
        propertyChanged: OnLeftContentChanged);

    /// <summary>
    /// Bindable property for the right section content.
    /// </summary>
    public static readonly BindableProperty RightContentProperty = BindableProperty.Create(
        nameof(RightContent),
        typeof(View),
        typeof(BottomNavigationBar),
        propertyChanged: OnRightContentChanged);

    /// <summary>
    /// Bindable property for bar height.
    /// </summary>
    public static readonly BindableProperty BarHeightProperty = BindableProperty.Create(
        nameof(BarHeight),
        typeof(double),
        typeof(BottomNavigationBar),
        80.0);

    /// <summary>
    /// Bindable property for notch radius.
    /// </summary>
    public static readonly BindableProperty NotchRadiusProperty = BindableProperty.Create(
        nameof(NotchRadius),
        typeof(double),
        typeof(BottomNavigationBar),
        32.0);

    /// <summary>
    /// Bindable property for the bar background color.
    /// </summary>
    public static readonly BindableProperty BarColorProperty = BindableProperty.Create(
        nameof(BarColor),
        typeof(Color),
        typeof(BottomNavigationBar),
        Colors.White,
        propertyChanged: OnBarColorChanged);

    /// <summary>
    /// Gets or sets the left section content.
    /// </summary>
    public View? LeftContent
    {
        get => (View?)GetValue(LeftContentProperty);
        set => SetValue(LeftContentProperty, value);
    }

    /// <summary>
    /// Gets or sets the right section content.
    /// </summary>
    public View? RightContent
    {
        get => (View?)GetValue(RightContentProperty);
        set => SetValue(RightContentProperty, value);
    }

    /// <summary>
    /// Gets or sets the bar height.
    /// </summary>
    public double BarHeight
    {
        get => (double)GetValue(BarHeightProperty);
        set => SetValue(BarHeightProperty, value);
    }

    /// <summary>
    /// Gets or sets the notch radius.
    /// </summary>
    public double NotchRadius
    {
        get => (double)GetValue(NotchRadiusProperty);
        set => SetValue(NotchRadiusProperty, value);
    }

    /// <summary>
    /// Gets or sets the bar background color.
    /// </summary>
    public Color BarColor
    {
        get => (Color)GetValue(BarColorProperty);
        set => SetValue(BarColorProperty, value);
    }

    /// <summary>
    /// Gets or sets the circular menu displayed in the center notch.
    /// </summary>
    public CircularMenu? CircularMenu
    {
        get => _circularMenu;
        set
        {
            if (_circularMenu != null)
            {
                _container.Remove(_circularMenu);
            }
            _circularMenu = value;
            if (_circularMenu != null)
            {
                // Position the circular menu in the center notch
                AbsoluteLayout.SetLayoutBounds(_circularMenu, new Rect(0.5, 0, -1, -1));
                AbsoluteLayout.SetLayoutFlags(_circularMenu, Microsoft.Maui.Layouts.AbsoluteLayoutFlags.XProportional);
                _circularMenu.Margin = new Thickness(0, -12, 0, 0); // Overlap into notch
                _container.Add(_circularMenu);
            }
        }
    }

    public BottomNavigationBar()
    {
        _background = new BottomBarBackground
        {
            BarColor = BarColor
        };

        // Main grid for left/right content
        _mainGrid = new Grid
        {
            ColumnDefinitions =
            [
                new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) },
                new ColumnDefinition { Width = new GridLength(80) }, // Center space for FAB
                new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) }
            ],
            Padding = new Thickness(8, 20, 8, 8) // Extra top padding for curved area
        };

        _container = new AbsoluteLayout();

        // Add background first
        AbsoluteLayout.SetLayoutBounds(_background, new Rect(0, 0, 1, 1));
        AbsoluteLayout.SetLayoutFlags(_background, Microsoft.Maui.Layouts.AbsoluteLayoutFlags.All);
        _container.Add(_background);

        // Add content grid
        AbsoluteLayout.SetLayoutBounds(_mainGrid, new Rect(0, 0, 1, 1));
        AbsoluteLayout.SetLayoutFlags(_mainGrid, Microsoft.Maui.Layouts.AbsoluteLayoutFlags.All);
        _container.Add(_mainGrid);

        Content = _container;
        HeightRequest = BarHeight;
    }

    private static void OnLeftContentChanged(BindableObject bindable, object oldValue, object newValue)
    {
        if (bindable is BottomNavigationBar bar)
        {
            if (oldValue is View oldView)
            {
                bar._mainGrid.Remove(oldView);
            }
            if (newValue is View newView)
            {
                Grid.SetColumn(newView, 0);
                bar._mainGrid.Add(newView);
            }
        }
    }

    private static void OnRightContentChanged(BindableObject bindable, object oldValue, object newValue)
    {
        if (bindable is BottomNavigationBar bar)
        {
            if (oldValue is View oldView)
            {
                bar._mainGrid.Remove(oldView);
            }
            if (newValue is View newView)
            {
                Grid.SetColumn(newView, 2);
                bar._mainGrid.Add(newView);
            }
        }
    }

    private static void OnBarColorChanged(BindableObject bindable, object oldValue, object newValue)
    {
        if (bindable is BottomNavigationBar bar && newValue is Color color)
        {
            bar._background.BarColor = color;
            bar._background.InvalidateDrawable();
        }
    }
}

/// <summary>
/// Custom GraphicsView for the bottom bar background with curved notch.
/// </summary>
public class BottomBarBackground : GraphicsView
{
    public Color BarColor { get; set; } = Colors.White;

    public BottomBarBackground()
    {
        Drawable = new BottomBarDrawable();
    }

    public void InvalidateDrawable()
    {
        Invalidate();
    }
}
