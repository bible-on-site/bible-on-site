"use client";

import dynamic from "next/dynamic";
import type { PlaceMapMarker } from "@/lib/tanahpedia/types";
import styles from "../page.module.css";

const PlacesMapClient = dynamic(() => import("./PlacesMapClient"), {
	ssr: false,
	loading: () => (
		<output className={styles.mapLoading} aria-live="polite">
			טוען מפה…
		</output>
	),
});

export function TanahpediaPlacesMap({ markers }: { markers: PlaceMapMarker[] }) {
	return (
		<div className={styles.mapSection}>
			<p className={styles.mapFootnote}>
				מקור אריחים: OpenStreetMap (ללא מפתח API). תצוגת גבולות מדיניים
				(יהודה ושומרון, עזה וכו׳) — ר׳ תוכנית בקובץ{" "}
				<code className={styles.mapCode}>docs/tanahpedia/places-map-plan.md</code>{" "}
				במאגר.
			</p>
			<PlacesMapClient markers={markers} />
		</div>
	);
}
