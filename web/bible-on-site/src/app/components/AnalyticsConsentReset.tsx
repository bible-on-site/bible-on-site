"use client";

import { useSyncExternalStore } from "react";
import {
	getAnalyticsStatus,
	getAnalyticsStatusServerSnapshot,
	setAnalyticsConsent,
	subscribeAnalyticsConsent,
} from "@/lib/analytics-consent";
import { isProduction } from "@/util/environment";
import styles from "./TosSection.module.css";

/** A direct, persistent measurement control; never reopens an approval dialog. */
export function AnalyticsConsentReset() {
	const status = useSyncExternalStore(
		subscribeAnalyticsConsent,
		getAnalyticsStatus,
		getAnalyticsStatusServerSnapshot,
	);
	if (!isProduction()) return null;
	return (
		<p>
			מדידת שימוש ב-Google Analytics באתר:{" "}
			{status === "enabled" ? "פעילה" : "כבויה"}.{" "}
			<button
				type="button"
				className={styles.consentReset}
				onClick={() =>
					setAnalyticsConsent(status === "enabled" ? "denied" : "granted")
				}
			>
				{status === "enabled" ? "כיבוי מדידה" : "הפעלת מדידה"}
			</button>
		</p>
	);
}
