using Android.App;
using Android.Content;
using Android.Content.PM;
using Android.OS;
using Android.Views;
using AndroidX.Activity;
using BibleOnSite.Behaviors;
using BibleOnSite.Helpers;
using IWindow = Microsoft.Maui.IWindow;
namespace BibleOnSite;

[Activity(Theme = "@style/Maui.SplashTheme", MainLauncher = true, LaunchMode = LaunchMode.SingleTop, Exported = true, ConfigurationChanges = ConfigChanges.ScreenSize | ConfigChanges.Orientation | ConfigChanges.UiMode | ConfigChanges.ScreenLayout | ConfigChanges.SmallestScreenSize | ConfigChanges.Density)]
// Android App Links: verified https links to perek pages on the website open
// directly in the app. Both Hebrew IDN domains are claimed (תנך.co.il and
// תנך.com serve the site and host /.well-known/assetlinks.json). 929.org.il
// is a Cloudflare redirect and cannot host assetlinks.json, so it stays
// unclaimed — filters for it could never verify on Android 12+.
[IntentFilter(new[] { Intent.ActionView }, AutoVerify = true,
    Categories = new[] { Intent.CategoryDefault, Intent.CategoryBrowsable },
    DataScheme = "https", DataHosts = new[] { "xn--febl3a.co.il", "xn--febl3a.com" },
    DataPathPrefix = "/929")]
public class MainActivity : MauiAppCompatActivity
{
    protected override void OnCreate(Bundle? savedInstanceState)
    {
        // The mobile e2e suite launches with a BIBLE_E2E intent extra — Android
        // intents cannot carry process environment like iOS launches can. The
        // marker must be read before base.OnCreate reaches App.CreateWindow so
        // the search-index warmup sees it on this launch, and MarkE2eLaunch's
        // file covers the relaunched processes whose extras adb drops.
        if (Intent?.GetBooleanExtra(Services.SearchIndexService.E2eEnvironmentVariable, false) ?? false)
        {
            Services.SearchIndexService.MarkE2eLaunchFromIntent();
        }
        // The coverage reset token rides the same launch intent; persisting it
        // covers later relaunches whose extras adb drops.
        var e2eCoverageToken = Intent?.GetStringExtra("BIBLE_E2E_COVERAGE_TOKEN");
        if (!string.IsNullOrEmpty(e2eCoverageToken))
        {
            Services.SearchIndexService.MarkE2eCoverageToken(e2eCoverageToken);
        }
        base.OnCreate(savedInstanceState);
        // MAUI's own MauiOnBackPressedCallback is only enabled while
        // Window.CanConsumeBackNavigation reports in-app history, so at the
        // root (and over a detached fullscreen player) Back never reaches
        // Shell.OnBackButtonPressed. This always-enabled callback delivers the
        // press to the shared managed pipeline regardless of nav state; the
        // exit confirmation (#2118) and media fullscreen dismissal (#2117)
        // require intercepting exactly those presses. Registered after base
        // OnCreate so it is consulted ahead of MAUI's callback.
        OnBackPressedDispatcher.AddCallback(this, new AppBackPressedCallback(this));
#if DISABLE_ANALYTICS
        // Test builds bake firebase_analytics_collection_deactivated into the
        // merged manifest — the SDK ignores runtime opt-in and nothing can
        // emit, so the launch log records the build-level gate instead (#2120).
        Console.WriteLine("[Analytics] collection deactivated at build time (DISABLE_ANALYTICS)");
#else
        // The manifest keeps collection off because FirebaseInitProvider runs
        // before managed code; enable it only outside the e2e suite, and set it
        // explicitly both ways so a flag persisted by an earlier non-suite
        // install on this device cannot leak test traffic either.
        // The standalone Plugin.Firebase.Analytics package does not bind the
        // native instance on Android; without this every call NREs (#2247).
        Plugin.Firebase.Analytics.FirebaseAnalyticsImplementation.Initialize(this);
        var analyticsCollectionEnabled = !Services.SearchIndexService.IsE2eMarkedProcess();
        Plugin.Firebase.Analytics.CrossFirebaseAnalytics.Current.IsAnalyticsCollectionEnabled =
            analyticsCollectionEnabled;
        Console.WriteLine($"[Analytics] collection enabled={analyticsCollectionEnabled}");
#endif
        HandleAppLinkIntent(Intent);
        // Firebase initialized from google-services.json (Plugin.Firebase / Xamarin.Firebase.Analytics process it at build).
        // For explicit init use Plugin.Firebase.Core CrossFirebase.Initialize(activity, settings) when needed.
    }

    protected override void OnNewIntent(Intent? intent)
    {
        base.OnNewIntent(intent);
#if !DISABLE_ANALYTICS
        // singleTop relaunches deliver a marked suite intent here without
        // OnCreate running — honor it so a reused activity stops emitting
        // instead of leaking suite events under the previous launch's
        // enabled collection (#2120).
        if (intent?.GetBooleanExtra(Services.SearchIndexService.E2eEnvironmentVariable, false) ?? false)
        {
            Services.SearchIndexService.MarkE2eLaunchFromIntent();
            Plugin.Firebase.Analytics.CrossFirebaseAnalytics.Current.IsAnalyticsCollectionEnabled = false;
            Console.WriteLine("[Analytics] collection enabled=false (e2e relaunch)");
        }
#endif
        HandleAppLinkIntent(intent);
    }

