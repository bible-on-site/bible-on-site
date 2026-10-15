using System.Text.Encodings.Web;
using System.Text.Json;
using BibleOnSite.Models;

namespace BibleOnSite.Helpers;

/// <summary>
/// Builds the self-contained HTML document rendered by
/// <see cref="Controls.TanahpediaPlacesMap"/>. With a Mapbox public token the
/// page uses Mapbox GL + the Standard style - the same provider and style the
/// website's places map uses; without one it falls back to Leaflet over
/// OpenStreetMap tiles (the website's no-key fallback).
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
    /// The no-token entry point - always the Leaflet/OSM page.
    /// </summary>
    public static string BuildHtml(IReadOnlyList<TanahpediaPlaceMarker> markers) =>
        BuildLeafletHtml(markers);

    /// <summary>
    /// The full HTML document for the given markers - Mapbox when
    /// <paramref name="mapboxToken"/> is packaged, else the Leaflet/OSM page.
    /// Both load their JS/CSS from the provider CDNs (the versions the
    /// website pins).
    /// </summary>
    public static string BuildHtml(IReadOnlyList<TanahpediaPlaceMarker> markers, string? mapboxToken) =>
        string.IsNullOrWhiteSpace(mapboxToken)
            ? BuildLeafletHtml(markers)
            : BuildMapboxHtml(markers, mapboxToken);

    /// <summary>
    /// Mapbox GL document - mirrors the website's
    /// <c>MapboxPlacesMapClient</c>: Standard style in Hebrew with admin
    /// boundaries/POIs/landmarks hidden, same-location markers grouped into
    /// one popup, entry links through <see cref="EntryLinkScheme"/>.
    /// mapbox-gl-js 3.32.0 + the RTL text plugin load from api.mapbox.com.
    /// </summary>
    private static string BuildMapboxHtml(IReadOnlyList<TanahpediaPlaceMarker> markers, string mapboxToken)
    {
        var payload = SerializeMarkers(markers);
        // JsonEncodedText keeps this trim-safe (reflection serialization is
        // disabled in trimmed builds and the test assembly).
        var token = $"\"{JsonEncodedText.Encode(mapboxToken)}\"";
        return $$$"""
            <!DOCTYPE html>
            <html dir="rtl" lang="he">
            <head>
                <meta charset="utf-8" />
                <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />
                <link rel="stylesheet" href="https://api.mapbox.com/mapbox-gl-js/v3.32.0/mapbox-gl.css" />
                <script src="https://api.mapbox.com/mapbox-gl-js/v3.32.0/mapbox-gl.js"></script>
                <style>
                    html, body, #map { height: 100%; margin: 0; padding: 0; }
                    .mapboxgl-popup-content { direction: rtl; text-align: right; }
                    .popup-place + .popup-place { margin-top: 6px; }
                    .popup-place a { color: #1552ac; font-weight: 700; }
                    .popup-place strong { font-weight: 700; }
                    .popup-place span { display: block; color: #555; font-size: 12px; }
                </style>
            </head>
            <body>
                <div id="map" role="presentation"></div>
                <script>
                    const markers = {{{payload}}};
                    const groups = [];
                    const byKey = new Map();
                    for (const m of markers) {
                        const key = m.lat + ',' + m.lng;
                        if (!byKey.has(key)) { byKey.set(key, groups.length); groups.push([m]); }
                        else { groups[byKey.get(key)].push(m); }
                    }

                    mapboxgl.accessToken = {{{token}}};
                    if (mapboxgl.getRTLTextPluginStatus() === 'unavailable') {
                        mapboxgl.setRTLTextPlugin(
                            'https://api.mapbox.com/mapbox-gl-js/plugins/mapbox-gl-rtl-text/v0.4.0/mapbox-gl-rtl-text.js',
                            null, true);
                    }
                    const map = new mapboxgl.Map({
                        container: 'map',
                        style: 'mapbox://styles/mapbox/standard',
                        center: [35.2351364, 31.7780132],
                        zoom: 11.5,
                        language: 'he',
                        config: { basemap: {
                            show3dObjects: false,
                            showAdminBoundaries: false,
                            showPointOfInterestLabels: false,
                            showLandmarkIcons: false,
                            showLandmarkIconLabels: false } }
                    });
                    map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), 'top-left');

                    let popup = null;
                    map.on('load', () => {
                        map.addSource('tanahpedia-places', { type: 'geojson', data: {
                            type: 'FeatureCollection',
                            features: groups.map((group, index) => ({
                                type: 'Feature',
                                geometry: { type: 'Point', coordinates: [group[0].lng, group[0].lat] },
                                properties: { index }
                            }))
                        }});
                        map.addLayer({ id: 'tanahpedia-place-points', type: 'circle',
                            source: 'tanahpedia-places', slot: 'top',
                            paint: { 'circle-radius': 9, 'circle-color': '#4338ca',
                                'circle-stroke-color': '#ffffff', 'circle-stroke-width': 3 } });
                    });
                    map.on('click', 'tanahpedia-place-points', (event) => {
                        const index = Number(event.features && event.features[0] && event.features[0].properties.index);
                        const group = groups[index];
                        if (!group) return;
                        const content = document.createElement('div');
                        for (const m of group) {
                            const place = document.createElement('div');
                            place.className = 'popup-place';
                            const title = m.entryUniqueName
                                ? document.createElement('a')
                                : document.createElement('strong');
                            title.textContent = m.placeName;
                            if (m.entryUniqueName) {
                                title.href = '{{{EntryLinkScheme}}}' + encodeURIComponent(m.entryUniqueName);
                            }
                            place.appendChild(title);
                            if (m.modernName) {
                                const modern = document.createElement('span');
                                modern.dir = 'ltr';
                                modern.textContent = m.modernName;
                                place.appendChild(modern);
                            }
                            content.appendChild(place);
                        }
                        if (popup) popup.remove();
                        popup = new mapboxgl.Popup({ offset: 14, closeOnClick: false })
                            .setLngLat([group[0].lng, group[0].lat])
                            .setDOMContent(content)
                            .addTo(map);
                    });

                    if (markers.length === 1) {
                        map.setCenter([markers[0].lng, markers[0].lat]);
                        map.setZoom(12.5);
                    } else if (markers.length > 1) {
                        const bounds = new mapboxgl.LngLatBounds();
                        for (const m of markers) bounds.extend([m.lng, m.lat]);
                        map.fitBounds(bounds, { padding: 64, maxZoom: 12.5, duration: 0 });
                    }
                </script>
            </body>
            </html>
            """;
    }

    /// <summary>
    /// The no-key fallback document - Leaflet 1.9.4 over OpenStreetMap tiles.
    /// </summary>
    private static string BuildLeafletHtml(IReadOnlyList<TanahpediaPlaceMarker> markers)
    {
        var payload = SerializeMarkers(markers);
        return $$$"""
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
                    const markers = {{{payload}}};
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
                            link.href = '{{{EntryLinkScheme}}}' + encodeURIComponent(m.entryUniqueName);
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
    /// Markers serialized for the inline script - the source-generated context
    /// keeps release builds trim-safe, and the default JSON encoder writes
    /// angle brackets, ampersands and non-ASCII (Hebrew) text as unicode
    /// escapes, so marker text can never break out of the script block.
    /// Entry slugs stay raw here; the script URL-encodes them per link.
    /// </summary>
    private static string SerializeMarkers(IReadOnlyList<TanahpediaPlaceMarker> markers) =>
        JsonSerializer.Serialize(markers, TanahpediaJsonContext.Default.TanahpediaPlaceMarkers);
}
