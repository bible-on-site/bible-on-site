using BibleOnSite.Helpers;
using BibleOnSite.Services;
using BibleOnSite.ViewModels;

namespace BibleOnSite.Pages;

/// <summary>
/// A Tanahpedia category listing — entities of an entity type (or a
/// subcategory filter) with the entries that describe them, plus the optional
/// admin-authored homepage intro.
/// </summary>
[QueryProperty(nameof(CategoryKey), "key")]
[QueryProperty(nameof(EntityType), "entityType")]
[QueryProperty(nameof(Sub), "sub")]
#pragma warning disable S2333 // MAUI XAML supplies the other partial declaration and controls.
public partial class TanahpediaEntityTypePage : ContentPage
#pragma warning restore S2333
{
    private readonly TanahpediaEntityTypeViewModel _viewModel;

    public string CategoryKey { get; set; } = string.Empty;
    public string EntityType { get; set; } = string.Empty;
    public string? Sub { get; set; }

    public TanahpediaEntityTypePage()
    {
        InitializeComponent();
        _viewModel = new TanahpediaEntityTypeViewModel();
        BindingContext = _viewModel;
        SetupFontSizeResources();
        IntroHtml.LinkTapped += OnIntroLinkTapped;
    }

    private void SetupFontSizeResources()
    {
        var prefs = PreferencesService.Instance;
        UpdateFontSizeResources(prefs.ArticleFontFactor);
        prefs.PreferencesChanged += (_, _) =>
            MainThread.BeginInvokeOnMainThread(() =>
                UpdateFontSizeResources(prefs.ArticleFontFactor));
    }

    private void UpdateFontSizeResources(double factor)
    {
        Resources["TanahpediaFontSize"] = factor * 16;
        IntroHtml.SetDynamicResource(Controls.HtmlView.FontSizeProperty, "TanahpediaFontSize");
    }

    protected override async void OnAppearing()
    {
        base.OnAppearing();

        _viewModel.CategoryKey = CategoryKey;
        _viewModel.EntityType = EntityType;
        _viewModel.Sub = Sub;

        if (!_viewModel.IsLoaded && !_viewModel.IsLoading)
        {
            await _viewModel.LoadAsync();
        }
    }

    private async void OnBackClicked(object? sender, EventArgs e)
    {
        await Shell.Current.GoToAsync("..");
    }

    /// <summary>
    /// Links inside the intro content: <c>/pedia/{slug}</c> routes in-app;
    /// everything else opens in the external browser.
    /// </summary>
    private async void OnIntroLinkTapped(object? sender, Controls.LinkTappedEventArgs e)
    {
        e.Handled = true;
        if (TanahpediaLinks.TryGetEntryUniqueName(e.Url, out var uniqueName))
        {
            await _viewModel.OpenEntryCommand.ExecuteAsync(uniqueName);
            return;
        }

        if (Uri.TryCreate(e.Url, UriKind.Absolute, out var uri))
        {
            await Launcher.OpenAsync(uri);
        }
    }
}
