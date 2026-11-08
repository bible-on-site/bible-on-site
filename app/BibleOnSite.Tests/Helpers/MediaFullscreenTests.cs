using BibleOnSite.Helpers;

namespace BibleOnSite.Tests.Helpers;

public class MediaFullscreenTests
{
	[Fact]
	public void TryExit_WithoutFullscreenSurface_LetsBackPropagate()
	{
		// Outside Android there is no decor-view reparenting to detect, so the
		// press must keep propagating to page navigation.
		MediaFullscreen.TryExit().Should().BeFalse();
	}
}
