using BibleOnSite.ViewModels;

namespace BibleOnSite.Pages;

/// <summary>
/// תמיכה settings: log export, reachable regardless of pack install state.
/// </summary>
public partial class SupportPreferencesPage : ContentPage
{
    public SupportPreferencesPage()
    {
        InitializeComponent();
        BindingContext = new SupportPreferencesViewModel();
    }

    public SupportPreferencesPage(SupportPreferencesViewModel viewModel)
    {
        InitializeComponent();
        BindingContext = viewModel;
    }
}
