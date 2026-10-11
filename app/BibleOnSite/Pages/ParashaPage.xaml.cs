using BibleOnSite.Services;
using BibleOnSite.ViewModels;

namespace BibleOnSite.Pages;

/// <summary>פרשה על הפרק reader — Torah parasha plus Haftarah variants.</summary>
public partial class ParashaPage : ContentPage, IQueryAttributable //NOSONAR
{
    private readonly ParashaViewModel _viewModel;

    public ParashaPage()
    {
        InitializeComponent();
        _viewModel = new ParashaViewModel();
        BindingContext = _viewModel;
    }

    /// <summary>Receives the parasha unit id passed by the list page.</summary>
    public void ApplyQueryAttributes(IDictionary<string, object> query)
    {
        if (query.TryGetValue("unitId", out var value) && int.TryParse(Convert.ToString(value), out var unitId))
        {
            _ = _viewModel.LoadAsync(unitId);
        }
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
