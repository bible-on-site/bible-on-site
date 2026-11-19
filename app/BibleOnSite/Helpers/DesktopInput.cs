namespace BibleOnSite.Helpers;

/// <summary>
/// What the shared Windows desktop input layer (keyboard shortcuts and
/// mouse back-button in Platforms/Windows/DesktopWindowChrome) needs from
/// the currently displayed page. Implemented by the reader pages (#2766).
/// </summary>
public interface IWindowsDesktopSurface
{
    /// <summary>
    /// Dismisses the page's topmost transient surface (picker, fan menu,
    /// fullscreen, options menu, search, pasuk selection). Returns true
    /// when something was actually dismissed, false when the key press
    /// should continue up the chain (in-app navigation).
    /// </summary>
    bool DismissTopmostSurface();

    /// <summary>
    /// Moves keyboard focus to the page's sensible entry point after
    /// arriving at the page, so a keyboard-only session lands somewhere
    /// useful instead of nowhere.
    /// </summary>
    void FocusInitialElement();
}

/// <summary>
/// Optional extension for pages that own a desktop search surface, invoked
/// for Ctrl+F (#2766).
/// </summary>
public interface IWindowsSearchSurface
{
    /// <summary>Opens (or re-focuses) the page's search surface.</summary>
    void OpenDesktopSearch();
}

/// <summary>
/// Optional extension for reader pages with the in-app fullscreen reading
/// presentation, toggled by F11 (#2766). Esc/Back still exit it through
/// <see cref="IWindowsDesktopSurface.DismissTopmostSurface"/>.
/// </summary>
public interface IWindowsFullscreenSurface
{
    /// <summary>Enters or leaves the reader's fullscreen presentation.</summary>
    void ToggleDesktopFullscreen();
}

/// <summary>
/// Optional extension for reader pages that can step one reading unit
/// (perek / parasha unit / masora unit) from the keyboard (#2766). PgUp and
/// PgDn ride this surface; a scrollable list that owns focus still handles
/// them itself, so the accelerator only reaches here when the keys are free.
/// </summary>
public interface IWindowsUnitNavSurface
{
    /// <summary>
    /// Steps one unit in <paramref name="direction"/> (-1 previous, +1 next).
    /// Returns false — leaving the key unhandled — while a transient surface
    /// (picker, fan, search, selection, fullscreen chrome) owns input or the
    /// edge of the corpus is reached.
    /// </summary>
    bool TryNavigateUnit(int direction);
}

/// <summary>What the Back key/accelerator/mouse-back should do.</summary>
public enum DesktopBackRoute
{
    /// <summary>The press was fully consumed inside the current page.</summary>
    Consume,
    /// <summary>Close the open shell flyout instead of navigating.</summary>
    CloseFlyout,
    /// <summary>Navigate back within the app.</summary>
    NavigateBack,
}

/// <summary>
/// Pure decision logic for the shared Windows keyboard layer, kept
/// platform-free so the precedence order is unit-testable (#2766).
/// Precedence for both Esc and Back: open flyout → page's topmost surface
/// → (Back only) in-app navigation → consume (never exit the app from a
/// key press; the exit confirmation lives behind the real title-bar Back
/// and window close buttons).
/// </summary>
public static class DesktopInputPlan
{
    /// <summary>
    /// Decides where a Back press (Alt+Left or the mouse X1 button) goes.
    /// </summary>
    /// <param name="flyoutOpen">The shell flyout is currently presented.</param>
    /// <param name="surfaceDismissed">The current page dismissed a
    /// surface via <see cref="IWindowsDesktopSurface.DismissTopmostSurface"/>.</param>
    /// <param name="hasInAppHistory">The Shell navigation stack holds more
    /// than the root page.</param>
    public static DesktopBackRoute EvaluateBack(bool flyoutOpen, bool surfaceDismissed, bool hasInAppHistory)
        => flyoutOpen
            ? DesktopBackRoute.CloseFlyout
            : surfaceDismissed
                ? DesktopBackRoute.Consume
                : hasInAppHistory ? DesktopBackRoute.NavigateBack : DesktopBackRoute.Consume;

    /// <summary>
    /// Decides where an Escape press goes. Escape never navigates and
    /// never exits: it only peels the topmost transient layer.
    /// </summary>
    /// <returns>True when the press was handled (flyout closed or a page
    /// surface dismissed); false to leave the key unhandled.</returns>
    public static bool EvaluateEscape(bool flyoutOpen, bool surfaceDismissed)
        => flyoutOpen || surfaceDismissed;
}

/// <summary>
/// Pure gating for PgUp/PgDn unit stepping shared by the readers (#2766):
/// a transient surface that owns Back also owns unit stepping, and a
/// command that cannot run (corpus edge) leaves the key unhandled.
/// </summary>
public static class DesktopUnitNavigation
{
    /// <summary>
    /// Executes <paramref name="next"/> for a positive direction or
    /// <paramref name="previous"/> otherwise. Returns false when
    /// <paramref name="backOwner"/> is any surface other than
    /// <see cref="ReaderBackSurface.None"/> — stepping never rips a
    /// reading unit out from under a picker, menu, search or selection —
    /// or when the chosen command cannot run, so the key press stays
    /// unhandled.
    /// </summary>
    public static bool TryStep(ReaderBackSurface backOwner,
        System.Windows.Input.ICommand? next, System.Windows.Input.ICommand? previous, int direction)
    {
        if (backOwner != ReaderBackSurface.None)
        {
            return false;
        }

        var command = direction > 0 ? next : previous;
        if (command?.CanExecute(null) != true)
        {
            return false;
        }

        command.Execute(null);
        return true;
    }
}
