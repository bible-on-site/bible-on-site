using System.Globalization;
using Fonts;

namespace BibleOnSite.Controls;

/// <summary>
/// Shared numeric selection control: a compact − / value / + row where the value
/// is also directly editable. Each instance configures its own range, step and
/// precision; typed input is clamped to the range and snapped to the step grid
/// relative to <see cref="Minimum"/>.
/// </summary>
public sealed class NumberPicker : ContentView
{
    public static readonly BindableProperty MinimumProperty = BindableProperty.Create(
        nameof(Minimum), typeof(double), typeof(NumberPicker), 0d,
        propertyChanged: static (bindable, _, _) => ((NumberPicker)bindable).OnRangeChanged());

    public static readonly BindableProperty MaximumProperty = BindableProperty.Create(
        nameof(Maximum), typeof(double), typeof(NumberPicker), 100d,
        propertyChanged: static (bindable, _, _) => ((NumberPicker)bindable).OnRangeChanged());

    public static readonly BindableProperty IncrementProperty = BindableProperty.Create(
        nameof(Increment), typeof(double), typeof(NumberPicker), 1d,
        propertyChanged: static (bindable, _, _) => ((NumberPicker)bindable).OnRangeChanged());

    public static readonly BindableProperty FractionalDigitsProperty = BindableProperty.Create(
        nameof(FractionalDigits), typeof(int), typeof(NumberPicker), 0,
        propertyChanged: static (bindable, _, _) => ((NumberPicker)bindable).OnRangeChanged());

    public static readonly BindableProperty ValueProperty = BindableProperty.Create(
        nameof(Value), typeof(double), typeof(NumberPicker), 0d, BindingMode.TwoWay,
        propertyChanged: static (bindable, _, newValue) => ((NumberPicker)bindable).OnValueChanged((double)newValue));

    public double Minimum
    {
        get => (double)GetValue(MinimumProperty);
        set => SetValue(MinimumProperty, value);
    }

    public double Maximum
    {
        get => (double)GetValue(MaximumProperty);
        set => SetValue(MaximumProperty, value);
    }

    public double Increment
    {
        get => (double)GetValue(IncrementProperty);
        set => SetValue(IncrementProperty, Math.Abs(value) < double.Epsilon ? 1d : value);
    }

    /// <summary>Decimal places allowed in the value; 0 keeps the picker integer-only.</summary>
    public int FractionalDigits
    {
        get => (int)GetValue(FractionalDigitsProperty);
        set => SetValue(FractionalDigitsProperty, Math.Clamp(value, 0, 3));
    }

    public double Value
    {
        get => (double)GetValue(ValueProperty);
        set => SetValue(ValueProperty, Coerce(value));
    }

    /// <summary>Raised whenever the effective (clamped, snapped) value changes.</summary>
#pragma warning disable S3264 // Subscribed from XAML (ValueChanged="OnLimitChanged") and tests.
    public event EventHandler? ValueChanged;
#pragma warning restore S3264

    /// <summary>The editable value field, exposed for tests and styling hooks.</summary>
    public Entry ValueEntry { get; }

    public Button DecrementButton { get; }
    public Button IncrementButton { get; }

    private static Button CreateStepButton(string glyph, string description)
    {
        var button = new Button
        {
            Text = glyph,
            FontFamily = "FluentIcons",
            FontSize = 20,
            WidthRequest = 40,
            HeightRequest = 40,
            Padding = new Thickness(8),
            BorderWidth = 0,
            BackgroundColor = Colors.Transparent,
        };
        button.SetAppThemeColor(Button.TextColorProperty, Color.FromArgb("#1552AC"), Color.FromArgb("#AACBFF"));
        SemanticProperties.SetDescription(button, description);
        return button;
    }

    public NumberPicker()
    {
        DecrementButton = CreateStepButton(FluentUI.line_horizontal_1_20_regular, "הקטנת הערך");
        DecrementButton.Clicked += (_, _) => Step(-1);

        ValueEntry = new Entry
        {
            Keyboard = Keyboard.Numeric,
            HorizontalTextAlignment = TextAlignment.Center,
            VerticalTextAlignment = TextAlignment.Center,
            WidthRequest = 72,
            FontSize = 15,
        };
        SemanticProperties.SetDescription(ValueEntry, "ערך מספרי");
        ValueEntry.Completed += (_, _) => CommitEntry();
        ValueEntry.Unfocused += (_, _) => CommitEntry();
        ValueEntry.Focused += (_, _) => ValueEntry.CursorPosition = ValueEntry.Text?.Length ?? 0;

        IncrementButton = CreateStepButton(FluentUI.add_20_regular, "הגדלת הערך");
        IncrementButton.Clicked += (_, _) => Step(1);

        // Keep the control visually stable across RTL: decrement on the left,
        // entry in the middle, increment on the right for every layout direction.
        var row = new Grid
        {
            FlowDirection = FlowDirection.LeftToRight,
            ColumnDefinitions =
            [
                new ColumnDefinition(GridLength.Auto),
                new ColumnDefinition(GridLength.Star),
                new ColumnDefinition(GridLength.Auto),
            ],
        };
        row.Add(DecrementButton);
        row.Add(ValueEntry, 1);
        row.Add(IncrementButton, 2);
        Content = row;

        RefreshEntryText();
        RefreshButtonStates();
    }

    private void Step(int direction)
    {
        Value = Value + direction * Increment;
    }

    private void CommitEntry()
    {
        var text = ValueEntry.Text?.Trim();
        if (string.IsNullOrEmpty(text)
            || !double.TryParse(text, NumberStyles.Float, CultureInfo.InvariantCulture, out var parsed)
            && !double.TryParse(text, NumberStyles.Float, CultureInfo.CurrentUICulture, out parsed))
        {
            RefreshEntryText();
            return;
        }
        Value = parsed;
        // Show the clamped/snapped result even when the typed text parsed fine.
        RefreshEntryText();
    }

    private void OnRangeChanged()
    {
        // Re-coerce so a range change cannot leave a stale out-of-range value.
        SetValue(ValueProperty, Coerce(Value));
        RefreshEntryText();
        RefreshButtonStates();
    }

    private void OnValueChanged(double newValue)
    {
        var coerced = Coerce(newValue);
        if (Math.Abs(coerced - newValue) > 1e-9)
        {
            // Push the coerced value back through the binding so the bound
            // property stays in sync with what the control displays.
            SetValue(ValueProperty, coerced);
            return;
        }
        if (!ValueEntry.IsFocused)
        {
            RefreshEntryText();
        }
        RefreshButtonStates();
        ValueChanged?.Invoke(this, EventArgs.Empty);
    }

    private double Coerce(double value)
    {
        if (!double.IsFinite(value))
        {
            return Minimum;
        }
        var clamped = Math.Clamp(value, Minimum, Maximum);
        var step = Increment <= 0 ? 1 : Increment;
        var snapped = Minimum + Math.Round((clamped - Minimum) / step) * step;
        snapped = Math.Clamp(snapped, Minimum, Maximum);
        return Math.Round(snapped, FractionalDigits);
    }

    private void RefreshEntryText() => ValueEntry.Text = FormatValue(Value);

    private void RefreshButtonStates()
    {
        DecrementButton.IsEnabled = Value > Minimum;
        IncrementButton.IsEnabled = Value < Maximum;
    }

    private string FormatValue(double value) => FractionalDigits == 0
        ? ((int)Math.Round(value)).ToString(CultureInfo.InvariantCulture)
        : value.ToString("F" + FractionalDigits.ToString(CultureInfo.InvariantCulture), CultureInfo.InvariantCulture);
}
