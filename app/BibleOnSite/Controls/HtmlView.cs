using Microsoft.Maui.Controls;

namespace BibleOnSite.Controls;

/// <summary>
/// A cross-platform control that renders HTML content with proper CSS support,
/// including text-align: justify which is not supported by MAUI's built-in Label.
/// </summary>
public class HtmlView : View
{
    /// <summary>
    /// Bindable property for the HTML content to display.
    /// </summary>
    public static readonly BindableProperty HtmlContentProperty = BindableProperty.Create(
        nameof(HtmlContent),
        typeof(string),
        typeof(HtmlView),
        default(string),
        propertyChanged: OnHtmlContentChanged);

    /// <summary>
    /// Bindable property for the base font size in pixels.
    /// </summary>
    public static readonly BindableProperty FontSizeProperty = BindableProperty.Create(
        nameof(FontSize),
        typeof(double),
        typeof(HtmlView),
        16.0,
        propertyChanged: OnFontSizeChanged);

    /// <summary>
    /// Bindable property for text alignment (supports justify).
    /// </summary>
    public static readonly BindableProperty TextAlignmentProperty = BindableProperty.Create(
        nameof(TextAlignment),
        typeof(HtmlTextAlignment),
        typeof(HtmlView),
        HtmlTextAlignment.Start,
        propertyChanged: OnTextAlignmentChanged);

    /// <summary>
    /// Bindable property for text direction (LTR/RTL).
    /// </summary>
    public static readonly BindableProperty TextDirectionProperty = BindableProperty.Create(
        nameof(TextDirection),
        typeof(HtmlTextDirection),
        typeof(HtmlView),
        HtmlTextDirection.Auto,
        propertyChanged: OnTextDirectionChanged);

    /// <summary>
    /// Bindable property for line height multiplier.
    /// </summary>
    public static readonly BindableProperty LineHeightProperty = BindableProperty.Create(
        nameof(LineHeight),
        typeof(double),
        typeof(HtmlView),
        1.5,
        propertyChanged: OnLineHeightChanged);

    /// <summary>
    /// Bindable property for font scaling factor (multiplier applied to base font size).
    /// </summary>
    public static readonly BindableProperty FontFactorProperty = BindableProperty.Create(
        nameof(FontFactor),
        typeof(double),
        typeof(HtmlView),
        1.0,
        propertyChanged: OnFontFactorChanged);

    /// <summary>
    /// Bindable property for header 1 font size multiplier.
    /// </summary>
    public static readonly BindableProperty H1FontSizeMultiplierProperty = BindableProperty.Create(
        nameof(H1FontSizeMultiplier),
        typeof(double),
        typeof(HtmlView),
        1.125,
        propertyChanged: OnStyleChanged);

    /// <summary>
    /// Bindable property for header 2 font size multiplier.
    /// </summary>
    public static readonly BindableProperty H2FontSizeMultiplierProperty = BindableProperty.Create(
        nameof(H2FontSizeMultiplier),
        typeof(double),
        typeof(HtmlView),
        1.0625,
        propertyChanged: OnStyleChanged);

    /// <summary>
    /// Bindable property for header 3 font size multiplier.
    /// </summary>
    public static readonly BindableProperty H3FontSizeMultiplierProperty = BindableProperty.Create(
        nameof(H3FontSizeMultiplier),
        typeof(double),
        typeof(HtmlView),
        0.925,
        propertyChanged: OnStyleChanged);

    /// <summary>
    /// Gets or sets the HTML content to display.
    /// </summary>
    public string? HtmlContent
    {
        get => (string?)GetValue(HtmlContentProperty);
        set => SetValue(HtmlContentProperty, value);
    }

    /// <summary>
    /// Gets or sets the base font size in pixels.
    /// </summary>
    public double FontSize
    {
        get => (double)GetValue(FontSizeProperty);
        set => SetValue(FontSizeProperty, value);
    }

    /// <summary>
    /// Gets or sets the text alignment (supports justify).
    /// </summary>
    public HtmlTextAlignment TextAlignment
    {
        get => (HtmlTextAlignment)GetValue(TextAlignmentProperty);
        set => SetValue(TextAlignmentProperty, value);
    }

    /// <summary>
    /// Gets or sets the text direction.
    /// </summary>
    public HtmlTextDirection TextDirection
    {
        get => (HtmlTextDirection)GetValue(TextDirectionProperty);
        set => SetValue(TextDirectionProperty, value);
    }

    /// <summary>
    /// Gets or sets the line height multiplier.
    /// </summary>
    public double LineHeight
    {
        get => (double)GetValue(LineHeightProperty);
        set => SetValue(LineHeightProperty, value);
    }

    /// <summary>
    /// Gets or sets the font scaling factor (multiplier applied to base font size).
    /// </summary>
    public double FontFactor
    {
        get => (double)GetValue(FontFactorProperty);
        set => SetValue(FontFactorProperty, value);
    }

