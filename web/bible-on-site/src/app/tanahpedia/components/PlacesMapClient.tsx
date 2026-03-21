"use client";

import { useEffect, useRef } from "react";
import type { PlaceMapMarker } from "@/lib/tanahpedia/types";
import "leaflet/dist/leaflet.css";
import styles from "./PlacesMap.module.css";

function escapeHtml(s: string): string {
	return s
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;");
}

export default function PlacesMapClient({ markers }: { markers: PlaceMapMarker[] }) {
	const containerRef = useRef<HTMLDivElement>(null);
	const mapRef = useRef<import("leaflet").Map | null>(null);

	useEffect(() => {
		const el = containerRef.current;
		if (!el) return undefined;

		let cancelled = false;

		void import("leaflet").then((leafletMod) => {
			const L = leafletMod.default ?? leafletMod;
			if (cancelled || !el) return;

			if (mapRef.current) {
				mapRef.current.remove();
				mapRef.current = null;
			}

			const map = L.map(el, { scrollWheelZoom: true }).setView([31.46, 35.25], 8);
			mapRef.current = map;

			L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
				attribution:
					'&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
				maxZoom: 19,
			}).addTo(map);

			const icon = L.divIcon({
				className: styles.markerIconWrap,
				html: `<span class="${styles.markerDot}" aria-hidden="true"></span>`,
				iconSize: [16, 16],
				iconAnchor: [8, 8],
			});

			const latLngs: [number, number][] = [];
			for (const m of markers) {
				latLngs.push([m.lat, m.lng]);
				const primary = escapeHtml(m.placeName);
				const secondary = m.modernName
					? ` <span dir="ltr">(${escapeHtml(m.modernName)})</span>`
					: "";
				const url = m.entryUniqueName
					? `/tanahpedia/entry/${encodeURIComponent(m.entryUniqueName)}`
					: null;
				const inner = url
					? `<a href="${escapeHtml(url)}">${primary}</a>${secondary}`
					: `${primary}${secondary}`;
				L.marker([m.lat, m.lng], { icon })
					.addTo(map)
					.bindPopup(`<div dir="rtl">${inner}</div>`);
			}

			if (latLngs.length === 0) {
				map.setView([31.46, 35.25], 8);
			} else if (latLngs.length === 1) {
				map.setView(latLngs[0], 10);
			} else {
				const bounds = L.latLngBounds(latLngs);
				map.fitBounds(bounds, { padding: [28, 28] });
			}
		});

		return () => {
			cancelled = true;
			if (mapRef.current) {
				mapRef.current.remove();
				mapRef.current = null;
			}
		};
	}, [markers]);

	return <div ref={containerRef} className={styles.mapRoot} role="presentation" />;
}