    /// <summary>Routes a VIEW intent for a website perek URL into app navigation.</summary>
    private static void HandleAppLinkIntent(Intent? intent)
    {
        if (intent?.Action != Intent.ActionView)
        {
            return;
        }
        if (AppLinkHelper.TryParse(intent.Data?.ToString(), out var target))
        {
            AppLinkHelper.Request(target);
        }
    }

    private readonly PressGestureTracker _touch = new();
    private bool _singleTouchActive;

    public static event EventHandler<TouchPosition>? TouchStarted;
    private static EventHandler<TouchPosition>? _touchDispatched;

    public static void SubscribeTouchDispatched(EventHandler<TouchPosition> handler) =>
        _touchDispatched += handler;

    public static void UnsubscribeTouchDispatched(EventHandler<TouchPosition> handler) =>
        _touchDispatched -= handler;
    public static event EventHandler<TouchPosition>? TouchReleased;
    public static event EventHandler<TouchPosition>? TouchMoved;

    public override bool DispatchTouchEvent(MotionEvent? e)
    {
        if (e == null)
        {
            return base.DispatchTouchEvent(e);
        }

        switch (e.ActionMasked)
        {
            case MotionEventActions.Down:
                LongPressBehavior.CancelAllPending();
                _touch.Begin(e.GetX(), e.GetY(), ViewConfiguration.Get(this)?.ScaledTouchSlop ?? 12);
                _singleTouchActive = true;
                TouchStarted?.Invoke(this, new TouchPosition(e.RawX, e.RawY, e.EventTime));
                break;

            case MotionEventActions.Move:
                var wasActive = _touch.TouchActive;
                // History matters when a busy UI receives batched input: a finger
                // may already have moved out of slop and returned to its origin.
                // Historical coords are view-space like GetX/GetY; shift them
                // into the raw space Begin/End positions are recorded in.
                var historyOffsetX = e.RawX - e.GetX();
                var historyOffsetY = e.RawY - e.GetY();
                for (var i = 0; i < e.HistorySize; i++)
                {
                    _touch.Move(e.GetHistoricalX(i), e.GetHistoricalY(i), isScrolling: false);
                    TouchMoved?.Invoke(this, new TouchPosition(
                        e.GetHistoricalX(i) + historyOffsetX,
                        e.GetHistoricalY(i) + historyOffsetY,
                        e.GetHistoricalEventTime(i)));
                }
                _touch.Move(e.GetX(), e.GetY(), isScrolling: false);
                TouchMoved?.Invoke(this, new TouchPosition(e.RawX, e.RawY, e.EventTime));
                if (wasActive && !_touch.TouchActive)
                {
                    LongPressBehavior.CancelAllPending();
                }
                break;

            case MotionEventActions.Up:
                _touch.Move(e.GetX(), e.GetY(), isScrolling: false);
                _touch.End();
                break;

            case MotionEventActions.Cancel:
            case MotionEventActions.PointerDown:
            case MotionEventActions.PointerUp:
                _singleTouchActive = false;
                _touch.Abort();
                LongPressBehavior.CancelAllPending();
                // Cancel/interruption ends the gesture too — deliver it as a
                // release so subscribers can settle any in-flight swipe.
                TouchReleased?.Invoke(this, new TouchPosition(e.RawX, e.RawY, e.EventTime));
                break;

            default:
                // Other motion actions retain the native dispatch behavior.
                break;
        }

        // Copy release data before native handlers temporarily transform events.
        var released = e.ActionMasked == MotionEventActions.Up;
        var position = new TouchPosition(e.RawX, e.RawY, e.EventTime);
        // Let the verse process a genuine tap before clearing remaining timers.
        var handled = base.DispatchTouchEvent(e);
        if (e.ActionMasked == MotionEventActions.Down)
        {
            // A settling RecyclerView may consume Down before a verse receives
            // it. Give the page a chance to arm that still-stationary press.
            _touchDispatched?.Invoke(this, position);
        }
        if (released)
        {
            LongPressBehavior.CancelAllPending();
            if (_singleTouchActive)
            {
                TouchReleased?.Invoke(this, position);
            }
            _singleTouchActive = false;
        }
        return handled;
    }

    /// <summary>
    /// Always-enabled Back delivery into the managed pipeline. Runs the same
    /// <see cref="IWindow.BackButtonClicked"/> route as MAUI's own back
    /// callback — <see cref="AppShell.OnBackButtonPressed"/> orders fullscreen
    /// media dismissal, reader/page overlays, Shell navigation, and the root
    /// exit confirmation from there. When the managed layer declines the press
    /// (e.g. an open flyout that defers to DrawerLayout), the callback steps
    /// aside and re-dispatches so the platform/system handles it.
    /// </summary>
    private sealed class AppBackPressedCallback(MainActivity activity) : OnBackPressedCallback(true)
    {
        public override void HandleOnBackPressed()
        {
            var window = Microsoft.Maui.Controls.Application.Current?.Windows.FirstOrDefault();
            var handled = window is not null && ((IWindow)window).BackButtonClicked();
            if (handled)
            {
                return;
            }

            Enabled = false;
            try
            {
                activity.OnBackPressedDispatcher.OnBackPressed();
            }
            finally
            {
                Enabled = true;
            }
        }
    }
}
