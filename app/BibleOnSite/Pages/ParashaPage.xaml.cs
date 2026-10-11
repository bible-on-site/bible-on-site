using BibleOnSite.Services;
using BibleOnSite.ViewModels;

namespace BibleOnSite.Pages;

/// <summary>פרשה על הפרק reader — Torah parasha plus Haftarah variants.</summary>
[QueryProperty(nameof(UnitId), "unitId")]
public partial class ParashaPage : ContentPage
{
    private readonly ParashaViewModel _viewModel;

    public ParashaPage()
    {
        InitializeComponent();
        _viewModel = new ParashaViewModel();
        BindingContext = _viewModel;
    }

    /// <summary>The parasha unit id passed by the list page.</summary>
    public int UnitId
    {
        set => _ = _viewModel.LoadAsync(value);
    }

    protected override void OnAppearing()
    {
        base.OnAppearing();
        UpdateFontSizeResources(PreferencesService.Instance.FontFactor);
    }

    private void UpdateFontSizeResources(double factor)
    {
        Resources["PasukFontSize"] = factor * 18;
    }

    private void OnMenuButtonClicked(object? sender, EventArgs e)
    {
        Shell.Current.FlyoutIsPresented = true;
    }
}
