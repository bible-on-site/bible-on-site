using BibleOnSite.ViewModels;

namespace BibleOnSite.Pages;

/// <summary>
/// שמע settings: one persisted slider per audio channel. Opened with
/// ?focus=recitation from קריינות to bring that channel into view.
/// </summary>
#pragma warning disable S2333 // MAUI XAML supplies the other partial declaration.
[QueryProperty(nameof(FocusChannel), "focus")]
public partial class SoundPreferencesPage : ContentPage
#pragma warning restore S2333
{
    public SoundPreferencesPage()
    {
        InitializeComponent();
        BindingContext = new SoundPreferencesViewModel();
    }

    public SoundPreferencesPage(SoundPreferencesViewModel viewModel)
    {
        InitializeComponent();
        BindingContext = viewModel;
    }

    /// <summary>Optional channel to scroll into view (currently: "recitation").</summary>
    public string? FocusChannel { get; set; }

    protected override void OnAppearing()
    {
        base.OnAppearing();
        if (!string.Equals(FocusChannel, "recitation", StringComparison.OrdinalIgnoreCase))
        {
            return;
        }

        FocusChannel = null;
        // Scroll once the card has a real size — layout may not have run yet on first appear.
        RecitationChannelCard.SizeChanged += OnRecitationCardSized;
    }

    private async void OnRecitationCardSized(object? sender, EventArgs e)
    {
        RecitationChannelCard.SizeChanged -= OnRecitationCardSized;
        if (RecitationChannelCard.Height > 0)
        {
            await SoundScroll.ScrollToAsync(RecitationChannelCard, ScrollToPosition.Start, true);
        }
    }
}
