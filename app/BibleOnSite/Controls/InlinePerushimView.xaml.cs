namespace BibleOnSite.Controls;

/// <summary>
/// The inline perush-notes block every reader's pasuk row shares (#2573):
/// one <see cref="Models.PerushNoteDisplay"/> row per note — a fixed-height
/// loading slot until the HtmlView publishes, then the perush name and its
/// content. The no-flash contract (#2451) now lives in one template instead
/// of three page copies that could drift apart.
/// </summary>
#pragma warning disable S2333 // MAUI XAML generates the other partial declaration.
public partial class InlinePerushimView : VerticalStackLayout
#pragma warning restore S2333
{
    /// <summary>The <see cref="Models.PerushNoteDisplay"/> items to render.</summary>
    public static readonly BindableProperty ItemsSourceProperty = BindableProperty.Create(
        nameof(ItemsSource), typeof(System.Collections.IEnumerable), typeof(InlinePerushimView), null);

    /// <summary>Lets the owning reader route links through native navigation.</summary>
    public event EventHandler<LinkTappedEventArgs>? LinkTapped;

    private void OnContentLinkTapped(object? sender, LinkTappedEventArgs e)
    {
        var handler = LinkTapped;
        if (handler != null)
        {
            handler(this, e);
        }
    }

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
