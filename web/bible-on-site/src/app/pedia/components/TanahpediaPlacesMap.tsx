"use client";

import dynamic from "next/dynamic";
import type { PlaceMapMarker } from "@/lib/tanahpedia/types";
import styles from "../page.module.css";

const hasMapboxToken = Boolean(process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN);

const PlacesMapClient = dynamic(
	() =>
		hasMapboxToken
			? import("./MapboxPlacesMapClient")
			: import("./PlacesMapClient"),
	{
		ssr: false,
		loading: () => (
			<output className={styles.mapLoading} aria-live="polite">
				טוען מפה…
			</output>
		),
	},
);

export function TanahpediaPlacesMap({
	markers,
}: {
	markers: PlaceMapMarker[];
}) {
	return (
		<div className={styles.mapSection}>
			<PlacesMapClient markers={markers} />
			<p className={styles.mapFootnote}>
				תנ"ך על הפרק משתמשים בספק מפות חיצוני. ארץ ישראל שייכת לעם ישראל וכל
				תיוג או קו במפה הסותר זאת אינו על דעתנו והוא מאולץ בלבד
			</p>
		</div>
	);
}
