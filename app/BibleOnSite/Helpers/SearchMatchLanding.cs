using BibleOnSite.Controls;
using BibleOnSite.Models;

namespace BibleOnSite.Helpers;

/// <summary>
/// Platform-measured search-match landing primitives shared by the על הפרק
/// and פרשה על הפרק readers: a perush hit scrolls its note's match line just
/// below the toolbar (with its perush-name header kept in view), while a
/// pasuk hit pins its row at the top. Every method re-verifies against the
/// native list because a recycled or re-laid-out cell can silently undo an
/// earlier scroll (#2078, #2205).
/// </summary>
public static class SearchMatchLanding
{
    /// <summary>
    /// Target gap between the pasuk list's top edge and the landed match line.
    /// Large enough to keep the pasuk text and the perush-name header visible
    /// when the match sits near the note's start; deeper matches still land
    /// just below the toolbar. Tighter values let an early scroll push the
    /// name header offscreen before the visibility check settles (#2205).
    /// </summary>
    public static int MatchTopMargin { get; } = 96;

    /// <summary>
    /// Scrolls the pasuk row to the top of the list until the platform reports
    /// it actually arrived there. Returns the verification verdict: true only
    /// once the row is confirmed anchored (or, on platforms without a native
    /// position check, after enough scrolls were issued to trust the jump).
    /// </summary>
    public static (bool Landed, int PasukScrolls) LandOnPasukRow(CollectionView list, object item, int pasukScrolls)
    {
        // Scroll to the display item, not the logical Pasuk: the list's
        // ItemsSource holds display rows (שניים מקרא can duplicate
        // each pasuk), so a Pasuk target matched no row and the jump silently
        // failed.
        var anchored = IsItemAnchoredAtTop(list, item);
        pasukScrolls = AnchorPasukRow(list, item, pasukScrolls, anchored);
        // Platforms without a native position check accept the jump after a
        // few scroll issues instead of confirming the offset.
        return (anchored ?? pasukScrolls >= 4, pasukScrolls);
    }

    public static int AnchorPasukRow(CollectionView list, object item, int pasukScrolls) =>
        AnchorPasukRow(list, item, pasukScrolls, null);

    public static int AnchorPasukRow(CollectionView list, object item, int pasukScrolls, bool? anchored)
    {
        if (anchored != true && pasukScrolls < 60)
        {
            list.ScrollTo(item, position: ScrollToPosition.Start, animate: false);
            pasukScrolls++;
        }
        return pasukScrolls;
    }

    /// <summary>Verdict of a perush match-scroll frame.</summary>
    public enum PerushLanding
    {
        /// <summary>The note row is not realized yet — keep anchoring the pasuk row.</summary>
        NotReady,
        /// <summary>A match scroll is in play but the line is not verified visible yet.</summary>
        Engaged,
        /// <summary>The match line sits inside the viewport (or is trusted to).</summary>
        Landed,
    }

    /// <summary>
    /// Finds the realized <see cref="HtmlView"/> bound to the matched note
    /// display, sets its normalized match span, and scrolls the pasuk list so
    /// the match lands just below the toolbar — re-issuing the scroll on every
    /// call until the match line verifies inside the viewport, because a
    /// recycled/re-laid-out cell can silently undo an earlier scroll.
    /// </summary>
    public static PerushLanding TryLandOnPerushMatch(CollectionView list, PerushNoteDisplay display, SearchMatchSpan span)
    {
        var htmlView = list.GetVisualTreeDescendants().OfType<HtmlView>()
            .FirstOrDefault(view => ReferenceEquals(view.BindingContext, display));
        if (htmlView == null)
        {
            return PerushLanding.NotReady; // Note views for this pasuk are not realized yet.
        }
        if (!htmlView.HasSearchMatch)
        {
            htmlView.SearchMatchStart = span.Start;
            htmlView.SearchMatchLength = span.Length;
        }
        var visible = MatchVisibilityProbe(list, htmlView);
        // The landing is only complete when the perush-name header shares the
        // viewport with the match — visibility of the match line alone can
        // leave the header scrolled offscreen (#2205).
        var nameLabel = FindPerushNameLabel(list, display);
        var nameVisible = nameLabel == null ? null : ElementVisibilityProbe(list, nameLabel);
        if (visible == true && nameVisible != false)
        {
            return PerushLanding.Landed;
        }
        // The match is in view but its perush-name header is offscreen. When
        // both can share the viewport, scroll the header in and re-verify.
        // When they cannot (a very long pasuk), the match-only landing is the
        // final state — re-pinning the match every frame would never settle.
        // A null fit means the label's platform view is still attaching — stay
        // engaged one more frame instead of accepting a headerless landing.
        if (visible == true && nameVisible == false)
        {
            var fits = NameFitProbe(list, htmlView, nameLabel!);
            if (fits == true)
            {
                NameScroller(list, nameLabel!);
            }
            // Fit the header in and re-verify next frame; an unmeasurable fit
            // (platform view still attaching) also stays engaged. Only a
            // proven non-fit accepts the match-only landing.
            return fits == false ? PerushLanding.Landed : PerushLanding.Engaged;
        }
        if (!ListScroller(list, htmlView))
        {
            // The scroll primitives are not ready (no layout yet). When the
            // platform cannot verify visibility we still report Engaged so
            // the pasuk-row anchoring does not fight the pending scroll.
            return visible == null ? PerushLanding.Engaged : PerushLanding.NotReady;
        }
        // Verified platforms re-check visibility next frame; unverifiable
        // platforms trust the issued scroll.
        return visible == null ? PerushLanding.Landed : PerushLanding.Engaged;
    }

