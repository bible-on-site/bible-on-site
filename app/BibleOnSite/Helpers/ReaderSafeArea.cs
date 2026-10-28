using BibleOnSite.Controls;
using Microsoft.Maui;
using Microsoft.Maui.Controls;

namespace BibleOnSite.Helpers;

public static class ReaderSafeArea
{
    /// <summary>
    /// MAUI pads every Layout inside the device safe area by default
    /// (SafeAreaEdges = Container), and each Layout pads independently —
    /// clearing it only on the root just moves the padding to the content
    /// area, which is what produced the empty landscape side bands (#1308).
    /// Keep the root's top inset so the reader toolbar stays below the status
    /// bar and notch; its bottom edge also respects the home indicator, with
    /// <see cref="ApplyBottomBarInset"/> managing the bottom bar itself.
    /// Leave the sides and descendant layouts unpadded so landscape content
    /// spans the width. Views inside scroll views (the carousel cells and
    /// pasukim lists) never apply safe-area padding, so only the direct
    /// layout chain needs this.
    /// </summary>
    public static void Configure(Layout root)
    {
        // MAUI includes root in GetVisualTreeDescendants. Apply its insets last
        // so clearing nested layouts cannot put the toolbar under the status bar.
        foreach (var layout in root.GetVisualTreeDescendants().OfType<Layout>())
        {
            layout.SafeAreaEdges = SafeAreaEdges.None;
        }
        root.SafeAreaEdges = new SafeAreaEdges(
            SafeAreaRegions.None,
            SafeAreaRegions.Container,
            SafeAreaRegions.None,
            SafeAreaRegions.Container);
    }

#if IOS
    /// <summary>
    /// The key window's bottom safe-area inset — the home-indicator strip.
    /// Zero where no inset exists (iPad, landscape) or no window is attached
    /// yet; applying it restores the layout defaults, so an inset that
    /// disappears never leaves stale values behind.
    /// </summary>
    public static double CurrentBottomInset()
    {
        var window = UIKit.UIApplication.SharedApplication?.ConnectedScenes
            .OfType<UIKit.UIWindowScene>()
            .FirstOrDefault()?.Windows
            .FirstOrDefault(w => w.IsKeyWindow);
        return window?.SafeAreaInsets.Bottom ?? 0;
    }
#endif

    /// <summary>
    /// Applies the bottom safe-area inset to the reader's bottom chrome —
    /// identical geometry on every reader (#2573): the bar shifts down over
    /// the home-indicator inset and grows by it (tester-confirmed
    /// combination; #2721 — without this the fan's satellites stay laid out
    /// over the inset area their accessibility bounds report, so taps land
    /// on the shifted geometry instead of the rendered buttons), the fan
    /// floats above the gesture bar, the page pulls up underneath so no gap
    /// shows, and <c>BottomBarTotalHeight</c> publishes the total for the
    /// pasuk-list footers.
    /// </summary>
    /// <param name="page">The reader page (padding and resource target).</param>
    /// <param name="bottomBar">The bottom bar shifted over the inset.</param>
    /// <param name="fanMenu">The fan floated above the gesture bar.</param>
    /// <param name="bottomInset">The window's bottom safe-area inset.</param>
    /// <param name="baseBarHeight">
    /// The bar's height with no inset — every reader passes
    /// <see cref="Controls.ReaderBottomBar.TotalHeight"/>.
    /// </param>
    public static void ApplyBottomBarInset(ContentPage page, Layout bottomBar,
        ReaderFanMenu fanMenu, double bottomInset, double baseBarHeight)
    {
        var totalHeight = baseBarHeight + bottomInset;
        bottomBar.TranslationY = bottomInset;
        bottomBar.Padding = new Thickness(0, 0, 0, bottomInset);
        bottomBar.HeightRequest = totalHeight;
        fanMenu.SetBottomInset(bottomInset);
        page.Padding = new Thickness(0, 0, 0, -bottomInset);
        page.Resources["BottomBarTotalHeight"] = totalHeight;
    }
}
