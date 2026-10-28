using BibleOnSite.Controls;
using BibleOnSite.Models;

namespace BibleOnSite.Helpers;

/// <summary>
/// The bottom-bar surface shared by the readers — the contract
/// <see cref="Controls.ReaderBottomBar"/> already satisfies. Abstracted so
/// the coordinator is unit-testable without inflating XAML controls.
/// </summary>
public interface IReaderBottomBarSurface
{
    event EventHandler? PerushimToggleRequested;
    event EventHandler? TextModeRequested;
    event EventHandler? ArticlesRequested;
    event EventHandler? FullScreenRequested;

    /// <summary>Mirrors the perushim sheet's open state onto the chevron glyph.</summary>
    bool IsPerushimOpen { get; set; }

    /// <summary>Whether the articles view is shown — tints the articles button.</summary>
    bool IsArticlesActive { get; set; }

    bool IsVisible { get; set; }
}

/// <summary>
/// The perushim bottom-sheet surface shared by the readers — the contract
/// <see cref="Controls.PerushimSheet"/> already satisfies.
/// </summary>
public interface IReaderPerushimSheetSurface
{
    /// <summary>Raised whenever the sheet's open state changes (toggle, pan-dismiss).</summary>
    event EventHandler<bool>? IsOpenChanged;

    /// <summary>Toggles the sheet open/closed with a slide animation.</summary>
    Task ToggleAsync(double hostHeight, double maxExpandedHeight);

    /// <summary>Closes the sheet without animation (e.g. entering articles view).</summary>
    void CloseImmediate();
}

/// <summary>
/// The articles-strip surface shared by the readers — the contract
/// <see cref="Controls.ReaderArticlesView"/> already satisfies.
/// </summary>
public interface IReaderArticlesSurface
{
    /// <summary>Raised when an article card is tapped (selection self-clears).</summary>
    event EventHandler<Article>? ArticleSelected;

    bool IsVisible { get; set; }
}

/// <summary>
/// The named controls a reader page hands to <see cref="ReaderChrome"/>. Every
/// reader declares the same chrome in XAML, so the surfaces are identical —
/// only the division adapters in <see cref="ReaderChromeActions"/> differ.
/// </summary>
public sealed class ReaderChromeSurfaces
{
    public required IReaderBottomBarSurface BottomBar { get; init; }
    public required IReaderPerushimSheetSurface PerushimSheet { get; init; }
    public required ReaderFanMenu FanMenu { get; init; }
    public required ReaderFanMenuSatellite PreviousSatellite { get; init; }
    public required ReaderFanMenuSatellite NextSatellite { get; init; }
    public required ReaderExitFullscreenButton ExitFullscreenButton { get; init; }
    public required IReaderArticlesSurface ArticlesView { get; init; }

    /// <summary>The reading content hidden while articles show (the carousel).</summary>
    public required VisualElement ReaderContent { get; init; }

    /// <summary>The reader toolbar row hidden in fullscreen.</summary>
    public required VisualElement Toolbar { get; init; }

    /// <summary>The page root grid — the sheet's toggle geometry host.</summary>
    public required VisualElement Host { get; init; }

    /// <summary>The content area whose height caps the sheet's expansion.</summary>
    public required VisualElement ContentArea { get; init; }
}

/// <summary>
/// The division-specific plugs <see cref="ReaderChrome"/> needs: unit identity,
/// prev/next capability, article loading/selection and navigation. The
/// transitions they feed are shared; the data is not.
/// </summary>
public sealed class ReaderChromeActions
{
    /// <summary>Pushes the current unit's articles into the articles view.</summary>
    public required Func<Task> ReloadArticlesAsync { get; init; }

    /// <summary>The currently displayed reading unit (scroll-to-start target).</summary>
    public required Func<object?> CurrentUnit { get; init; }

    /// <summary>Marks (or clears, on null) the selected article id on the view model.</summary>
    public required Action<int?> SelectArticle { get; init; }

    public required Func<bool> CanGoPrevious { get; init; }
    public required Func<bool> CanGoNext { get; init; }

    /// <summary>Whether a picked id can be navigated to (division range rule).</summary>
    public required Func<int, bool> IsSelectableUnit { get; init; }

    /// <summary>The currently displayed unit's stable id.</summary>
    public required Func<int> CurrentUnitId { get; init; }

