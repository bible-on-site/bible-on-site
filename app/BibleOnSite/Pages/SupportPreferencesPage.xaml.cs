using BibleOnSite.Controls;
using BibleOnSite.ViewModels;

namespace BibleOnSite.Pages;

/// <summary>
/// תמיכה settings: log export, reachable regardless of pack install state.
/// </summary>
#pragma warning disable S2333 // MAUI XAML supplies the other partial declaration.
public partial class SupportPreferencesPage : PreferencesPageBase
#pragma warning restore S2333
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
