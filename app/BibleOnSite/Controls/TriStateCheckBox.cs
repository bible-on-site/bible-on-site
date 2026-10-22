namespace BibleOnSite.Controls;

/// <summary>Selection state of a parent checkbox over a child option set.</summary>
public enum TriCheckState
{
    Unchecked,
    Checked,
    Indeterminate
}

/// <summary>
/// A checkbox that can also render the indeterminate "some children selected"
/// state, for the בחר הכל rows over the kind and sefer option sets (#2454). A tap
/// checks everything unless the set is already fully checked.
/// </summary>
public sealed class TriStateCheckBox : ContentView
{
    public static readonly BindableProperty StateProperty = BindableProperty.Create(
        nameof(State), typeof(TriCheckState), typeof(TriStateCheckBox), TriCheckState.Unchecked,
        propertyChanged: (bindable, _, _) => ((TriStateCheckBox)bindable).ApplyState());

    public TriCheckState State
    {
        get => (TriCheckState)GetValue(StateProperty);
        set => SetValue(StateProperty, value);
    }

    /// <summary>Invoked after a tap toggles <see cref="State"/>.</summary>
    public Action? Toggled { get; set; }

    private static readonly Color CheckedColorLight = Color.FromArgb("#1552ac");
    private static readonly Color CheckedColorDark = Color.FromArgb("#4a7fc7");
    private static readonly Color BorderColorLight = Color.FromArgb("#52647C");
    private static readonly Color BorderColorDark = Color.FromArgb("#B2C2D8");

    private readonly Border _box;
    private readonly Microsoft.Maui.Controls.Shapes.Polyline _check;
    private readonly BoxView _dash;

    public TriStateCheckBox()
    {
        _check = new Microsoft.Maui.Controls.Shapes.Polyline
        {
            Points = new PointCollection([new(4.5, 10), new(8.5, 14), new(15.5, 5.5)]),
            Stroke = new SolidColorBrush(Colors.White),
            StrokeThickness = 2,
            StrokeLineJoin = Microsoft.Maui.Controls.Shapes.PenLineJoin.Round,
            StrokeLineCap = Microsoft.Maui.Controls.Shapes.PenLineCap.Round,
            InputTransparent = true,
            IsVisible = false
        };
        _dash = new BoxView
        {
            WidthRequest = 10,
            HeightRequest = 2,
            Color = Colors.White,
            InputTransparent = true,
            IsVisible = false
        };
        _box = new Border
        {
            WidthRequest = 20,
            HeightRequest = 20,
            StrokeThickness = 1.5,
            StrokeShape = new Microsoft.Maui.Controls.Shapes.RoundRectangle { CornerRadius = 3 },
            Padding = 0,
            Content = new Grid { _check, _dash },
            HorizontalOptions = LayoutOptions.Center,
            VerticalOptions = LayoutOptions.Center
        };
        _box.SetAppTheme(Border.StrokeProperty, new SolidColorBrush(BorderColorLight), new SolidColorBrush(BorderColorDark));
        Content = _box;
        // Same hit target the row checkboxes use.
        WidthRequest = 32;
        HeightRequest = 44;
        var tap = new TapGestureRecognizer();
        tap.Tapped += (_, _) => Toggle();
        GestureRecognizers.Add(tap);
        ApplyState();
    }

    /// <summary>Derives the parent state from a child set's selection count.</summary>
    public static TriCheckState DeriveState(int selected, int total) =>
        total <= 0 || selected <= 0 ? TriCheckState.Unchecked
        : selected >= total ? TriCheckState.Checked
        : TriCheckState.Indeterminate;

    /// <summary>A tap selects everything unless the set is fully selected.</summary>
    public void Toggle()
    {
        if (!IsEnabled)
        {
            return;
        }
        State = State == TriCheckState.Checked ? TriCheckState.Unchecked : TriCheckState.Checked;
        Toggled?.Invoke();
    }

    private void ApplyState()
    {
        var mark = State != TriCheckState.Unchecked;
        _check.IsVisible = State == TriCheckState.Checked;
        _dash.IsVisible = State == TriCheckState.Indeterminate;
        _box.SetAppTheme(Border.BackgroundProperty,
            mark ? new SolidColorBrush(CheckedColorLight) : Brush.Transparent,
            mark ? new SolidColorBrush(CheckedColorDark) : Brush.Transparent);
    }
}
