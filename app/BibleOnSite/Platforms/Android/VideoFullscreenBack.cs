#if ANDROID
using Android.Views;
using AndroidX.Activity;
using AndroidX.Media3.UI;
using AView = Android.Views.View;

namespace BibleOnSite;

// CommunityToolkit's MediaElement fullscreen on Android is a view reparent,
// not a dialog: MauiMediaElement moves the PlayerView's wrapper onto the
// window's DecorView. Android Back dispatch never reaches that overlay, so
// while a video plays fullscreen a press would navigate the app out from
// under the floating player (#2117). This activity-level callback stays
// armed and converts that press into the controller's own fullscreen
// toggle, which reparents the player and restores the system bars through
// the toolkit's own handler. When nothing is fullscreen it disarms,
// redispatches the press to the normal navigation handlers, and re-arms.
internal sealed class VideoFullscreenBackCallback(MainActivity activity) : OnBackPressedCallback(true)
{
    public override void HandleOnBackPressed()
    {
        if (TryExitFullscreen())
        {
            return;
        }

        Enabled = false;
        activity.OnBackPressedDispatcher.OnBackPressed();
        Enabled = true;
    }

    // A PlayerView whose parent sits directly on the DecorView is in the
    // toolkit's fullscreen reparent; embedded players sit deeper in the
    // tree. The exit path relies on the controller's fullscreen toggle —
    // every MediaElement in the app enables playback controls. The id is a
    // Media3 library resource, which does not merge into the app's
    // ResourceConstant class, so resolve it at runtime.
    private static bool TryExitFullscreen()
    {
        if (Platform.CurrentActivity?.Window?.DecorView is not ViewGroup decor)
        {
            return false;
        }

        var playerView = FindFullscreenPlayer(decor);
        var iconId = decor.Resources?.GetIdentifier("exo_fullscreen", "id", Platform.AppContext?.PackageName) ?? 0;
        if (iconId == 0)
        {
            return false;
        }

        return playerView?.FindViewById<AView>(iconId)?.PerformClick() == true;
    }

    private static PlayerView? FindFullscreenPlayer(ViewGroup decor)
    {
        var pending = new Queue<AView>([decor]);
        while (pending.Count > 0)
        {
            var view = pending.Dequeue();
            if (view is PlayerView playerView
                && playerView.Parent is AView parent
                && ReferenceEquals(parent.Parent, decor))
            {
                return playerView;
            }

            if (view is ViewGroup group)
            {
                for (var i = 0; i < group.ChildCount; i++)
                {
                    if (group.GetChildAt(i) is { } child)
                    {
                        pending.Enqueue(child);
                    }
                }
            }
        }

        return null;
    }
}
#endif
