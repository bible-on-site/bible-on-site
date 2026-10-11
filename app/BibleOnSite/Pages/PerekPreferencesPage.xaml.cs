using BibleOnSite.ViewModels;

namespace BibleOnSite.Pages;

/// <summary>
/// על הפרק settings: which perek opens on startup — full-width selection rows.
/// </summary>
public partial class PerekPreferencesPage : ContentPage
{
    public PerekPreferencesPage()
    {
        InitializeComponent();
        BindingContext = new PerekPreferencesViewModel();
    }

    public PerekPreferencesPage(PerekPreferencesViewModel viewModel)
    {
        InitializeComponent();
        BindingContext = viewModel;
    }
}
