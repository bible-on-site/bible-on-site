using BibleOnSite.Controls;
using System.ComponentModel;
#if ANDROID
using AndroidX.Activity;
#endif

namespace BibleOnSite.Helpers;

/// <summary>
/// The reader's toolbar search surface — the contract
/// <see cref="Controls.FloatingSearchBar"/> already satisfies. Abstracted so
/// the platform chrome is unit-testable without inflating XAML controls.
/// </summary>
public interface IReaderSearchSurface
{
    /// <summary>Raised whenever the search surface opens or closes.</summary>
    event EventHandler? SearchOpenChanged;
}

/// <summary>
/// The named controls a reader page hands to <see cref="ReaderPlatformChrome"/>.
/// Every reader declares the same chrome in XAML, so the surfaces are
/// identical — only the division plugs in <see cref="ReaderPlatformChromeActions"/>
/// differ.
/// </summary>
public sealed class ReaderPlatformChromeSurfaces
{
    /// <summary>The reader page itself (padding, resources, size notifications).</summary>
    public required ContentPage Page { get; init; }

    /// <summary>The page root layout — the iOS safe-area target.</summary>
    public required Layout Root { get; init; }

    /// <summary>The navigation capsule whose Back mirrors transient surfaces.</summary>
    public required SharedTopBar NavigationBar { get; init; }

    /// <summary>The bottom bar shifted over the iOS home-indicator inset.</summary>
    public required Layout BottomBar { get; init; }

    /// <summary>The fan that floats above the iOS gesture-bar inset.</summary>
    public required ReaderFanMenu FanMenu { get; init; }

    /// <summary>The reading carousel — the iOS pan-vs-edge-back priority target.</summary>
    public required VisualElement Carousel { get; init; }

    /// <summary>
    /// Transient overlays whose <see cref="VisualElement.IsVisible"/> flips
    /// re-evaluate the capsule Back and the Android Back callback — the menu
    /// panel and the exit-fullscreen button on readers that have both, the
    /// exit button alone on masora.
    /// </summary>
    public required IReadOnlyList<VisualElement> BackSensitiveOverlays { get; init; }

    /// <summary>
    /// The chapter-search surface, when the division has one (perek/parasha).
    /// Its open/close only re-evaluates the Android callback — the capsule
    /// refresh intentionally keeps its narrower trigger set.
    /// </summary>
    public IReaderSearchSurface? SearchSurface { get; init; }

    /// <summary>
    /// The pasuk-selection bar, when the division has one — same Android-only
    /// trigger role as <see cref="SearchSurface"/>.
    /// </summary>
    public VisualElement? SelectionSurface { get; init; }

    /// <summary>
    /// The perushim sheet. Its open state travels on <c>IsOpenChanged</c>
    /// rather than an <see cref="VisualElement.IsVisible"/> flip, so it cannot
    /// ride <see cref="BackSensitiveOverlays"/> — open/close refreshes the
    /// capsule Back and the Android callback the same way (#2766).
    /// </summary>
    public required IReaderPerushimSheetSurface PerushimSheet { get; init; }
}

/// <summary>
/// The division-specific plugs <see cref="ReaderPlatformChrome"/> needs: which
/// surfaces keep Back alive and what Back does. The plumbing they feed is
/// shared; the policy is not.
/// </summary>
public sealed class ReaderPlatformChromeActions
{
    /// <summary>
    /// Whether a transient reader surface would consume Back — feeds the
    /// capsule's <see cref="SharedTopBar.BackStateProvider"/> on every
    /// platform and the Android callback's enabled state.
    /// </summary>
    public required Func<bool> OwnsReturnSurface { get; init; }

    /// <summary>The page-owned Back pipeline (each division's surface ordering).</summary>
    public required Func<bool> TryHandleBack { get; init; }
}

/// <summary>
/// Owns the reader's platform chrome shared by the perek, parasha and masora
/// readers (#2573) — the plumbing that used to sit in per-page
/// <c>#if IOS</c>/<c>#if ANDROID</c>/<c>#if WINDOWS</c> blocks and the
/// per-platform back partials:
///
/// - iOS: the reader safe-area chain (#1308), the bottom-bar home-indicator
///   inset, and the navigation history gating + pan-recognizer priority that
///   keep the edge-back gesture honest (#2432).
/// - Android: the predictive-Back <c>OnBackPressedCallback</c> registered on
///   appearing, re-evaluated by the same triggers every reader shares.
/// - All platforms: the capsule <see cref="SharedTopBar.BackStateProvider"/>
///   and the overlay/sheet-open refresh that keeps it honest.
///
/// Windows keyboard shortcuts and the focus hand-off are deliberately not
/// here: the window-level <c>DesktopWindowChrome</c> (#2766) serves every
/// page, not just the readers, so a per-page accelerator would double-handle
/// Alt+Left.
///
/// Platform bodies live behind the <c>#if</c> hooks in each lifecycle slot,
/// so this file compiles — and its cross-platform wiring runs — everywhere
/// the helpers compile. What stays per page is the policy: which surfaces
/// consume Back (the division adapters), never the plumbing.
/// </summary>
public sealed class ReaderPlatformChrome
{
    private readonly ReaderPlatformChromeSurfaces _ui;
#if ANDROID
    private readonly ReaderPlatformChromeActions _actions;
    private ReaderBackCallback? _readerBack;
#endif

