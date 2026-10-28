"use client";

import { useEffect, useState } from "react";
import {
	constructTsetAwareHDate,
	hebcalDateToNumber,
} from "@/util/hebdates-util";
import { LearningCalendar } from "./LearningCalendar";
import styles from "./learning-calendar.module.css";

/** The static shell never bakes a deployment date into navigation or exports. */
export function LiveLearningCalendar({
	pdfManifestUrl,
}: {
	pdfManifestUrl: string;
}) {
	const [today, setToday] = useState<number | null>(null);
	useEffect(() => {
		const refresh = () =>
			setToday(hebcalDateToNumber(constructTsetAwareHDate(new Date())));
		refresh();
		const interval = window.setInterval(refresh, 60_000);
		window.addEventListener("focus", refresh);
		document.addEventListener("visibilitychange", refresh);
		return () => {
			window.clearInterval(interval);
			window.removeEventListener("focus", refresh);
			document.removeEventListener("visibilitychange", refresh);
		};
	}, []);
	if (today === null) {
		return (
			<main className={styles.page}>
				<h1 className={styles.title}>לוח לימוד יומי</h1>
				<p role="status">טוען את הלוח...</p>
			</main>
		);
	}
	return (
		<LearningCalendar
			initialYear={Math.floor(today / 10000)}
			initialMonth={Math.floor(today / 100) % 100}
			todayDateNumber={today}
			pdfManifestUrl={pdfManifestUrl}
		/>
	);
}
