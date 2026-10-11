namespace BibleOnSite.Helpers;

/// <summary>
/// Detects and dismisses a fullscreen CommunityToolkit MediaElement surface.
/// On Android the toolkit moves the RelativeLayout holding the PlayerView out
/// of its page and straight into the window decor view for fullscreen, without
/// touching Back routing — so a Back press would pop the page or leave the app
/// underneath the video. Releasing the surface consumes that press first.
/// </summary>
public static class MediaFullscreen
{
	/// <summary>
	/// Exits an active fullscreen media surface, if any.
	/// Returns true when a surface was found and released, i.e. Back consumed.
	/// </summary>
	public static bool TryExit()
	{
#if ANDROID
		if (Platform.CurrentActivity?.Window?.DecorView is not Android.Views.ViewGroup decorView)
		{
			return false;
		}

		var playerView = FindDetachedPlayerView(decorView);
		if (playerView is null)
		{
			return false;
		}

		// Clicking the controller's own fullscreen button runs the exact same
		// reparent + system-bars restore path as a user tap, so playback state
		// and page layout come back unchanged.
		return playerView.FindViewById(Resource.Id.exo_fullscreen)?.PerformClick() == true;
#else
		return false;
#endif
	}

#if ANDROID
	// In fullscreen the toolkit's RelativeLayout (which directly hosts the
	// PlayerView) becomes a direct child of the decor view — the only place a
	// PlayerView can sit under a decor-child RelativeLayout.
	private static AndroidX.Media3.UI.PlayerView? FindDetachedPlayerView(Android.Views.ViewGroup decorView)
	{
		for (var i = 0; i < decorView.ChildCount; i++)
		{
			if (decorView.GetChildAt(i) is not Android.Widget.RelativeLayout overlay)
			{
				continue;
			}

			for (var j = 0; j < overlay.ChildCount; j++)
			{
				if (overlay.GetChildAt(j) is AndroidX.Media3.UI.PlayerView playerView)
				{
					return playerView;
				}
			}
		}
		return null;
	}
#endif
}