    /// <summary>Navigates the reader to a confirmed picked unit id.</summary>
    public required Func<int, Task> NavigateToUnitAsync { get; init; }

    /// <summary>
    /// Runs after a fullscreen transition completes — page extras such as
    /// closing the search surface or refreshing the Android Back callback.
    /// </summary>
    public Action<bool>? FullscreenStateChanged { get; init; }
}

/// <summary>
/// Owns the reader's chrome-surface state machine shared by the perek, parasha
/// and masora readers (#2573): the perushim sheet toggle geometry and chevron
/// sync, the articles/text view swap, fullscreen enter/exit, the fan's
/// prev/next satellite refresh, and the picker-confirmation cleanup (#2476 —
/// a confirmed pick closes the fan so no dimmed overlay lingers).
///
/// The coordinator subscribes the shared controls' events itself, so the pages
/// carry no duplicated XAML wiring or handler bodies — each page only supplies
/// the surfaces plus the small division adapters. The XAML-control surfaces
/// are interface seams so the whole path is unit-testable without handlers.
/// </summary>
public sealed class ReaderChrome
{
    private readonly ReaderChromeSurfaces _ui;
    private readonly ReaderChromeActions _actions;

    public ReaderChrome(ReaderChromeSurfaces surfaces, ReaderChromeActions actions)
    {
        _ui = surfaces;
        _actions = actions;

        _ui.BottomBar.PerushimToggleRequested += OnPerushimToggleRequested;
        _ui.BottomBar.TextModeRequested += OnTextModeRequested;
        _ui.BottomBar.ArticlesRequested += OnArticlesRequested;
        _ui.BottomBar.FullScreenRequested += OnFullScreenRequested;
        _ui.PerushimSheet.IsOpenChanged += (_, isOpen) => _ui.BottomBar.IsPerushimOpen = isOpen;
        _ui.FanMenu.Opening += OnFanMenuOpening;
        _ui.ExitFullscreenButton.ExitRequested += OnExitFullscreenRequested;
        _ui.ArticlesView.ArticleSelected += async (_, article) => await OnArticleSelectedAsync(article);
    }

    /// <summary>Whether the articles view currently replaces the reading content.</summary>
    public bool IsShowingArticles { get; private set; }

    /// <summary>Whether the reader is in fullscreen (the exit button shows).</summary>
    public bool IsFullScreen => _ui.ExitFullscreenButton.IsVisible;

    // Seam so tests observe the article navigation target without Shell
    // (same pattern as ReaderScrollTop.AnimateScroll).
    internal static Func<int, Task> OpenArticle { get; set; } =
        articleId => Shell.Current.GoToAsync($"articleDetail?articleId={articleId}");

    // Seam so tests observe the scroll-to-start delegation without a realized
    // scroll surface (the helper itself is covered by ReaderScrollTopTests).
    internal static Func<VisualElement, object?, bool> ScrollToStart { get; set; } =
        ReaderScrollTop.ScrollCurrentUnitToStart;

    /// <summary>
    /// Refreshes the fan's prev/next satellites — enabled state plus the
    /// disabled-opacity workaround for MAUI not repainting disabled buttons in
    /// AbsoluteLayout. No-op while the fan is closed (the next
    /// <see cref="ReaderFanMenu.Opening"/> re-reads the state anyway).
    /// </summary>
    public void RefreshPrevNext()
    {
        if (!_ui.FanMenu.IsOpen)
        {
            return;
        }

        var canPrev = _actions.CanGoPrevious();
        var canNext = _actions.CanGoNext();

        _ui.PreviousSatellite.IsEnabled = canPrev;
        _ui.PreviousSatellite.Opacity = canPrev ? 1.0 : 0.4;

        _ui.NextSatellite.IsEnabled = canNext;
        _ui.NextSatellite.Opacity = canNext ? 1.0 : 0.4;
    }

    /// <summary>
    /// A confirmed picker selection completes the interaction: the picker has
    /// hidden itself and the fan that opened it closes too, leaving the reader
    /// undimmed and interactive (#2476). Then a valid, different unit id
    /// navigates through the division adapter.
    /// </summary>
    public async Task CompletePickerSelectionAsync(int unitId)
    {
        await _ui.FanMenu.CloseAsync();

        if (_actions.IsSelectableUnit(unitId) && unitId != _actions.CurrentUnitId())
        {
            await _actions.NavigateToUnitAsync(unitId);
        }
    }

