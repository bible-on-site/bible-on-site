using BibleOnSite.Controls;
using BibleOnSite.ViewModels;

namespace BibleOnSite.Pages;

/// <summary>
/// על הפרק settings: which perek opens on startup — full-width selection rows.
/// </summary>
#pragma warning disable S2333 // MAUI XAML supplies the other partial declaration.
public partial class PerekPreferencesPage : PreferencesPageBase
#pragma warning restore S2333
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
