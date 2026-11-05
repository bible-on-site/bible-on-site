namespace BibleOnSite.Controls;

/// <summary>
/// The inline perush-notes block every reader's pasuk row shares (#2573):
/// one <see cref="Models.PerushNoteDisplay"/> row per note — a fixed-height
/// loading slot until the HtmlView publishes, then the perush name and its
/// content. The no-flash contract (#2451) now lives in one template instead
/// of three page copies that could drift apart.
/// </summary>
// 'partial' is required — the XAML codegen partial declares InitializeComponent.
public partial class InlinePerushimView : VerticalStackLayout //NOSONAR — S2333 false positive on code-behind.
{
    /// <summary>The <see cref="Models.PerushNoteDisplay"/> items to render.</summary>
    public static readonly BindableProperty ItemsSourceProperty = BindableProperty.Create(
        nameof(ItemsSource), typeof(System.Collections.IEnumerable), typeof(InlinePerushimView), null);

    public InlinePerushimView()
    {
        InitializeComponent();
    }

    public System.Collections.IEnumerable? ItemsSource
    {
        get => GetValue(ItemsSourceProperty) as System.Collections.IEnumerable;
        set => SetValue(ItemsSourceProperty, value);
    }
}
