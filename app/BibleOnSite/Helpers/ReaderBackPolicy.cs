namespace BibleOnSite.Helpers;

/// <summary>
/// Which transient reader surface owns a committed Back press, in
/// foreground-first dismissal order.
/// </summary>
public enum ReaderBackSurface
{
    /// <summary>No transient surface is up — Back falls through to navigation.</summary>
    None = 0,

    /// <summary>The floating exit-fullscreen chrome (a mode, outranks every overlay).</summary>
    ExitFullScreen,

    /// <summary>The unit picker popup (perek/parasha/masora).</summary>
    UnitPicker,

    /// <summary>The navigation fan menu.</summary>
    FanMenu,

    /// <summary>The reader options dropdown (perek/parasha).</summary>
    MenuOverlay,

    /// <summary>The chapter search panel — it paints above every reader overlay.</summary>
    ChapterSearch,

    /// <summary>The focused-pasuk overlay — it paints above the perushim sheet.</summary>
    FocusedPasuk,

    /// <summary>The perushim bottom sheet — beneath the reader overlays.</summary>
    PerushimSheet,

    /// <summary>The selection/chapter-recitation/playback mode surfaces.</summary>
    SelectionSurfaces,
}

/// <summary>
/// Pure ordering rules for the reader pages' Back pipelines, kept separate so
/// the foreground-first ownership stays unit-testable — the same seam
/// <see cref="BackExitPlan"/> uses for the Shell hook.
///
/// A covered surface must not intercept the press meant for the overlay above
/// it (#3307): the perushim sheet paints beneath the focused pasuk, so an
/// open sheet under focus must not swallow the first Back — focus leaves and
/// the sheet survives with its scroll position, query and checked perushim
/// intact. The chapter search paints above both, so it owns Back whenever it
/// is open (including the focused-pasuk-scoped search). Surfaces that cannot
/// be visible together keep their historical relative rank.
/// </summary>
public static class ReaderBackPolicy
{
    /// <summary>
    /// Resolves the surface that owns the next Back press.
    /// </summary>
    /// <param name="exitFullScreenVisible">The floating exit-fullscreen button is showing.</param>
    /// <param name="unitPickerOpen">The division's unit picker popup is showing.</param>
    /// <param name="fanMenuOpen">The navigation fan is open.</param>
    /// <param name="menuOverlayOpen">The reader options dropdown is open.</param>
    /// <param name="chapterSearchOpen">The chapter search panel is open.</param>
    /// <param name="focusedPasuk">A pasuk is in focused-pasuk view.</param>
    /// <param name="perushimSheetOpen">The perushim bottom sheet is open.</param>
    /// <param name="selectionSurfacesActive">
    /// A pesukim selection, chapter recitation mode, or an in-flight clip
    /// keeps the selection bar up (<see cref="ReaderSurfaceState.IsActive"/>).
    /// </param>
    public static ReaderBackSurface Resolve(
        bool exitFullScreenVisible,
        bool unitPickerOpen,
        bool fanMenuOpen,
        bool menuOverlayOpen,
        bool chapterSearchOpen,
        bool focusedPasuk,
        bool perushimSheetOpen,
        bool selectionSurfacesActive)
    {
        if (exitFullScreenVisible)
        {
            return ReaderBackSurface.ExitFullScreen;
        }
        if (unitPickerOpen)
        {
            return ReaderBackSurface.UnitPicker;
        }
        if (fanMenuOpen)
        {
            return ReaderBackSurface.FanMenu;
        }
        if (menuOverlayOpen)
        {
            return ReaderBackSurface.MenuOverlay;
        }
        if (chapterSearchOpen)
        {
            return ReaderBackSurface.ChapterSearch;
        }
        if (focusedPasuk)
        {
            return ReaderBackSurface.FocusedPasuk;
        }
        if (perushimSheetOpen)
        {
            return ReaderBackSurface.PerushimSheet;
        }
        return selectionSurfacesActive ? ReaderBackSurface.SelectionSurfaces : ReaderBackSurface.None;
    }
}
