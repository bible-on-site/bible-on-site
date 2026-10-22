namespace BibleOnSite.Controls;

// Creating a MediaElement handler activates the native audio session. Reading
// must not start that system work before a recording is requested.
public sealed class RecitationPlaybackHost : ContentView
{
    public RecitationPlaybackHost()
    {
        WidthRequest = 1;
        HeightRequest = 1;
        Opacity = 0;
        InputTransparent = true;
        AutomationProperties.SetExcludedWithChildren(this, true);
    }

    public View GetOrCreatePlayer(Func<View> createPlayer)
    {
        if (Content is { } existing) { return existing; }
        var player = createPlayer();
        Content = player;
        return player;
    }
}
