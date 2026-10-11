#if DEBUG
using CommunityToolkit.Maui.Views;

namespace BibleOnSite.Pages;

// E2E-only video surface for the fullscreen-Back regression (#2117). The
// mobile suite launches the app with BIBLE_E2E_VIDEO=1 — an Android launch
// extra or an iOS process env var — and AppShell pushes this page over the
// reader, reproducing the article page's MediaElement/toolkit fullscreen
// path without the API the e2e fixture lacks. Release builds never carry it.
public sealed class E2eVideoPage : ContentPage
{
    public static bool Enabled =>
        string.Equals(Environment.GetEnvironmentVariable("BIBLE_E2E_VIDEO"), "1", StringComparison.Ordinal);

    public E2eVideoPage()
    {
        Content = new MediaElement
        {
            Source = MediaSource.FromResource("e2e_sample.mp4"),
            ShouldShowPlaybackControls = true,
            AutomationId = "E2eVideo",
            BackgroundColor = Colors.Black
        };
    }
}
#endif
