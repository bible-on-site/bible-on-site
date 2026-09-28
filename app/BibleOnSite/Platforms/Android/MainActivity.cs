using Android.App;
using Android.Content.PM;
using Android.OS;
using Android.Views;
using BibleOnSite.Behaviors;
using BibleOnSite.Helpers;
namespace BibleOnSite;

[Activity(Theme = "@style/Maui.SplashTheme", MainLauncher = true, LaunchMode = LaunchMode.SingleTop, ConfigurationChanges = ConfigChanges.ScreenSize | ConfigChanges.Orientation | ConfigChanges.UiMode | ConfigChanges.ScreenLayout | ConfigChanges.SmallestScreenSize | ConfigChanges.Density)]
public class MainActivity : MauiAppCompatActivity
{
    protected override void OnCreate(Bundle? savedInstanceState)
    {
        base.OnCreate(savedInstanceState);
        // Firebase initialized from google-services.json (Plugin.Firebase / Xamarin.Firebase.Analytics process it at build).
        // For explicit init use Plugin.Firebase.Core CrossFirebase.Initialize(activity, settings) when needed.
    }

    private readonly PressGestureTracker _touch = new();
    private bool _singleTouchActive;

    public static event EventHandler<TouchPosition>? TouchStarted;
    public static event EventHandler<TouchPosition>? TouchDispatched;
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
            TouchDispatched?.Invoke(this, position);
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
