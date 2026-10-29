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

    /// <summary>The shared article chrome coordinator — the same fullscreen
    /// surface state machine every article view runs (#2786).</summary>
    private ArticleChrome _chrome = null!;

    /// <summary>A second tap during the in-flight transition must not stack
    /// another absolute-route navigation on top of it (#2640).</summary>
    private readonly NavigationGate _backToPediaGate = new();

    public string UniqueName { get; set; } = string.Empty;

    public TanahpediaEntryPage()
    {
        InitializeComponent();
        _viewModel = new TanahpediaEntryViewModel();
        BindingContext = _viewModel;
        SetupFontSizeResources();
        EntryHtml.LinkTapped += OnEntryLinkTapped;
        SetupArticleChrome();
        // The in-place person trail and fullscreen are page-owned Back
        // surfaces: they keep the capsule Back enabled even at root stack
        // depth (#2467) — the same surfaces OnBackButtonPressed serves first.
        TopBar.BackStateProvider = () => _viewModel.HasEntryHistory || _chrome.IsFullScreen;
        // Person hops rebind this page in place - return to the top of the
        // destination entry instead of keeping the scrolled family section.
        _viewModel.PropertyChanged += (_, e) =>
        {
            if (e.PropertyName == nameof(TanahpediaEntryViewModel.UniqueName))
            {
                MainThread.BeginInvokeOnMainThread(() => EntryScroll.ScrollToAsync(0, 0, false));
            }
            else if (e.PropertyName == nameof(TanahpediaEntryViewModel.HasEntryHistory))
            {
                MainThread.BeginInvokeOnMainThread(() => TopBar.RefreshBackState());
            }
        };
    }

    /// <summary>
    /// Wires the unified article command surface (#2786): the actions pill's
    /// fullscreen command and the floating exit control run through the same
    /// coordinator every article view uses, and the capsule Back repaints on
    /// each transition.
    /// </summary>
    private void SetupArticleChrome()
    {
        _chrome = new ArticleChrome(
            new ArticleChromeSurfaces
            {
                Toolbar = TopBar,
                Actions = ArticleActions,
                ExitFullscreenButton = ExitFullScreenButton,
            })
        {
            FullscreenStateChanged = _ => TopBar.RefreshBackState(),
        };
    }

    private void SetupFontSizeResources()
    {
        var prefs = PreferencesService.Instance;
        UpdateFontSizeResources(prefs.ArticleFontFactor);
        // The singleton must not retain a pushed entry page - repeated entry
        // navigation would accumulate pages and native views forever (#2640).
        WeakPreferencesSubscription.Subscribe(this, prefs, page =>
            MainThread.BeginInvokeOnMainThread(() =>
                page.UpdateFontSizeResources(prefs.ArticleFontFactor)));
    }

    private void UpdateFontSizeResources(double factor)
    {
        Resources["TanahpediaFontSize"] = factor * 16;
        EntryHtml.SetDynamicResource(HtmlView.FontSizeProperty, "TanahpediaFontSize");
    }

    /// <summary>
    /// Hardware/system Back releases the fullscreen surface first (the same
    /// transient-surface ordering the readers keep), then steps through the
    /// in-place person trail, then leaves.
    /// </summary>
    protected override bool OnBackButtonPressed()
    {
        if (_chrome.HandleBack())
        {
            return true;
        }

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
        #pragma warning disable S2221 // Deliberate failure boundary: link navigation/launcher failure must not crash the page
        catch (Exception ex) //NOSONAR — link navigation/launcher failure must not crash the page.
        {
            #pragma warning restore S2221
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
            await ShellAppNavigator.Instance.DisplayAlertAsync("תנכפדיה", "לא ניתן לפתוח את המקור. נסו שוב", "אישור");
        }
    }

    private async void OnBackToPediaClicked(object? sender, EventArgs e)
    {
        // async void + Shell navigation: an unobserved GoToAsync exception is a
        // crash, so the route runs inside a failure boundary (#2640).
        if (Shell.Current is not { } shell)
        {
            return;
        }
        await _backToPediaGate.RunAsync(async () =>
        {
            try
            {
                var location = shell.CurrentState.Location.OriginalString;
                await shell.GoToAsync(AppRoutes.FlyoutPage("TanahpediaPage", location));
            }
            #pragma warning disable S2221 // Deliberate failure boundary: back navigation failure alerts the user
            catch (Exception ex) //NOSONAR — back navigation failure alerts the user.
            {
                #pragma warning restore S2221
                Console.Error.WriteLine($"Tanahpedia back navigation failed: {ex}");
                await ShellAppNavigator.Instance.DisplayAlertAsync("תנכפדיה", "לא ניתן לחזור כרגע. נסו שוב", "אישור");
            }
        });
    }
}
