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
#pragma warning disable S2333 // MAUI XAML supplies the other partial declaration and controls.
public partial class TanahpediaEntryPage : ContentPage
#pragma warning restore S2333
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
        // Person hops rebind this page in place - return to the top of the
        // destination entry instead of keeping the scrolled family section.
        _viewModel.PropertyChanged += (_, e) =>
        {
            if (e.PropertyName == nameof(TanahpediaEntryViewModel.UniqueName))
            {
                MainThread.BeginInvokeOnMainThread(() => EntryScroll.ScrollToAsync(0, 0, false));
            }
        };
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
        EntryHtml.SetDynamicResource(HtmlView.FontSizeProperty, "TanahpediaFontSize");
    }

    /// <summary>
    /// Hardware/system Back steps through the in-place person trail first
    /// (the same logical history pushed pages used to give), then leaves.
    /// </summary>
    protected override bool OnBackButtonPressed()
    {
        if (_viewModel.HasEntryHistory)
        {
            _viewModel.GoBackCommand.Execute(null);
            return true;
        }

        return base.OnBackButtonPressed();
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
        try
        {
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
        catch (Exception ex)
        {
            // async void - an unhandled navigation/launcher exception is a crash.
            Console.Error.WriteLine($"Tanahpedia link navigation failed for {e.Url}: {ex}");
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
        #pragma warning disable S2221 // Deliberate failure boundary: occurrence navigation failure alerts the user
        catch (Exception ex) //NOSONAR — occurrence navigation failure alerts the user.
        {
            #pragma warning restore S2221
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
