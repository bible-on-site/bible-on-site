"use client";

import { useEffect, useRef, useState } from "react";
import type { PlaceMapMarker } from "@/lib/tanahpedia/types";
import "mapbox-gl/dist/mapbox-gl.css";
import styles from "./PlacesMap.module.css";

const JERUSALEM: [number, number] = [35.2351364, 31.7780132];
const RTL_PLUGIN_URL =
	"https://api.mapbox.com/mapbox-gl-js/plugins/mapbox-gl-rtl-text/v0.4.0/mapbox-gl-rtl-text.js";

export default function MapboxPlacesMapClient({
	markers,
}: {
	markers: PlaceMapMarker[];
}) {
	const containerRef = useRef<HTMLDivElement>(null);
	const [error, setError] = useState(false);

	useEffect(() => {
		const container = containerRef.current;
		const token = process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN;
		if (!container || !token) return;

		let cancelled = false;
		let map: import("mapbox-gl").Map | null = null;
		let popup: import("mapbox-gl").Popup | null = null;
		void import("mapbox-gl")
			.then((mapboxModule) => {
				if (cancelled) return;
				const mapboxgl = mapboxModule.default ?? mapboxModule;
				if (!mapboxgl.supported()) {
					setError(true);
					return;
				}
				if (mapboxgl.getRTLTextPluginStatus() === "unavailable") {
					mapboxgl.setRTLTextPlugin(RTL_PLUGIN_URL, null, true);
				}

				const activeMap = new mapboxgl.Map({
					accessToken: token,
					container,
					style: "mapbox://styles/mapbox/standard",
					center: JERUSALEM,
					zoom: 11.5,
					language: "he",
					config: {
						basemap: {
							show3dObjects: false,
							showAdminBoundaries: false,
							showPointOfInterestLabels: false,
							showLandmarkIcons: false,
							showLandmarkIconLabels: false,
						},
					},
				});
				map = activeMap;
				activeMap.addControl(
					new mapboxgl.NavigationControl({ showCompass: false }),
					"top-left",
				);

				const markerGroups = new Map<string, PlaceMapMarker[]>();
				for (const marker of markers) {
					const key = `${marker.lat},${marker.lng}`;
					markerGroups.set(key, [...(markerGroups.get(key) ?? []), marker]);
				}
				const groups = [...markerGroups.values()];
				activeMap.on("load", () => {
					activeMap.addSource("tanahpedia-places", {
						type: "geojson",
						data: {
							type: "FeatureCollection",
							features: groups.map((group, index) => ({
								type: "Feature",
								geometry: {
									type: "Point",
									coordinates: [group[0].lng, group[0].lat],
								},
								properties: { index },
							})),
						},
					});
					activeMap.addLayer({
						id: "tanahpedia-place-points",
						type: "circle",
						source: "tanahpedia-places",
						slot: "top",
						paint: {
							"circle-radius": 9,
							"circle-color": "#4338ca",
							"circle-stroke-color": "#ffffff",
							"circle-stroke-width": 3,
						},
					});
				});
				activeMap.on("mouseenter", "tanahpedia-place-points", () => {
					activeMap.getCanvas().style.cursor = "pointer";
				});
				activeMap.on("mouseleave", "tanahpedia-place-points", () => {
					activeMap.getCanvas().style.cursor = "";
				});
				activeMap.on("click", "tanahpedia-place-points", (event) => {
					const index = Number(event.features?.[0]?.properties?.index);
					const group = groups[index];
					if (!group) return;
					const content = document.createElement("div");
					content.className = styles.mapboxPopup;
					content.dir = "rtl";
					for (const marker of group) {
						const place = document.createElement("div");
						place.className = styles.mapboxPlace;
						const title = marker.entryUniqueName
							? document.createElement("a")
							: document.createElement("strong");
						title.textContent = marker.placeName;
						if (title instanceof HTMLAnchorElement) {
							title.href = `/pedia/${encodeURIComponent(marker.entryUniqueName ?? "")}`;
						}
						place.append(title);
						if (marker.modernName) {
							const modernName = document.createElement("span");
							modernName.textContent = marker.modernName;
							place.append(modernName);
						}
						content.append(place);
					}

					popup?.remove();
					popup = new mapboxgl.Popup({ offset: 14, closeOnClick: false })
						.setLngLat([group[0].lng, group[0].lat])
						.setDOMContent(content)
						.addTo(activeMap);
				});

				if (markers.length === 1) {
					activeMap.setCenter([markers[0].lng, markers[0].lat]);
					activeMap.setZoom(12.5);
				} else if (markers.length > 1) {
					const bounds = new mapboxgl.LngLatBounds();
					for (const marker of markers) bounds.extend([marker.lng, marker.lat]);
					activeMap.fitBounds(bounds, {
						padding: 64,
						maxZoom: 12.5,
						duration: 0,
					});
				}
			})
			.catch(() => {
				if (!cancelled) setError(true);
			});

		return () => {
			cancelled = true;
			popup?.remove();
			map?.remove();
		};
	}, [markers]);

	if (error) {
		return (
			<p className={styles.mapError} role="alert">
				לא ניתן לטעון את המפה כרגע. אפשר לעבור לערכי המקומות ברשימה שבהמשך.
			</p>
		);
	}

	return (
		<section
			ref={containerRef}
			className={styles.mapRoot}
			aria-label="מפת מקומות בתנכפדיה"
		/>
	);
}
