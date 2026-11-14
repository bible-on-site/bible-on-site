using BibleOnSite.Helpers;

namespace BibleOnSite.Tests.Helpers;

/// <summary>
/// Windows column-width contract (#2766): the caps keep text lines
/// readable on wide monitors while nested bars stay inside the column.
/// These constants are referenced from XAML via x:Static.
/// </summary>
public class DesktopLayoutTests
{
    [Fact]
    public void Caps_ArePositiveAndOrdered()
    {
        DesktopLayout.ReaderColumnMaxWidth.Should().BeGreaterThan(600);
        DesktopLayout.ReaderColumnMaxWidth.Should().BeLessThanOrEqualTo(DesktopLayout.ContentColumnMaxWidth);
        DesktopLayout.ReaderBarMaxWidth.Should().BeGreaterThan(0);
        DesktopLayout.ReaderSheetMaxWidth.Should().BeGreaterThan(0);
    }

    [Fact]
    public void ReaderBar_FitsInsideReaderColumn()
    {
        // The floating action bar centers under the text column, so it must
        // never be wider than the column itself.
        DesktopLayout.ReaderBarMaxWidth.Should().BeLessThanOrEqualTo(DesktopLayout.ReaderColumnMaxWidth);
        DesktopLayout.ReaderSheetMaxWidth.Should().BeLessThanOrEqualTo(DesktopLayout.ReaderColumnMaxWidth);
    }

    [Fact]
    public void NavPaneBreakpoint_LeavesUsableContentBesideThePane()
    {
        // The flyout is 300 dips wide; locking it must still leave a
        // comfortable content column — below the reader cap and far above
        // the window minimum.
        (DesktopLayout.NavPaneBreakpoint - 300).Should().BeGreaterThanOrEqualTo(600);
        DesktopLayout.NavPaneBreakpoint.Should().BeLessThanOrEqualTo(DesktopLayout.ReaderColumnMaxWidth + 300,
            "the pane must appear before content can reach its maximum width");
    }
}
