using BibleOnSite.Controls;

namespace BibleOnSite.Helpers;

/// <summary>
/// The article action-group surface shared by the article views — the
/// contract <see cref="ArticleActionsBar"/> already satisfies. Abstracted so
/// the coordinator is unit-testable without inflating XAML controls.
/// </summary>
public interface IArticleActionsSurface
{
    /// <summary>Raised when the fullscreen command is tapped.</summary>
    event EventHandler? FullScreenRequested;
}

/// <summary>
/// The named controls an article page hands to <see cref="ArticleChrome"/>.
/// Every article view declares the same chrome in XAML, so the surfaces are
/// identical — the pages only supply them.
/// </summary>
public sealed class ArticleChromeSurfaces
{
    /// <summary>The shared top bar hidden while the article reads fullscreen.</summary>
    public required VisualElement Toolbar { get; init; }

    /// <summary>The trailing command pill holding Share and Fullscreen.</summary>
    public required IArticleActionsSurface Actions { get; init; }

    /// <summary>The floating exit-fullscreen button — the same control the readers use.</summary>
    public required ReaderExitFullscreenButton ExitFullscreenButton { get; init; }
}

/// <summary>
/// Owns the article view's chrome-surface state machine shared by the
/// article detail and Tanahpedia entry pages (#2786): fullscreen enter/exit
/// and the Back consumption while the transient surface is up. The same
/// transition the readers run through <see cref="ReaderChrome"/> — the top
/// bar collapses for the reading space and the shared draggable exit
/// control appears — kept as one coordinator so the pages cannot drift.
/// Return and Share stay on the bar itself: the capsule Back rides the
/// shared back pipeline and Share stays bound to the page's command.
/// </summary>
public sealed class ArticleChrome
{
    private readonly ArticleChromeSurfaces _ui;

    /// <summary>Runs after a fullscreen transition completes — the page
    /// refreshes the capsule Back state on it.</summary>
    public Action<bool>? FullscreenStateChanged { get; set; }

    public ArticleChrome(ArticleChromeSurfaces surfaces)
    {
        _ui = surfaces;

        _ui.Actions.FullScreenRequested += (_, _) => EnterFullScreen();
        _ui.ExitFullscreenButton.ExitRequested += (_, _) => ExitFullScreen();
    }

    /// <summary>Whether the article is fullscreen (the exit button shows).</summary>
    public bool IsFullScreen => _ui.ExitFullscreenButton.IsVisible;

    /// <summary>Enters fullscreen — hides the bar, shows the floating exit button.</summary>
    public void EnterFullScreen()
    {
        if (IsFullScreen)
        {
            return;
        }

        _ui.Toolbar.IsVisible = false;
        _ui.ExitFullscreenButton.ResetPosition();
        _ui.ExitFullscreenButton.IsVisible = true;
        FullscreenStateChanged?.Invoke(true);
    }

    /// <summary>Exits fullscreen — restores the bar over the same article position.</summary>
    public void ExitFullScreen()
    {
        if (!IsFullScreen)
        {
            return;
        }

        _ui.ExitFullscreenButton.IsVisible = false;
        _ui.Toolbar.IsVisible = true;
        FullscreenStateChanged?.Invoke(false);
    }

    /// <summary>
    /// A Back press while the fullscreen surface is up belongs to the surface:
    /// exit fullscreen and consume. The page's <c>OnBackButtonPressed</c>
    /// delegates here first — the same ordering the readers give their
    /// transient surfaces.
    /// </summary>
    public bool HandleBack()
    {
        if (!IsFullScreen)
        {
            return false;
        }

        ExitFullScreen();
        return true;
    }
}