    public ReaderPlatformChrome(ReaderPlatformChromeSurfaces surfaces, ReaderPlatformChromeActions actions)
    {
        _ui = surfaces;
#if ANDROID
        _actions = actions;
#endif

        // iOS only: clear descendant safe-area padding, keep the root's
        // top/bottom container insets (#1308). Runs in the constructor because
        // the layout tree is already built — same slot the pages used.
        ConfigureSafeArea();

        // The capsule Back owns return affordances now (#2467): at a root
        // destination it stays enabled while a transient surface would
        // consume Back — the same surfaces the Back handlers serve. The
        // hamburger keeps its single job and is never repurposed.
        _ui.NavigationBar.BackStateProvider = actions.OwnsReturnSurface;

        // Overlay visibility flips outside the pages' selection refresh (item
        // taps and the scrim close the menu without it), so paint changes ride
        // the same IsVisible notifications the native Back callback uses.
        foreach (var overlay in _ui.BackSensitiveOverlays)
        {
            overlay.PropertyChanged += OnBackSensitiveOverlayChanged;
        }

        // Division-specific Android re-eval triggers. RefreshNativeBack is a
        // no-op off Android, so subscribing them unconditionally changes
        // nothing elsewhere — and these subscriptions live for the page's
        // lifetime, which matches the previous register/unregister cycle
        // (the callback the refresh feeds is null while unregistered anyway).
        if (_ui.SearchSurface is { } search)
        {
            search.SearchOpenChanged += (_, _) => RefreshNativeBack();
        }
        if (_ui.SelectionSurface is { } selection)
        {
            selection.PropertyChanged += OnSelectionSurfaceChanged;
        }

        // The perushim sheet reports open/close on its own event rather than
        // an IsVisible flip — feed it the same capsule + native refresh an
        // overlay gets so a swipe-opened sheet still owns Back (#2766).
        _ui.PerushimSheet.IsOpenChanged += (_, _) =>
        {
            _ui.NavigationBar.RefreshBackState();
            RefreshNativeBack();
        };
    }

    /// <summary>
    /// The reader's appearing slot — registers the native Back plumbing
    /// (Android callback) and applies the iOS reader history + home-indicator
    /// inset. Call once from the page's OnAppearing.
    /// </summary>
    public void Appearing()
    {
#if ANDROID
        RegisterReaderBack();
#elif IOS
        // Native history must be ready before asynchronous reader positioning.
        ConfigureReaderHistory();
        ApplyBottomBarInset();
        _ui.Page.SizeChanged -= OnPageSizeChanged;
        _ui.Page.SizeChanged += OnPageSizeChanged;
#else
        // No native chrome to register on headless targets.
#endif
    }

    /// <summary>
    /// The reader's disappearing slot — unregisters the native Back plumbing
    /// and restores the iOS edge-back for pages pushed above (#2432). Call
    /// once from the page's OnDisappearing.
    /// </summary>
    public void Disappearing()
    {
#if ANDROID
        UnregisterReaderBack();
#elif IOS
        // A page pushed above gets its native edge-back back (#2432): re-enable
        // the recognizer ConfigureReaderHistory switches off at the navigation
        // root.
        if (_ui.Page.Handler is IPlatformViewHandler pageHandler &&
            pageHandler.ViewController?.NavigationController?.InteractivePopGestureRecognizer is { } back)
        {
            back.Enabled = true;
        }
#else
        // No native chrome to release on headless targets.
#endif
    }

    /// <summary>
    /// A reading surface realized its list — iOS re-asserts the pan-recognizer
    /// priority so newly created scroll views yield the edge gesture to
    /// history. Call from each reader list's Loaded event; a no-op elsewhere.
    /// </summary>
    public void ReaderSurfaceRealized()
    {
#if IOS
        ConfigureReaderHistory();
#else
        // Only iOS re-asserts the edge-gesture priority on realized lists.
#endif
    }

    /// <summary>
    /// Re-evaluates the iOS history gating once appearing-time layout settles —
    /// the deferred half of <see cref="Appearing"/> the pages used to dispatch
    /// at the end of OnAppearing. A no-op elsewhere.
    /// </summary>
    public void ScheduleHistoryRefresh()
    {
#if IOS
        _ui.Page.Dispatcher.Dispatch(ConfigureReaderHistory);
#else
        // Only iOS defers the interactive-history check past layout.
#endif
    }

    /// <summary>
    /// Re-evaluates the Android predictive-Back callback's enabled state from
    /// <see cref="ReaderPlatformChromeActions.OwnsReturnSurface"/>. A no-op
    /// on every other platform, so pages and triggers call it unconditionally.
    /// </summary>
    public void RefreshNativeBack()
    {
#if ANDROID
        UpdateReaderBack();
#else
        // Only Android re-evaluates a predictive-Back callback.
#endif
    }

