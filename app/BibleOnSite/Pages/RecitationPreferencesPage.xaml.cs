using BibleOnSite.ViewModels;

namespace BibleOnSite.Pages;

/// <summary>
/// קריינות settings: playback configuration (speed, verse pauses) and shortcuts to
/// שמע for volume and to חבילות הרחבה for recording installation.
/// </summary>
#pragma warning disable S2333 // MAUI XAML supplies the other partial declaration.
public partial class RecitationPreferencesPage : ContentPage
#pragma warning restore S2333
{
    public RecitationPreferencesPage()
    {
        InitializeComponent();
        BindingContext = new RecitationPreferencesViewModel();
    }

    public RecitationPreferencesPage(RecitationPreferencesViewModel viewModel)
    {
        InitializeComponent();
        BindingContext = viewModel;
    }
}
