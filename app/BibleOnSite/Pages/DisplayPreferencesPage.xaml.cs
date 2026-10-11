using BibleOnSite.ViewModels;

namespace BibleOnSite.Pages;

/// <summary>
/// תצוגה settings: font size with a live text preview.
/// </summary>
#pragma warning disable S2333 // MAUI XAML supplies the other partial declaration.
public partial class DisplayPreferencesPage : ContentPage
#pragma warning restore S2333
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
