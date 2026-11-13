using BibleOnSite.Helpers;

namespace BibleOnSite.Tests.Helpers;

/// <summary>
/// The reader's foreground-first Back ownership (#3307): a covered surface
/// must not intercept the press meant for the overlay above it, so an open
/// perushim sheet under the focused pasuk keeps its state while the first
/// Back leaves focus — and the next Back then reaches the sheet itself.
/// </summary>
public class ReaderBackPolicyTests
{
    [Fact]
    public void a_bare_reader_has_no_back_surface_so_back_navigates()
    {
        ReaderBackPolicy.Resolve(
            exitFullScreenVisible: false, unitPickerOpen: false, fanMenuOpen: false,
            menuOverlayOpen: false, chapterSearchOpen: false, focusedPasuk: false,
            perushimSheetOpen: false, selectionSurfacesActive: false)
            .Should().Be(ReaderBackSurface.None);
    }

    [Fact]
    public void a_focused_pasuk_over_an_open_sheet_owns_back_first()
    {
        // Regression for #3307: perek -> open perushim sheet -> focus pasuk ->
        // Back. The first press must leave focus and keep the sheet open, not
        // close the covered sheet underneath the focused view.
        ReaderBackPolicy.Resolve(
            exitFullScreenVisible: false, unitPickerOpen: false, fanMenuOpen: false,
            menuOverlayOpen: false, chapterSearchOpen: false, focusedPasuk: true,
            perushimSheetOpen: true, selectionSurfacesActive: false)
            .Should().Be(ReaderBackSurface.FocusedPasuk);
    }

    [Fact]
    public void once_focus_leaves_the_still_open_sheet_owns_the_next_back()
    {
        // The reported two-press path becomes the correct sequence: after the
        // first Back dismissed focus, the sheet is the foreground surface and
        // owns the second press through the normal pipeline.
        ReaderBackPolicy.Resolve(
            exitFullScreenVisible: false, unitPickerOpen: false, fanMenuOpen: false,
            menuOverlayOpen: false, chapterSearchOpen: false, focusedPasuk: false,
            perushimSheetOpen: true, selectionSurfacesActive: false)
            .Should().Be(ReaderBackSurface.PerushimSheet);
    }

    [Fact]
    public void search_open_over_focus_and_the_sheet_owns_back()
    {
        // The focused-pasuk-scoped search paints above both overlays.
        ReaderBackPolicy.Resolve(
            exitFullScreenVisible: false, unitPickerOpen: false, fanMenuOpen: false,
            menuOverlayOpen: false, chapterSearchOpen: true, focusedPasuk: true,
            perushimSheetOpen: true, selectionSurfacesActive: false)
            .Should().Be(ReaderBackSurface.ChapterSearch);
    }

    [Theory]
    [InlineData(true, false, false, ReaderBackSurface.UnitPicker)]
    [InlineData(false, true, false, ReaderBackSurface.FanMenu)]
    [InlineData(false, false, true, ReaderBackSurface.MenuOverlay)]
    public void surfaces_genuinely_above_focus_keep_back_ownership(
        bool pickerOpen, bool fanOpen, bool menuOpen, ReaderBackSurface expected)
    {
        // A picker, fan or options dropdown opened above the focused pasuk is
        // dismissed before focus — the fix must not swap every surface under
        // focus, only the covered perushim sheet.
        ReaderBackPolicy.Resolve(
            exitFullScreenVisible: false, unitPickerOpen: pickerOpen, fanMenuOpen: fanOpen,
            menuOverlayOpen: menuOpen, chapterSearchOpen: false, focusedPasuk: true,
            perushimSheetOpen: true, selectionSurfacesActive: false)
            .Should().Be(expected);
    }

    [Fact]
    public void fullscreen_exit_owns_back_above_every_surface()
    {
        ReaderBackPolicy.Resolve(
            exitFullScreenVisible: true, unitPickerOpen: true, fanMenuOpen: true,
            menuOverlayOpen: true, chapterSearchOpen: true, focusedPasuk: true,
            perushimSheetOpen: true, selectionSurfacesActive: true)
            .Should().Be(ReaderBackSurface.ExitFullScreen);
    }

    [Fact]
    public void an_open_sheet_outranks_selection_surfaces()
    {
        // Selecting pesukim leaves the top rows tappable while the sheet is
        // open — the visible sheet is the foreground dismissal.
        ReaderBackPolicy.Resolve(
            exitFullScreenVisible: false, unitPickerOpen: false, fanMenuOpen: false,
            menuOverlayOpen: false, chapterSearchOpen: false, focusedPasuk: false,
            perushimSheetOpen: true, selectionSurfacesActive: true)
            .Should().Be(ReaderBackSurface.PerushimSheet);
    }

    [Fact]
    public void a_clip_playing_with_nothing_else_is_a_surface_back_consumes()
    {
        ReaderBackPolicy.Resolve(
            exitFullScreenVisible: false, unitPickerOpen: false, fanMenuOpen: false,
            menuOverlayOpen: false, chapterSearchOpen: false, focusedPasuk: false,
            perushimSheetOpen: false, selectionSurfacesActive: true)
            .Should().Be(ReaderBackSurface.SelectionSurfaces);
    }
}
