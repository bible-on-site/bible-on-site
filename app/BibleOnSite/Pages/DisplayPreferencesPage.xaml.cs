using BibleOnSite.ViewModels;

namespace BibleOnSite.Pages;

/// <summary>
/// תצוגה settings: font size with a live text preview.
/// </summary>
public partial class DisplayPreferencesPage : ContentPage
{
    public DisplayPreferencesPage()
    {
        InitializeComponent();
        BindingContext = new DisplayPreferencesViewModel();
    }

    public DisplayPreferencesPage(DisplayPreferencesViewModel viewModel)
    {
        InitializeComponent();
        BindingContext = viewModel;
    }
}
