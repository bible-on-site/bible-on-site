using BibleOnSite.Controls;
using BibleOnSite.Helpers;
using BibleOnSite.Models;
using BibleOnSite.Services;
using BibleOnSite.ViewModels;

namespace BibleOnSite.Pages;

/// <summary>
/// A single Tanahpedia entry — title, entity badges, admin-authored HTML body
/// and the entry's Tanah occurrences. Synonym names resolve to their canonical
/// entry; ambiguous names show the disambiguation chooser.
/// </summary>
[QueryProperty(nameof(UniqueName), "uniqueName")]
public partial class TanahpediaEntryPage : ContentPage
{
    private readonly TanahpediaEntryViewModel _viewModel;

    public string UniqueName { get; set; } = string.Empty;

    public TanahpediaEntryPage()
    {
        InitializeComponent();
        _viewModel = new TanahpediaEntryViewModel();
        BindingContext = _viewModel;
        SetupFontSizeResources();
        EntryHtml.LinkTapped += OnEntryLinkTapped;
    }

    private void SetupFontSizeResources()
    {
        var prefs = PreferencesService.Instance;
        UpdateFontSizeResources(prefs.FontFactor);
        prefs.PreferencesChanged += (_, _) =>
            MainThread.BeginInvokeOnMainThread(() =>
                UpdateFontSizeResources(prefs.FontFactor));
    }

    private void UpdateFontSizeResources(double factor)
    {
        Resources["TanahpediaFontSize"] = factor * 16;
        EntryHtml.SetDynamicResource(HtmlView.FontSizeProperty, "TanahpediaFontSize");
    }

    protected override async void OnAppearing()
    {
        base.OnAppearing();

        _viewModel.UniqueName = UniqueName;

        if (!_viewModel.IsLoaded && !_viewModel.IsLoading)
        {
            await _viewModel.LoadAsync();
        }
    }

    /// <summary>
    /// Links inside the entry body: <c>/pedia/{slug}</c> routes in-app through
    /// the entry route (synonyms and ambiguous names resolve on that page);
    /// everything else opens in the external browser.
    /// </summary>
    private async void OnEntryLinkTapped(object? sender, LinkTappedEventArgs e)
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

    /// <summary>
    /// Opens the reader at the occurrence's perek, scrolled to the pasuk —
    /// reuses the search-reader navigation the chapter search uses.
    /// </summary>
    private async void OnOccurrenceTapped(object? sender, TappedEventArgs e)
    {
        // Tapped does not carry CommandParameter — the row's BindingContext is the item.
        if ((sender as Element)?.BindingContext is not TanahpediaOccurrenceItem item)
        {
            return;
        }

        try
        {
            var pasuk = new Pasuk { PasukNum = item.PasukNumber, Text = item.VerseText };
            var result = new PasukSearchResult(pasuk, item.PerekId, string.Empty);
            await Shell.Current.GoToAsync(AppRoutes.SearchReader, false, new ShellNavigationQueryParameters
            {
                ["searchResult"] = result
            });
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine($"Tanahpedia occurrence navigation failed: {ex}");
            await DisplayAlertAsync("תנכפדיה", "לא ניתן לפתוח את המקור. נסו שוב", "אישור");
        }
    }

    private async void OnBackToPediaClicked(object? sender, EventArgs e)
    {
        if (Shell.Current is not { } shell)
        {
            return;
        }
        var location = shell.CurrentState.Location.OriginalString;
        await shell.GoToAsync(AppRoutes.FlyoutPage("TanahpediaPage", location));
    }
}
