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
				אריחי OpenStreetMap — ללא מפתח API. האתר אינו מוסיף שכבת גבולות
				מדומיינית; סמנים מייצגים ייחוס גאוגרפי לערכים בלבד. ארץ ישראל לפי
				התורה שייכת לעם ישראל. תיוג וקווים שעלולים להופיע על אריחי OSM אינם
				מחייבים את האתר — ר׳{" "}
				<code className={styles.mapCode}>docs/tanahpedia/places-map-plan.md</code>.
			</p>
			<PlacesMapClient markers={markers} />
		</div>
	);
}
