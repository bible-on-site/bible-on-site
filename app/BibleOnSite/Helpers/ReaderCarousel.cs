using BibleOnSite.Controls;
#if ANDROID
using BibleOnSite.Behaviors;
#endif

namespace BibleOnSite.Helpers;

/// <summary>
/// The named controls a reader page hands to <see cref="ReaderCarousel"/>.
/// Every reader hosts the same CarouselView + loading overlay + fan, so the
/// surfaces are identical — only the division plugs in
/// <see cref="ReaderCarouselActions"/> differ.
/// </summary>
public sealed class ReaderCarouselSurfaces
{
    /// <summary>The reader's unit carousel (perek / parasha / masora).</summary>
    public required CarouselView Carousel { get; init; }

    /// <summary>The load/error overlay — swipe tracking stays off while it shows.</summary>
    public required VisualElement LoadingOverlay { get; init; }

    /// <summary>The navigation fan — its open state suppresses swipes.</summary>
    public required ReaderFanMenu FanMenu { get; init; }

    /// <summary>
    /// Surfaces a swipe must never start on (bottom bar, perushim sheet,
    /// exit-fullscreen button) — a touch down there belongs to the overlay.
    /// </summary>
    public required IReadOnlyList<VisualElement> SwipeExcluded { get; init; }

    /// <summary>
    /// Extra surfaces excluded while arming a long-press (the fan toggle and
    /// the selection bar on readers that have one). Consulted only when the
    /// division supplies <see cref="ReaderCarouselActions.ArmUnreceivedPress"/>.
    /// </summary>
    public IReadOnlyList<VisualElement> PressExcluded { get; init; } = [];
}

/// <summary>
/// The division-specific plugs <see cref="ReaderCarousel"/> needs: logical
/// position/count, the load flag and which extras suppress swipe tracking.
/// The plumbing they feed is shared; the policy is not.
/// </summary>
public sealed class ReaderCarouselActions
{
    /// <summary>The logical carousel position — the resnap target.</summary>
    public required Func<int> CurrentPosition { get; init; }

    /// <summary>The carousel's item count — the swipe-settle clamp.</summary>
    public required Func<int> ItemCount { get; init; }

    /// <summary>
    /// A load is in flight — a resize during it defers the resnap to
    /// <see cref="ReaderCarousel.ConsumePendingResnap"/>.
    /// </summary>
    public required Func<bool> IsLoading { get; init; }

    /// <summary>
    /// Division extras that suppress swipe tracking — the articles view, a
    /// focused pasuk or an open chapter search where they exist. Masora has
    /// no such extras; a null plug still leaves the overlay/fan checks live.
    /// </summary>
    public Func<bool>? IsSwipeSuppressed { get; init; }

    /// <summary>
    /// Arms the row long-press on a raw touch-down (the
    /// <c>LongPressBehavior.BeginUnreceivedPress</c> call each division's
    /// pasuk rows need). Null on masora, whose rows carry no press arming —
    /// the dispatched event then stays unsubscribed entirely.
    /// </summary>
    public Action<float, float>? ArmUnreceivedPress { get; init; }
}

/// <summary>
/// Owns the carousel interaction plumbing shared by the perek, parasha and
/// masora readers (#2573):
///
/// - The programmatic-scroll guard (<see cref="IsInitializing"/>) that keeps
///   spurious <c>CurrentItemChanged</c> events and touch tracking quiet while
///   the reader repositions the carousel itself.
/// - The rotation/resize resnap: a measured width change invalidates the
///   native item sizing and re-snaps to the logical position, and a resize
///   mid-load is replayed once the load finishes. Masora carried neither the
///   resnap nor the deferred replay before this consolidation.
/// - Android swipe settling (#2469): a native-cancelled or interrupted swipe
///   could strand the carousel mid-offset, so raw touch events feed
///   <see cref="SwipeNavigationTracker"/> and the release snaps the result.
///   Masora's carousel had the same vulnerability and no settle — attaching
///   the same tracker closes that parity gap.
///
/// Pages keep the policy (unit types, articles/search/selection extras);
/// this coordinator owns the mechanics.
/// </summary>
public sealed class ReaderCarousel
{
    private const double ResnapEpsilon = 0.5;

    private readonly ReaderCarouselSurfaces _ui;
    private readonly ReaderCarouselActions _actions;
    private double _carouselWidth;
    private bool _pendingResnap;

    // Guard: ignore CurrentItemChanged events fired by the CarouselView while
    // the reader itself assigns collections or scrolls — the ViewModel already
    // holds the unit it navigated to. Settable because an initial load holds
    // the guard across an await boundary.
    public bool IsInitializing { get; set; }

    public ReaderCarousel(ReaderCarouselSurfaces surfaces, ReaderCarouselActions actions)
    {
        _ui = surfaces;
        _actions = actions;
        _ui.Carousel.SizeChanged += OnCarouselSizeChanged;
    }