    // Platform measurement and scroll seams. Off-device builds always measure
    // null, so tests substitute these to drive the verified-visibility verdict
    // paths; production keeps the platform implementations.
    internal static Func<CollectionView, HtmlView, bool?> MatchVisibilityProbe { get; set; } = IsMatchLineVisible;
    internal static Func<CollectionView, VisualElement, bool?> ElementVisibilityProbe { get; set; } = IsElementVisible;
    internal static Func<CollectionView, HtmlView, Label, bool?> NameFitProbe { get; set; } = NameAndMatchFit;
    internal static Func<CollectionView, Label, bool> NameScroller { get; set; } = ScrollNameToMargin;
    internal static Func<CollectionView, HtmlView, bool> ListScroller { get; set; } = ScrollListToMatch;

    /// <summary>
    /// Finds the <see cref="Label"/> carrying the perush name bound to the same
    /// note display as the matched <see cref="HtmlView"/> — both realize
    /// together inside one cell of the notes template.
    /// </summary>
    private static Label? FindPerushNameLabel(CollectionView list, PerushNoteDisplay display)
    {
        return list.GetVisualTreeDescendants().OfType<Label>()
            .FirstOrDefault(label =>
                label.AutomationId == "InlinePerushName" &&
                ReferenceEquals(label.BindingContext, display));
    }

    /// <summary>
    /// True when the element's center is inside the list viewport; false when
    /// it is not; null when the platform cannot measure it. Center-based to
    /// match what e2e visibility checks accept.
    /// </summary>
    private static bool? IsElementVisible(CollectionView list, VisualElement element)
    {
#if ANDROID
        if (element.Handler?.PlatformView is not Android.Views.View view ||
            list.Handler?.PlatformView is not AndroidX.RecyclerView.Widget.RecyclerView recycler)
        {
            return false;
        }
        var viewPos = new int[2];
        var listPos = new int[2];
        view.GetLocationOnScreen(viewPos);
        recycler.GetLocationOnScreen(listPos);
        var centerY = viewPos[1] + view.Height / 2;
        return centerY >= listPos[1] && centerY <= listPos[1] + recycler.Height;
#elif IOS || MACCATALYST
        if (element.Handler?.PlatformView is not UIKit.UIView view ||
            GetNativeReaderCollection(list) is not { } collection)
        {
            return false;
        }
        var point = view.ConvertPointToView(
            new CoreGraphics.CGPoint(0, view.Bounds.Height / 2), collection);
        var top = collection.ContentOffset.Y;
        var bottom = top + collection.Bounds.Height - collection.AdjustedContentInset.Top;
        return point.Y >= top && point.Y <= bottom;
#else
        _ = list; // No measurement without the platform views.
        _ = element;
        return null;
#endif
    }

