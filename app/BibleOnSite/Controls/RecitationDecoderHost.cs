namespace BibleOnSite.Controls;

// Audio decoding needs a live WebView, but ordinary reading/search does not.
// Constructing it with the page starts WebKit and exposes a hidden remote view
// to accessibility snapshots before anyone has requested audio.
public sealed class RecitationDecoderHost : ContentView
{
    public RecitationDecoderHost()
    {
        WidthRequest = 1;
        HeightRequest = 1;
        Opacity = 0;
        InputTransparent = true;
        AutomationProperties.SetExcludedWithChildren(this, true);
    }

    public WebView GetOrCreateView()
    {
        if (Content is WebView existing)
        {
            return existing;
        }
        var view = new WebView { AutomationId = "RecitationDecoder" };
        Content = view;
        return view;
    }
}
