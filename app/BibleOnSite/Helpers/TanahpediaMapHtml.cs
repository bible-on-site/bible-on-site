using System.Text.Json;
using BibleOnSite.Models;

namespace BibleOnSite.Helpers;

/// <summary>
/// Builds the self-contained HTML document rendered by
/// <see cref="Controls.TanahpediaPlacesMap"/> — a Leaflet map over OpenStreetMap
/// tiles (no API key), the same tile source the website's places map uses.
/// Marker popups link to <c>tanahpedia://entry/{slug}</c>, which the host
/// intercepts and routes to the native entry page.
/// </summary>
public static class TanahpediaMapHtml
{
    /// <summary>Custom URL scheme for in-map entry links.</summary>
    public static string EntryLinkScheme => "tanahpedia://entry/";

    /// <summary>
    /// Extracts the canonical entry slug from a <see cref="EntryLinkScheme"/>
    /// URL; false for any other URL.
    /// </summary>
    public static bool TryGetEntryUniqueName(string url, out string uniqueName)
    {
        if (url.StartsWith(EntryLinkScheme, StringComparison.Ordinal))
        {
            uniqueName = Uri.UnescapeDataString(url[EntryLinkScheme.Length..]);
            return uniqueName.Length > 0;
        }
        uniqueName = string.Empty;
        return false;
    }

    /// <summary>
    /// The full HTML document for the given markers. Leaflet 1.9.4 loads from
    /// unpkg (the version the website pins); tiles come from OSM directly.
    /// </summary>
    public static string BuildHtml(IReadOnlyList<TanahpediaPlaceMarker> markers)
    {
        var payload = SerializeMarkers(markers);
        return $$"""
            <!DOCTYPE html>
            <html dir="rtl" lang="he">
            <head>
                <meta charset="utf-8" />
                <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />
                <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
                <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
                <style>
                    html, body, #map { height: 100%; margin: 0; padding: 0; }
                    .marker-dot { display: block; width: 14px; height: 14px; border-radius: 50%;
                        background: #4338ca; border: 2px solid #fff; box-shadow: 0 0 3px rgba(0,0,0,.4); }
                    .popup-name { font-size: 14px; }
                    .popup-modern { color: #555; font-size: 12px; }
                    .leaflet-popup-content { direction: rtl; text-align: right; margin: 8px 12px; }
                </style>
            </head>
            <body>
                <div id="map" role="presentation"></div>
                <script>
                    const markers = {{payload}};
                    const map = L.map('map', { scrollWheelZoom: true }).setView([31.46, 35.25], 8);
                    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
                        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
                        maxZoom: 19
                    }).addTo(map);

                    const icon = L.divIcon({
                        className: '',
                        html: '<span class="marker-dot" aria-hidden="true"></span>',
                        iconSize: [14, 14],
                        iconAnchor: [7, 7]
                    });

                    const latLngs = [];
                    for (const m of markers) {
                        latLngs.push([m.lat, m.lng]);
                        const name = document.createElement('span');
                        name.className = 'popup-name';
                        name.textContent = m.placeName;
                        const wrap = document.createElement('div');
                        if (m.entryUniqueName) {
                            const link = document.createElement('a');
                            link.href = '{{EntryLinkScheme}}' + encodeURIComponent(m.entryUniqueName);
                            link.appendChild(name);
                            wrap.appendChild(link);
                        } else {
                            wrap.appendChild(name);
                        }
                        if (m.modernName) {
                            const modern = document.createElement('span');
                            modern.className = 'popup-modern';
                            modern.dir = 'ltr';
                            modern.textContent = ' (' + m.modernName + ')';
                            wrap.appendChild(modern);
                        }
                        L.marker([m.lat, m.lng], { icon }).addTo(map).bindPopup(wrap);
                    }

                    if (latLngs.length === 1) {
                        map.setView(latLngs[0], 10);
                    } else if (latLngs.length > 1) {
                        map.fitBounds(L.latLngBounds(latLngs), { padding: [28, 28] });
                    }
                </script>
            </body>
            </html>
            """;
    }

    /// <summary>
    /// Markers serialized for the inline script — the source-generated context
    /// keeps release builds trim-safe, and the default JSON encoder writes
    /// angle brackets, ampersands and non-ASCII (Hebrew) text as unicode
    /// escapes, so marker text can never break out of the script block.
    /// Entry slugs stay raw here; the script URL-encodes them per link.
    /// </summary>
    private static string SerializeMarkers(IReadOnlyList<TanahpediaPlaceMarker> markers) =>
        JsonSerializer.Serialize(markers, TanahpediaJsonContext.Default.TanahpediaPlaceMarkers);
}