    /// <summary>Exits fullscreen — restores the toolbar, bottom bar and fan.</summary>
    public void ExitFullScreen()
    {
        _ui.ExitFullscreenButton.IsVisible = false;
        _ui.Toolbar.IsVisible = true;
        _ui.BottomBar.IsVisible = true;
        _ui.FanMenu.IsVisible = true;
        _actions.FullscreenStateChanged?.Invoke(false);
    }

    /// <summary>Returns to the reading view from the articles view.</summary>
    private void ShowTextView()
    {
        IsShowingArticles = false;
        _actions.SelectArticle(null);

        _ui.ArticlesView.IsVisible = false;
        _ui.ReaderContent.IsVisible = true;

        _ui.BottomBar.IsArticlesActive = false;
    }

    /// <summary>Bottom-bar chevron — toggles the perushim sheet.</summary>
    private async void OnPerushimToggleRequested(object? sender, EventArgs e)
    {
        // Cap the drag-up expansion so the sheet's top edge stays under the
        // status bar/pill: content + toolbar rows already begin below it.
        var toolbarHeight = _ui.Toolbar.IsVisible ? _ui.Toolbar.Height : 0;
        await _ui.PerushimSheet.ToggleAsync(_ui.Host.Height, _ui.ContentArea.Height + toolbarHeight - 8);
    }

    /// <summary>Fan open — refresh prev/next before the satellites fade in.</summary>
    private void OnFanMenuOpening(object? sender, EventArgs e) => RefreshPrevNext();

    /// <summary>
    /// Text button — returns to the reading view from articles, else animates
    /// the visible unit's vertical content back to its start (#2624).
    /// </summary>
    private void OnTextModeRequested(object? sender, EventArgs e)
    {
        if (IsShowingArticles)
        {
            ShowTextView();
        }
        else
        {
            ScrollToStart(_ui.ReaderContent, _actions.CurrentUnit());
        }
    }

    /// <summary>Articles button — shows the current unit's articles.</summary>
    private async void OnArticlesRequested(object? sender, EventArgs e)
    {
        try
        {
            if (IsShowingArticles)
            {
                return;
            }

            _ui.PerushimSheet.CloseImmediate();
            IsShowingArticles = true;
            await _actions.ReloadArticlesAsync();

            _ui.ReaderContent.IsVisible = false;
            _ui.ArticlesView.IsVisible = true;

            _ui.BottomBar.IsArticlesActive = true;
        }
#pragma warning disable S2221 // Deliberate failure boundary: articles-view transition must not crash the reader
        catch (Exception ex) //NOSONAR — articles-view transition must not crash the reader.
        {
#pragma warning restore S2221
            Console.Error.WriteLine($"[Articles] Error showing articles view: {ex}");
        }
    }

    /// <summary>Article tap — marks it and navigates to the article detail.</summary>
    private async Task OnArticleSelectedAsync(Article article)
    {
        _actions.SelectArticle(article.Id);
        try
        {
            await OpenArticle(article.Id);
        }
#pragma warning disable S2221 // Deliberate failure boundary: article navigation failure is log-only
        catch (Exception ex) //NOSONAR — article navigation failure is log-only.
        {
#pragma warning restore S2221
            Console.Error.WriteLine($"Error navigating to article: {ex.Message}");
        }
    }

    /// <summary>Fullscreen button — enters fullscreen.</summary>
    private void OnFullScreenRequested(object? sender, EventArgs e) => EnterFullScreen();

    /// <summary>Exit-fullscreen button — leaves fullscreen.</summary>
    private void OnExitFullscreenRequested(object? sender, EventArgs e) => ExitFullScreen();

    /// <summary>Enters fullscreen — hides the bars, shows the floating exit button.</summary>
    private void EnterFullScreen()
    {
        // Snap the fan closed without animation so its scrim cannot linger
        // over the fullscreen reader.
        _ui.FanMenu.ResetToClosed();

        _ui.Toolbar.IsVisible = false;
        _ui.BottomBar.IsVisible = false;
        _ui.FanMenu.IsVisible = false;
        _ui.ExitFullscreenButton.ResetPosition();
        _ui.ExitFullscreenButton.IsVisible = true;
        _actions.FullscreenStateChanged?.Invoke(true);
    }
}
