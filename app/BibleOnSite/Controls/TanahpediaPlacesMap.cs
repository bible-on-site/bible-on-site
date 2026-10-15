using System.Windows.Input;
using BibleOnSite.Helpers;
using BibleOnSite.Models;

namespace BibleOnSite.Controls;

/// <summary>
/// Renders Tanahpedia place identifications as an interactive map - Mapbox GL
/// inside a WebView when the packaged public token exists (the same provider
/// the website uses), else the no-key Leaflet/OpenStreetMap fallback.
/// Marker popups link to the place's entry; taps are routed in-app through
/// <see cref="EntryTappedCommand"/>.
/// </summary>
public class TanahpediaPlacesMap : ContentView
{
    private readonly WebView _webView;

    public TanahpediaPlacesMap()
    {
        _webView = new WebView();
        _webView.Navigating += OnNavigating;
        Content = _webView;
    }

    /// <summary>Place pins to render.</summary>
    public static readonly BindableProperty MarkersProperty = BindableProperty.Create(
        nameof(Markers),
        typeof(IReadOnlyList<TanahpediaPlaceMarker>),
        typeof(TanahpediaPlacesMap),
        propertyChanged: (bindable, _, _) => _ = ((TanahpediaPlacesMap)bindable).ApplyMarkersAsync());

    public IReadOnlyList<TanahpediaPlaceMarker>? Markers
    {
        get => (IReadOnlyList<TanahpediaPlaceMarker>?)GetValue(MarkersProperty);
        set => SetValue(MarkersProperty, value);
    }

    /// <summary>
    /// Invoked with the canonical entry slug when a marker popup's entry link
    /// is tapped. Null slugs (places without an entry) never reach it.
    /// </summary>
    public static readonly BindableProperty EntryTappedCommandProperty = BindableProperty.Create(
        nameof(EntryTappedCommand),
        typeof(ICommand),
        typeof(TanahpediaPlacesMap));

    public ICommand? EntryTappedCommand
    {
        get => (ICommand?)GetValue(EntryTappedCommandProperty);
        set => SetValue(EntryTappedCommandProperty, value);
    }

    private async Task ApplyMarkersAsync()
    {
        var markers = Markers;
        if (markers is not { Count: > 0 })
        {
            _webView.Source = null;
            return;
        }

        var token = await Config.AppConfig.Instance.GetMapboxAccessTokenAsync();
        var html = TanahpediaMapHtml.BuildHtml(markers, token);
        // The continuation may resume off the UI thread - WebView needs it.
        MainThread.BeginInvokeOnMainThread(() => _webView.Source = new HtmlWebViewSource { Html = html });
    }

    /// <summary>
    /// Intercepts in-map navigation: entry links route in-app through the
    /// command; anything else external (e.g. the OSM attribution link) opens
    /// in the browser instead of replacing the map.
    /// </summary>
    private void OnNavigating(object? sender, WebNavigatingEventArgs e)
    {
        var url = e.Url;
        if (TanahpediaMapHtml.TryGetEntryUniqueName(url, out var uniqueName))
        {
            e.Cancel = true;
            if (EntryTappedCommand?.CanExecute(uniqueName) == true)
            {
                EntryTappedCommand.Execute(uniqueName);
            }
            return;
        }

        // The initial document loads from inline HTML - block any real
        // navigation (external links) and hand it to the system browser.
        if (url.StartsWith("http://", StringComparison.Ordinal)
            || url.StartsWith("https://", StringComparison.Ordinal))
        {
            e.Cancel = true;
            _ = Launcher.OpenAsync(new Uri(url));
        }
    }
}