    /// <summary>
    /// Jumps the carousel to a programmatically requested index — instantly, so
    /// a navigation never animates through every intermediate position (which
    /// would cascade CurrentItemChanged). The guard holds across the native
    /// scroll so its echo events stay ignored. The two-way Position binding is
    /// deliberately not poked: it would queue a second, animated scroll that
    /// can overshoot the target.
    /// </summary>
    public void ScrollToUnit(int index)
    {
        IsInitializing = true;
        try
        {
            _ui.Carousel.ScrollTo(index, animate: false);
        }
        finally
        {
            IsInitializing = false;
        }
    }

    /// <summary>
    /// Plays the resnap a mid-load resize queued. Call once the loading path
    /// finishes — the page's <c>finally</c> on its initial load.
    /// </summary>
    public void ConsumePendingResnap()
    {
        if (_pendingResnap)
        {
            _pendingResnap = false;
            _ui.Carousel.Dispatcher.Dispatch(ResnapCarousel);
        }
    }

    /// <summary>
    /// Re-snaps the CarouselView when its measured width changes (rotation,
    /// fold, window resize). The native carousel keeps the pre-rotation item
    /// size, so several items stay visible side by side until the user swipes;
    /// invalidating the native layout and re-snapping to the current position
    /// restores a single full-width item immediately.
    /// </summary>
    // Internal rather than private: the handler body is a thin delegate but
    // coverage still counts it — tests drive it like NoteCarouselWidth.
    internal void OnCarouselSizeChanged(object? sender, EventArgs e) =>
        NoteCarouselWidth(_ui.Carousel.Width);

    // Width bookkeeping is split from the event so tests can feed a measured
    // value — Element.Width stays -1 on a headless element.
    internal void NoteCarouselWidth(double width)
    {
        if (width <= 0)
        {
            return;
        }
        if (Math.Abs(width - _carouselWidth) < ResnapEpsilon)
        {
            return;
        }
        var isFirstMeasure = _carouselWidth <= 0;
        _carouselWidth = width;
        if (isFirstMeasure || IsInitializing)
        {
            return;
        }
        if (_actions.IsLoading())
        {
            // Rotation during the initial load: retry the re-snap once the
            // load completes instead of leaving stale item widths behind.
            _pendingResnap = true;
            return;
        }

        _ui.Carousel.Dispatcher.Dispatch(ResnapCarousel);
    }

    /// <summary>
    /// Windows: a carousel whose platform tree materialized during a Shell
    /// push can keep its ItemsStackPanel realizing items at a stale offset —
    /// Position already reads correctly, so a managed ScrollTo is a no-op and
    /// the visible slot stays blank. A native ScrollIntoView re-anchors the
    /// panel on the current item once the platform tree settles (#3265).
    /// </summary>
    public void ResnapAfterLoad()
    {
#if WINDOWS
        _ui.Carousel.Dispatcher.DispatchDelayed(TimeSpan.FromMilliseconds(600), () =>
        {
            if (_ui.Carousel.Handler?.PlatformView is Microsoft.UI.Xaml.Controls.ListViewBase list
                && _ui.Carousel.CurrentItem is { } item)
            {
                list.ScrollIntoView(item, Microsoft.UI.Xaml.Controls.ScrollIntoViewAlignment.Leading);
            }
        });
#endif
    }

    /// <summary>
    /// Re-snaps the carousel to the current position after its width changed,
    /// restoring a single full-width item.
    /// </summary>
    private void ResnapCarousel()
    {
#if IOS
        var collectionView = _ui.Carousel.Handler?.PlatformView switch
        {
            UIKit.UICollectionView cv => cv,
            UIKit.UIView view => FindDescendantCollectionView(view),
            _ => null,
        };
        collectionView?.CollectionViewLayout.InvalidateLayout();
#elif ANDROID
        if (_ui.Carousel.Handler?.PlatformView is AndroidX.RecyclerView.Widget.RecyclerView recyclerView)
        {
            recyclerView.Post(recyclerView.RequestLayout);
        }
#endif
        _ui.Carousel.InvalidateMeasure();
        IsInitializing = true;
        try
        {
            _ui.Carousel.ScrollTo(_actions.CurrentPosition(), animate: false);
        }
        finally
        {
            IsInitializing = false;
        }
    }

#if IOS || MACCATALYST
    private static UIKit.UICollectionView? FindDescendantCollectionView(UIKit.UIView view)
    {
        foreach (var subview in view.Subviews)
        {
            if (subview is UIKit.UICollectionView collectionView)
            {
                return collectionView;
            }
            var found = FindDescendantCollectionView(subview);
            if (found != null)
            {
                return found;
            }
        }
        return null;
    }
#endif

