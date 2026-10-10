using Android.App;
using Android.Content;
using Android.Content.PM;
using Android.OS;
using Android.Views;
using BibleOnSite.Behaviors;
using BibleOnSite.Helpers;
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
        if (Intent?.GetBooleanExtra(Services.SearchIndexService.E2eEnvironmentVariable, false) == true)
        {
            Services.SearchIndexService.MarkE2eLaunchFromIntent();
        }
        base.OnCreate(savedInstanceState);
        HandleAppLinkIntent(Intent);
        // Firebase initialized from google-services.json (Plugin.Firebase / Xamarin.Firebase.Analytics process it at build).
        // For explicit init use Plugin.Firebase.Core CrossFirebase.Initialize(activity, settings) when needed.
    }

    protected override void OnNewIntent(Intent? intent)
    {
        base.OnNewIntent(intent);
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
    public static event EventHandler? TouchCancelled;

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
                for (var i = 0; i < e.HistorySize; i++)
                {
                    _touch.Move(e.GetHistoricalX(i), e.GetHistoricalY(i), isScrolling: false);
                }
                _touch.Move(e.GetX(), e.GetY(), isScrolling: false);
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
                TouchCancelled?.Invoke(this, EventArgs.Empty);
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
}