    /// <summary>
    /// An overlay's paint changed — refresh the capsule Back on every platform
    /// (it drives the enabled state) and the Android callback alongside it.
    /// </summary>
    private void OnBackSensitiveOverlayChanged(object? sender, PropertyChangedEventArgs e)
    {
        if (e.PropertyName == nameof(VisualElement.IsVisible))
        {
            _ui.NavigationBar.RefreshBackState();
            RefreshNativeBack();
        }
    }

    private void OnSelectionSurfaceChanged(object? sender, PropertyChangedEventArgs e)
    {
        if (e.PropertyName == nameof(VisualElement.IsVisible))
        {
            RefreshNativeBack();
        }
    }

    /// <summary>
    /// MAUI pads every Layout inside the device safe area by default
    /// (SafeAreaEdges = Container), and each Layout pads independently —
    /// clearing it only on the root just moves the padding to the content
    /// area, which is what produced the empty landscape side bands (#1308).
    /// </summary>
    private void ConfigureSafeArea()
    {
#if IOS
        ReaderSafeArea.Configure(_ui.Root);
#else
        // Only iOS pads layouts against the device safe area.
#endif
    }

#if IOS
    private void OnPageSizeChanged(object? sender, EventArgs e) => ApplyBottomBarInset();

    /// <summary>
    /// Shifts the bottom chrome over the home-indicator inset and pulls the
    /// page up underneath so no gap shows — the shared geometry lives in
    /// <see cref="ReaderSafeArea.ApplyBottomBarInset"/>; only the key-window
    /// inset read stays here.
    /// </summary>
    private void ApplyBottomBarInset()
    {
        var bottom = ReaderSafeArea.CurrentBottomInset();
        ReaderSafeArea.ApplyBottomBarInset(
            _ui.Page, _ui.BottomBar, _ui.FanMenu, bottom, ReaderBottomBar.TotalHeight);
    }

    /// <summary>
    /// Gates the interactive-pop recognizer on real history and gives it
    /// priority over the reader's scroll pans. An enabled recognizer keeps
    /// claiming the right edge even at the navigation root where nothing can
    /// pop — system edge recognizers get edge touches before ordinary ones,
    /// so it wins the race against the RTL flyout's pan and leaves the
    /// drawer gesture dead (#2432). Keep it on only while real history
    /// exists; the disappearing hook restores it for pages pushed above.
    /// </summary>
    private void ConfigureReaderHistory()
    {
        if (_ui.Page.Handler is not IPlatformViewHandler pageHandler ||
            pageHandler.ViewController?.NavigationController is not { } navigation ||
            navigation.InteractivePopGestureRecognizer is not { } back)
        {
            return;
        }
        navigation.View!.SemanticContentAttribute = UIKit.UISemanticContentAttribute.ForceRightToLeft;
        back.Enabled = _ui.Page.Navigation.NavigationStack.Count > 1;
        // Native history owns the edge before the unit carousel or verse list.
        // Keep UIKit's interactive pop and MAUI's navigation delegate intact.
        if (_ui.Carousel.Handler?.PlatformView is UIKit.UIView carousel)
        {
            GiveNativeBackPriority(carousel, back);
        }
        DebugLog.Write($"[ReaderBack] stack={_ui.Page.Navigation.NavigationStack.Count} enabled={back.Enabled} direction={navigation.View.EffectiveUserInterfaceLayoutDirection}");
    }

    private static void GiveNativeBackPriority(UIKit.UIView view, UIKit.UIGestureRecognizer back)
    {
        if (view is UIKit.UIScrollView scroll)
        {
            scroll.PanGestureRecognizer.RequireGestureRecognizerToFail(back);
        }
        foreach (var child in view.Subviews)
        {
            GiveNativeBackPriority(child, back);
        }
    }
#endif

#if ANDROID
    private void RegisterReaderBack()
    {
        UnregisterReaderBack();
        if (Platform.CurrentActivity is not MainActivity activity)
        {
            return;
        }

        _readerBack = new ReaderBackCallback(_actions.TryHandleBack, activity);
        activity.OnBackPressedDispatcher.AddCallback(activity, _readerBack);
        UpdateReaderBack();
    }

    private void UnregisterReaderBack()
    {
        _readerBack?.Remove();
        _readerBack?.Dispose();
        _readerBack = null;
    }

    private void UpdateReaderBack()
    {
        // Root-page overlays do not add a Shell navigation entry. Android needs
        // an enabled callback before predictive Back begins to consume them —
        // the same transient set the capsule Back reports (#2467).
        if (_readerBack != null)
        {
            _readerBack.Enabled = _actions.OwnsReturnSurface();
        }
    }

    private sealed class ReaderBackCallback(Func<bool> tryHandleBack, MainActivity activity)
        : OnBackPressedCallback(false)
    {
        public override void HandleOnBackPressed()
        {
            if (tryHandleBack())
            {
                return;
            }

            Enabled = false;
            activity.OnBackPressedDispatcher.OnBackPressed();
        }
    }
#endif
}
