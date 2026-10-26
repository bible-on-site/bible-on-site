namespace BibleOnSite.Helpers;

/// <summary>
/// The reader's text-tab reselect: when scripture is already showing, tapping
/// א ב ג animates the currently visible reading unit's vertical content back
/// to its start — the first row beneath the unit header (#2624). The host
/// carousel is virtualized, so the realized scroll surface is resolved by the
/// current unit's identity rather than by carousel position or first match.
/// Shared by the על הפרק, פרשה על הפרק and מסורה readers (#2573).
/// </summary>
public static class ReaderScrollTop
{
    /// <summary>
    /// Scrolls the vertical reading surface realized for
    /// <paramref name="currentUnit"/> inside <paramref name="root"/> back to its
    /// beginning. Returns true when the active surface was found and the scroll
    /// issued; false when no surface is realized for the unit (mid-swipe
    /// recycling, a still-loading item), in which case the tap is a no-op
    /// instead of scrolling a stale or off-screen list.
    /// </summary>
    public static bool ScrollCurrentUnitToStart(VisualElement root, object? currentUnit)
    {
        if (currentUnit is null)
        {
            return false;
        }
        var animate = AnimateScroll();
        foreach (var element in root.GetVisualTreeDescendants().OfType<VisualElement>())
        {
            // A realized item's scroll surfaces inherit the unit instance as
            // their BindingContext; a neighbour's surfaces keep pointing at its
            // own unit, and a recycled view rebound to a different unit stops
            // matching before it can be scrolled.
            if (!ReferenceEquals(element.BindingContext, currentUnit) ||
                !element.IsVisible || element.Handler is null || element.Height <= 0)
            {
                continue;
            }
            if (element is CollectionView list)
            {
                list.ScrollTo(0, position: ScrollToPosition.Start, animate: animate);
                return true;
            }
            if (element is ScrollView scrollView)
            {
                _ = scrollView.ScrollToAsync(0, 0, animate);
                _ = ConfirmScrollLandedAsync(scrollView, currentUnit, animate);
                return true;
            }
        }
        return false;
    }

    /// <summary>
    /// Re-issues the jump until the view reports its start, in a bounded
    /// window. On Android a still-running platform scroller (fling, edge
    /// bounce) can reclaim the position right after an instant scrollTo, so
    /// the request is verified against <see cref="ScrollView.ScrollY"/>
    /// instead of assumed to have landed.
    /// </summary>
    private static async Task ConfirmScrollLandedAsync(ScrollView scrollView, object unit, bool animate)
    {
        const int maxAttempts = 10;
        for (var attempt = 0; attempt < maxAttempts; attempt++)
        {
            await Task.Delay(120);
            if (scrollView.Handler is null || scrollView.ScrollY <= 0.5)
            {
                return;
            }
            // A recycled view may have been rebound to a neighbour unit by
            // now — reissue only while the surface still belongs to it.
            scrollView.Dispatcher?.Dispatch(() =>
            {
                if (ReferenceEquals(scrollView.BindingContext, unit))
                {
                    _ = scrollView.ScrollToAsync(0, 0, animate);
                }
            });
        }
    }

    /// <summary>
    /// Debug-only mobile-E2E probe (#2624): mirrors the live תיקון scroll
    /// offset into the view's accessibility description ("tsy:{dips}") so
    /// tests read the exact position deterministically — the custom-drawn
    /// content reports no scroll state through accessibility bounds, and pixel
    /// captures flap against scrollbar fades. A no-op in release builds.
    /// </summary>
    internal static void NoteScrollOffset(object? sender, ScrolledEventArgs e)
    {
#if DEBUG
        if (sender is BindableObject element)
        {
            SemanticProperties.SetDescription(element, $"tsy:{(int)Math.Round(e.ScrollY)}");
        }
#endif
    }

    // Seam so tests can assert the preference reaches the scroll request; the
    // platform implementations keep the reduced-motion/system-animation flags.
    internal static Func<bool> AnimateScroll { get; set; } = PlatformPrefersAnimatedScroll;

    private static bool PlatformPrefersAnimatedScroll()
    {
#if IOS || MACCATALYST
        return !UIKit.UIAccessibility.IsReduceMotionEnabled;
#elif ANDROID
        // The accessibility "remove animations" setting zeroes the animator
        // scale; when it does, land the scroll instantly instead of animating.
        var context = Platform.CurrentActivity ?? Android.App.Application.Context;
        var scale = context?.ContentResolver is { } resolver
            ? Android.Provider.Settings.Global.GetFloat(resolver,
                Android.Provider.Settings.Global.AnimatorDurationScale, 1f)
            : 1f;
        return scale > 0f;
#else
        return true;
#endif
    }
}
