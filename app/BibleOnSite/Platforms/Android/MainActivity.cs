using Android.App;
using Android.Content.PM;
using Android.OS;
using Android.Views;
using BibleOnSite.Behaviors;

namespace BibleOnSite;

[Activity(Theme = "@style/Maui.SplashTheme", MainLauncher = true, LaunchMode = LaunchMode.SingleTop, ConfigurationChanges = ConfigChanges.ScreenSize | ConfigChanges.Orientation | ConfigChanges.UiMode | ConfigChanges.ScreenLayout | ConfigChanges.SmallestScreenSize | ConfigChanges.Density)]
public class MainActivity : MauiAppCompatActivity
{
    private float _downX, _downY;
    private long _downTime;
    private const float TapThreshold = 30f; // Max movement for tap
    private const long TapTimeoutMs = 300; // Max duration for tap

    /// <summary>
    /// Event fired when a tap is detected. Used to notify selection mode.
    /// </summary>
    public static event EventHandler<(float X, float Y)>? TapDetected;

    public override bool DispatchTouchEvent(MotionEvent? e)
    {
        var action = e?.Action & MotionEventActions.Mask;

        switch (action)
        {
            case MotionEventActions.Down:
                _downX = e!.GetX();
                _downY = e.GetY();
                _downTime = e.EventTime;
                break;

            case MotionEventActions.Up:
                LongPressBehavior.CancelAllPending();

                // Check if this was a tap (quick, minimal movement)
                if (e != null)
                {
                    var dx = Math.Abs(e.GetX() - _downX);
                    var dy = Math.Abs(e.GetY() - _downY);
                    var duration = e.EventTime - _downTime;

                    if (dx < TapThreshold && dy < TapThreshold && duration < TapTimeoutMs)
                    {
                        TapDetected?.Invoke(this, (e.GetX(), e.GetY()));
                    }
                }
                break;

            case MotionEventActions.Cancel:
            case MotionEventActions.PointerUp:
                LongPressBehavior.CancelAllPending();
                break;
        }

        return base.DispatchTouchEvent(e);
    }
}
