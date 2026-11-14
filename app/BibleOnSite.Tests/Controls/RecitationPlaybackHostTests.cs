using BibleOnSite.Controls;
using Microsoft.Maui.Controls;
using Xunit;

namespace BibleOnSite.Tests.Controls;

public sealed class RecitationPlaybackHostTests
{
    [Fact]
    public void ReadingHasNoPlayerOrAccessibleMediaSurface()
    {
        var host = new RecitationPlaybackHost();
        Assert.Null(host.Content);
        Assert.True(AutomationProperties.GetExcludedWithChildren(host));
        Assert.Equal(0, host.Opacity);
        Assert.True(host.InputTransparent);
    }

    [Fact]
    public void PlaybackCreatesOnePlayerAndReusesIt()
    {
        var host = new RecitationPlaybackHost();
        var created = 0;
        View CreatePlayer() { created++; return new Label(); }
        var player = host.GetOrCreatePlayer(CreatePlayer);
        Assert.Same(player, host.GetOrCreatePlayer(CreatePlayer));
        Assert.Same(player, host.Content);
        Assert.Equal(1, created);
    }
}
