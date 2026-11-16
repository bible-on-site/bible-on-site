using BibleOnSite.Helpers;
using BibleOnSite.ViewModels;

namespace BibleOnSite.Pages;

/// <summary>
/// The Tanahpedia landing page — today's anniversaries, the category
/// hierarchy and recently updated entries, mirroring the website's
/// <c>/pedia</c> landing.
/// </summary>
#pragma warning disable S2333 // MAUI XAML supplies the other partial declaration and controls.
public partial class TanahpediaPage : ContentPage, IWindowsDesktopSurface, IWindowsSearchSurface
#pragma warning restore S2333
{
    private readonly TanahpediaViewModel _viewModel = new();

    public TanahpediaPage()
    {
        InitializeComponent();
        BindingContext = _viewModel;
        TanahpediaSearch.OnEntrySelected = uniqueName => _ = OpenEntrySafelyAsync(uniqueName);
    }

    /// <summary>
    /// The panel's callback is a fire-and-forget Action - an async lambda
    /// would go async-void, and a route failure there is an unobserved crash.
    /// </summary>
    private async Task OpenEntrySafelyAsync(string uniqueName)
    {
        try
        {
            await _viewModel.OpenEntryCommand.ExecuteAsync(uniqueName);
        }
        #pragma warning disable S2221 // Deliberate failure boundary: entry navigation failure must not crash the page
        catch (Exception ex) //NOSONAR — entry navigation failure must not crash the page.
        {
            #pragma warning restore S2221
            Console.Error.WriteLine($"Tanahpedia entry navigation failed for {uniqueName}: {ex}");
        }
    }

    protected override async void OnAppearing()
    {
        base.OnAppearing();

        if (!_viewModel.IsLoaded && !_viewModel.IsLoading)
        {
            await _viewModel.LoadAsync();
        }
    }

    private async void OnSearchTitleClicked(object? sender, EventArgs e) //NOSONAR
    {
        await TanahpediaSearch.OpenAsync();
    }

    /// <summary>Esc and the desktop Back inputs peel the search overlay (or its
    /// filter sheet) before navigation (#2766).</summary>
    bool IWindowsDesktopSurface.DismissTopmostSurface() => TanahpediaSearch.HandleBack();

    void IWindowsDesktopSurface.FocusInitialElement()
    {
        // Same guard as the readers: an open search overlay owns focus —
        // refocused initial focus must not yank it back to the hamburger.
        if (!TanahpediaSearch.IsSearchOpen)
        {
            Controls.SharedTopBar.FocusNavigationButton(this);
        }
    }

    /// <summary>Ctrl+F opens the scoped Tanahpedia search (#2766).</summary>
    void IWindowsSearchSurface.OpenDesktopSearch() => _ = TanahpediaSearch.OpenAsync();

    protected override bool OnBackButtonPressed()
    {
        if (TanahpediaSearch.HandleBack())
        {
            return true;
        }
        return base.OnBackButtonPressed();
    }
}