    /// <summary>
    /// Gets or sets the H1 font size multiplier (relative to factored font size).
    /// </summary>
    public double H1FontSizeMultiplier
    {
        get => (double)GetValue(H1FontSizeMultiplierProperty);
        set => SetValue(H1FontSizeMultiplierProperty, value);
    }

    /// <summary>
    /// Gets or sets the H2 font size multiplier (relative to factored font size).
    /// </summary>
    public double H2FontSizeMultiplier
    {
        get => (double)GetValue(H2FontSizeMultiplierProperty);
        set => SetValue(H2FontSizeMultiplierProperty, value);
    }

    /// <summary>
    /// Gets or sets the H3 font size multiplier (relative to factored font size).
    /// </summary>
    public double H3FontSizeMultiplier
    {
        get => (double)GetValue(H3FontSizeMultiplierProperty);
        set => SetValue(H3FontSizeMultiplierProperty, value);
    }

    /// <summary>
    /// Gets the effective font size (base font size × font factor).
    /// </summary>
    public double EffectiveFontSize => FontSize * FontFactor;

    private static void OnHtmlContentChanged(BindableObject bindable, object oldValue, object newValue)
        => ((HtmlView)bindable).OnHtmlContentChanged();

    private static void OnFontSizeChanged(BindableObject bindable, object oldValue, object newValue)
        => ((HtmlView)bindable).OnStyleChanged();

    private static void OnTextAlignmentChanged(BindableObject bindable, object oldValue, object newValue)
        => ((HtmlView)bindable).OnStyleChanged();

    private static void OnTextDirectionChanged(BindableObject bindable, object oldValue, object newValue)
        => ((HtmlView)bindable).OnStyleChanged();

    private static void OnLineHeightChanged(BindableObject bindable, object oldValue, object newValue)
        => ((HtmlView)bindable).OnStyleChanged();

    private static void OnFontFactorChanged(BindableObject bindable, object oldValue, object newValue)
        => ((HtmlView)bindable).OnStyleChanged();

    private static void OnStyleChanged(BindableObject bindable, object oldValue, object newValue)
        => ((HtmlView)bindable).OnStyleChanged();

    /// <summary>
    /// Raised when the HTML content changes.
    /// </summary>
    public event EventHandler? HtmlContentChanged;

    /// <summary>
    /// Raised when any style property changes.
    /// </summary>
    public event EventHandler? StyleChanged;

    /// <summary>
    /// Raised when a link is tapped in the HTML content.
    /// </summary>
    public event EventHandler<LinkTappedEventArgs>? LinkTapped;

    private void OnHtmlContentChanged() => HtmlContentChanged?.Invoke(this, EventArgs.Empty);
    private void OnStyleChanged() => StyleChanged?.Invoke(this, EventArgs.Empty);

    /// <summary>
    /// Raises the LinkTapped event. Called by platform handlers.
    /// </summary>
    public void RaiseLinkTapped(string url) => LinkTapped?.Invoke(this, new LinkTappedEventArgs(url));

    /// <summary>
    /// Gets the CSS text-align value for the current TextAlignment.
    /// </summary>
    public string GetCssTextAlign() => TextAlignment switch
    {
        HtmlTextAlignment.Start => TextDirection == HtmlTextDirection.Rtl ? "right" : "left",
        HtmlTextAlignment.End => TextDirection == HtmlTextDirection.Rtl ? "left" : "right",
        HtmlTextAlignment.Center => "center",
        HtmlTextAlignment.Justify => "justify",
        _ => "start"
    };

    /// <summary>
    /// Gets the CSS direction value for the current TextDirection.
    /// </summary>
    public string GetCssDirection() => TextDirection switch
    {
        HtmlTextDirection.Ltr => "ltr",
        HtmlTextDirection.Rtl => "rtl",
        _ => "auto"
    };
}

/// <summary>
/// Text alignment options for HtmlView, including justify.
/// </summary>
public enum HtmlTextAlignment
{
    Start,
    End,
    Center,
    Justify
}

/// <summary>
/// Text direction options for HtmlView.
/// </summary>
public enum HtmlTextDirection
{
    Auto,
    Ltr,
    Rtl
}

/// <summary>
/// Event arguments for the LinkTapped event.
/// </summary>
public class LinkTappedEventArgs : EventArgs
{
    /// <summary>
    /// Gets the URL that was tapped.
    /// </summary>
    public string Url { get; }

    /// <summary>
    /// Gets or sets whether the link tap was handled.
    /// If true, the default action (opening in browser) will be suppressed.
    /// </summary>
    public bool Handled { get; set; }

    public LinkTappedEventArgs(string url)
    {
        Url = url;
        Handled = false;
    }
}