    /// <summary>
    /// Whether the perush-name header and the match line can share the viewport
    /// once the header lands <see cref="MatchTopMargin"/> below the list top;
    /// null when either side cannot be measured on this platform.
    /// </summary>
    private static bool? NameAndMatchFit(CollectionView list, HtmlView htmlView, Label nameLabel)
    {
#if ANDROID
        if (htmlView.GetSearchMatchTop() is not { } matchTop ||
            htmlView.Handler?.PlatformView is not Android.Views.View noteView ||
            nameLabel.Handler?.PlatformView is not Android.Views.View labelView ||
            list.Handler?.PlatformView is not AndroidX.RecyclerView.Widget.RecyclerView recycler)
        {
            return null;
        }
        var notePos = new int[2];
        var labelPos = new int[2];
        noteView.GetLocationOnScreen(notePos);
        labelView.GetLocationOnScreen(labelPos);
        var density = noteView.Resources?.DisplayMetrics?.Density ?? 1f;
        var gap = notePos[1] + matchTop * density - labelPos[1];
        return gap <= recycler.Height - MatchTopMargin * density;
#elif IOS || MACCATALYST
        if (htmlView.GetSearchMatchTop() is not { } matchTop ||
            htmlView.Handler?.PlatformView is not UIKit.UIView noteView ||
            nameLabel.Handler?.PlatformView is not UIKit.UIView labelView ||
            GetNativeReaderCollection(list) is not { } collection)
        {
            return null;
        }
        var matchY = noteView.ConvertPointToView(new CoreGraphics.CGPoint(0, matchTop), collection).Y;
        var nameY = labelView.ConvertPointToView(new CoreGraphics.CGPoint(0, 0), collection).Y;
        return matchY - nameY <=
            collection.Bounds.Height - collection.AdjustedContentInset.Top - MatchTopMargin;
#else
        _ = list;
        _ = htmlView;
        _ = nameLabel;
        return null;
#endif
    }

    /// <summary>
    /// Scrolls the list so the perush-name header lands
    /// <see cref="MatchTopMargin"/> below the list top, exposing the header
    /// while keeping the match inside the viewport.
    /// </summary>
    private static bool ScrollNameToMargin(CollectionView list, Label nameLabel)
    {
#if ANDROID
        if (nameLabel.Handler?.PlatformView is not Android.Views.View labelView ||
            list.Handler?.PlatformView is not AndroidX.RecyclerView.Widget.RecyclerView recycler)
        {
            return false;
        }
        var labelPos = new int[2];
        var listPos = new int[2];
        labelView.GetLocationOnScreen(labelPos);
        recycler.GetLocationOnScreen(listPos);
        var density = labelView.Resources?.DisplayMetrics?.Density ?? 1f;
        recycler.ScrollBy(0, (int)(labelPos[1] - listPos[1] - MatchTopMargin * density));
        return true;
#elif IOS || MACCATALYST
        if (nameLabel.Handler?.PlatformView is not UIKit.UIView labelView ||
            GetNativeReaderCollection(list) is not { } collection)
        {
            return false;
        }
        var point = labelView.ConvertPointToView(new CoreGraphics.CGPoint(0, 0), collection);
        var target = point.Y - MatchTopMargin;
        var min = -collection.AdjustedContentInset.Top;
        var max = Math.Max(min, collection.ContentSize.Height - collection.Bounds.Height + collection.AdjustedContentInset.Bottom);
        collection.SetContentOffset(
            new CoreGraphics.CGPoint(collection.ContentOffset.X, Math.Clamp(target, min, max)), false);
        return true;
#else
        _ = list;
        _ = nameLabel;
        return true;
#endif
    }

    /// <summary>
    /// True when the row bound to <paramref name="item"/> is the first visible
    /// row of the list; false when it is not; null when the platform has no
    /// native position check and the verdict cannot be verified.
    /// </summary>
    private static bool? IsItemAnchoredAtTop(CollectionView list, object item)
    {
#if ANDROID
        if (list.Handler?.PlatformView is AndroidX.RecyclerView.Widget.RecyclerView recycler &&
            recycler.GetLayoutManager() is AndroidX.RecyclerView.Widget.LinearLayoutManager layout)
        {
            var index = IndexOfItem(list, item);
            return index >= 0 && layout.FindFirstVisibleItemPosition() == index;
        }
        return false;
#elif IOS || MACCATALYST
        if (GetNativeReaderCollection(list) is { } collection)
        {
            var index = IndexOfItem(list, item);
            var paths = collection.IndexPathsForVisibleItems;
            return index >= 0 && paths is { Length: > 0 } && paths.Min(path => (int)path.Item) == index;
        }
        return false;
#else
        _ = list; // No native position check on this platform.
        _ = item;
        return null;
#endif
    }