    /// <summary>
    /// The index of <paramref name="unitId"/> inside the carousel collection,
    /// or -1 when missing — the same scan every unit-divided reader ran inline.
    /// </summary>
    public static int IndexOf<T>(IReadOnlyList<T> items, Func<T, int> idOf, int unitId)
    {
        for (var i = 0; i < items.Count; i++)
        {
            if (idOf(items[i]) == unitId)
            {
                return i;
            }
        }
        return -1;
    }

#if ANDROID
    private readonly SwipeNavigationTracker _swipe = new();
#endif

    /// <summary>
    /// The reader's appearing slot — attaches the raw-touch swipe settle on
    /// Android. Call once from the page's OnAppearing; a no-op elsewhere.
    /// </summary>
    public void Appearing()
    {
#if ANDROID
        MainActivity.TouchStarted += OnTouchStarted;
        if (_actions.ArmUnreceivedPress != null)
        {
            MainActivity.SubscribeTouchDispatched(OnTouchDispatched);
        }
        MainActivity.TouchMoved += OnTouchMoved;
        MainActivity.TouchReleased += OnTouchReleased;
#endif
    }

    /// <summary>
    /// The reader's disappearing slot — releases the raw-touch plumbing and
    /// cancels any swipe/long-press left pending. Call once from the page's
    /// OnDisappearing; a no-op elsewhere.
    /// </summary>
    public void Disappearing()
    {
#if ANDROID
        MainActivity.TouchStarted -= OnTouchStarted;
        if (_actions.ArmUnreceivedPress != null)
        {
            MainActivity.UnsubscribeTouchDispatched(OnTouchDispatched);
        }
        MainActivity.TouchMoved -= OnTouchMoved;
        MainActivity.TouchReleased -= OnTouchReleased;
        _swipe.Cancel();
        LongPressBehavior.CancelAllPending();
#endif
    }

#if ANDROID
    private bool SwipeBlocked =>
        IsInitializing || _ui.LoadingOverlay.IsVisible || _ui.FanMenu.IsOpen ||
        (_actions.IsSwipeSuppressed?.Invoke() ?? false);

    private void OnTouchStarted(object? sender, TouchPosition position)
    {
        _swipe.Cancel();
        if (SwipeBlocked || !ContainsTouch(_ui.Carousel, position) || Excluded(_ui.SwipeExcluded, position))
        {
            return;
        }
        _swipe.Begin(position, _ui.Carousel.Position);
    }

    private void OnTouchDispatched(object? sender, TouchPosition position)
    {
        if (SwipeBlocked || !ContainsTouch(_ui.Carousel, position) ||
            Excluded(_ui.SwipeExcluded, position) || Excluded(_ui.PressExcluded, position))
        {
            return;
        }

        _actions.ArmUnreceivedPress?.Invoke(position.X, position.Y);
    }

    private static bool Excluded(IReadOnlyList<VisualElement> surfaces, TouchPosition position) =>
        surfaces.Any(surface => ContainsTouch(surface, position));

    private static bool ContainsTouch(VisualElement element, TouchPosition position)
    {
        if (!element.IsVisible || element.Handler?.PlatformView is not Android.Views.View view)
        {
            return false;
        }

        if (!view.IsShown)
        {
            return false;
        }

        var location = new int[2];
        view.GetLocationOnScreen(location);
        return position.X >= location[0] && position.X < location[0] + view.Width &&
            position.Y >= location[1] && position.Y < location[1] + view.Height;
    }

    private void OnTouchMoved(object? sender, TouchPosition position)
    {
        var slop = _ui.Carousel.Handler?.PlatformView is Android.Views.View view
            ? Android.Views.ViewConfiguration.Get(view.Context!)?.ScaledTouchSlop ?? 12
            : 12;
        _swipe.Move(position, slop);
    }

    // Releases and native cancels/interruptions both arrive here: a cancel
    // mid-swipe can strand the carousel mid-offset just like a release, so
    // it settles the same way (#2469).
    private void OnTouchReleased(object? sender, TouchPosition position) =>
        SettleSwipe(_swipe.Last ?? position);

    private void SettleSwipe(TouchPosition position)
    {
        if (_ui.Carousel.Handler?.PlatformView is not Android.Views.View view)
        {
            return;
        }

        var configuration = Android.Views.ViewConfiguration.Get(view.Context!);
        var target = _swipe.End(position, view.Width, configuration?.ScaledTouchSlop ?? 12,
            configuration?.ScaledMinimumFlingVelocity ?? 50,
            view.LayoutDirection == Android.Views.LayoutDirection.Rtl, _actions.ItemCount());
        if (target is int index)
        {
            // Run after native dispatch, so an intercepted Up/Cancel cannot stop
            // the final snap. ScrollTo also resets MAUI's current snap target.
            _ui.Carousel.ScrollTo(index, position: ScrollToPosition.Center, animate: true);
        }
    }
#endif
}
