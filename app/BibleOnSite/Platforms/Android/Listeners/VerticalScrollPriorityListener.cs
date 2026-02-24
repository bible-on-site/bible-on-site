using Android.Views;
using AndroidX.RecyclerView.Widget;

namespace BibleOnSite.Platforms.Android.Listeners;

/// <summary>
/// Prevents the parent CarouselView (horizontal RecyclerView) from intercepting
/// touch events when the gesture is primarily vertical (scrolling through pasukim).
///
/// Uses the standard Android <c>requestDisallowInterceptTouchEvent</c> pattern:
/// on ACTION_DOWN we optimistically claim the gesture; on ACTION_MOVE we release
/// the claim only when horizontal movement clearly dominates.  This mirrors the
/// legacy Flutter app's gesture-arena where the inner ListView always wins for
/// vertical gestures.
/// </summary>
internal sealed class VerticalScrollPriorityListener : Java.Lang.Object, RecyclerView.IOnItemTouchListener
{
    private float _startX;
    private float _startY;
    private bool _decided;

    private const float MinDistancePx = 12f;
    private const float HorizontalDominanceRatio = 1.5f;

    public bool OnInterceptTouchEvent(RecyclerView rv, MotionEvent e)
    {
        switch (e.Action)
        {
            case MotionEventActions.Down:
                _startX = e.GetX();
                _startY = e.GetY();
                _decided = false;
                rv.Parent?.RequestDisallowInterceptTouchEvent(true);
                break;

            case MotionEventActions.Move:
                if (!_decided)
                {
                    float dx = Math.Abs(e.GetX() - _startX);
                    float dy = Math.Abs(e.GetY() - _startY);

                    if (dx > MinDistancePx || dy > MinDistancePx)
                    {
                        _decided = true;
                        if (dx > dy * HorizontalDominanceRatio)
                        {
                            rv.Parent?.RequestDisallowInterceptTouchEvent(false);
                        }
                    }
                }
                break;

            case MotionEventActions.Up:
            case MotionEventActions.Cancel:
                rv.Parent?.RequestDisallowInterceptTouchEvent(false);
                _decided = false;
                break;
        }

        return false;
    }

    public void OnTouchEvent(RecyclerView rv, MotionEvent e) { }

    public void OnRequestDisallowInterceptTouchEvent(bool disallowIntercept) { }
}