    /// <summary>
    /// True when the match line of the note view is inside the list viewport;
    /// false when it is not; null when the platform cannot measure it.
    /// </summary>
    private static bool? IsMatchLineVisible(CollectionView list, HtmlView htmlView)
    {
#if ANDROID
        if (htmlView.GetSearchMatchTop() is not { } matchTop ||
            htmlView.Handler?.PlatformView is not Android.Views.View noteView ||
            list.Handler?.PlatformView is not AndroidX.RecyclerView.Widget.RecyclerView recycler)
        {
            return false;
        }
        var viewPos = new int[2];
        var listPos = new int[2];
        noteView.GetLocationOnScreen(viewPos);
        recycler.GetLocationOnScreen(listPos);
        var density = noteView.Resources?.DisplayMetrics?.Density ?? 1f;
        var matchY = viewPos[1] + matchTop * density;
        return matchY >= listPos[1] && matchY <= listPos[1] + recycler.Height - density;
#elif IOS || MACCATALYST
        if (htmlView.GetSearchMatchTop() is not { } matchTop ||
            htmlView.Handler?.PlatformView is not UIKit.UIView noteView ||
            GetNativeReaderCollection(list) is not { } collection)
        {
            return false;
        }
        var point = noteView.ConvertPointToView(new CoreGraphics.CGPoint(0, matchTop), collection);
        var top = collection.ContentOffset.Y;
        var bottom = top + collection.Bounds.Height - collection.AdjustedContentInset.Top;
        return point.Y >= top && point.Y <= bottom;
#else
        _ = list; // No measurement without the platform views.
        _ = htmlView;
        return null;
#endif
    }

#if IOS || MACCATALYST
    // Optimized MAUI handlers expose the controller's UIView. Accept both a
    // collection root and a collection nested inside that native view.
    public static UIKit.UICollectionView? GetNativeReaderCollection(CollectionView? list) =>
        list?.Handler?.PlatformView switch
        {
            UIKit.UICollectionView collection => collection,
            UIKit.UIView view => FindDescendantCollectionView(view),
            _ => null
        };

    private static UIKit.UICollectionView? FindDescendantCollectionView(UIKit.UIView view)
    {
        foreach (var child in view.Subviews)
        {
            if (child is UIKit.UICollectionView collection)
            {
                return collection;
            }
            if (FindDescendantCollectionView(child) is { } nested)
            {
                return nested;
            }
        }
        return null;
    }
#endif

    public static int IndexOfItem(CollectionView list, object item)
    {
        var index = 0;
        foreach (var entry in list.ItemsSource?.Cast<object>() ?? [])
        {
            if (ReferenceEquals(entry, item))
            {
                return index;
            }
            index++;
        }
        return -1;
    }

    private static bool ScrollListToMatch(CollectionView list, HtmlView htmlView)
    {
#if ANDROID
        if (htmlView.GetSearchMatchTop() is not { } matchTop ||
            htmlView.Handler?.PlatformView is not Android.Views.View noteView ||
            list.Handler?.PlatformView is not AndroidX.RecyclerView.Widget.RecyclerView recycler)
        {
            return false;
        }
        var viewPos = new int[2];
        var listPos = new int[2];
        noteView.GetLocationOnScreen(viewPos);
        recycler.GetLocationOnScreen(listPos);
        var density = noteView.Resources?.DisplayMetrics?.Density ?? 1f;
        recycler.ScrollBy(0, (int)(viewPos[1] + matchTop * density - listPos[1] - MatchTopMargin * density));
        return true;
#elif IOS || MACCATALYST
        if (htmlView.GetSearchMatchTop() is not { } matchTop ||
            htmlView.Handler?.PlatformView is not UIKit.UIView noteView ||
            GetNativeReaderCollection(list) is not { } collection)
        {
            return false;
        }
        // Scroll-view coordinates are content space, so the converted point is
        // already a content offset.
        var point = noteView.ConvertPointToView(new CoreGraphics.CGPoint(0, matchTop), collection);
        var target = point.Y - MatchTopMargin;
        var min = -collection.AdjustedContentInset.Top;
        var max = Math.Max(min, collection.ContentSize.Height - collection.Bounds.Height + collection.AdjustedContentInset.Bottom);
        collection.SetContentOffset(
            new CoreGraphics.CGPoint(collection.ContentOffset.X, Math.Clamp(target, min, max)), false);
        return true;
#else
        // No per-line measurement on this platform: the pasuk-row scroll is the landing.
        _ = list;
        _ = htmlView;
        return true;
#endif
    }
}
