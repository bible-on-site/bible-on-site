"use client";

import { useSyncExternalStore } from "react";
import {
	clearAnalyticsConsent,
	getAnalyticsConsent,
	getAnalyticsConsentServerSnapshot,
	subscribeAnalyticsConsent,
} from "@/lib/analytics-consent";
import { isProduction } from "@/util/environment";
import styles from "./TosSection.module.css";

/**
 * Discoverable way to change the analytics answer after the banner is gone
 * (#2400): shows the stored choice inside the privacy policy and forgets it
 * on click, which makes the consent banner ask again.
 */
export function AnalyticsConsentReset() {
	const consent = useSyncExternalStore(
		subscribeAnalyticsConsent,
		getAnalyticsConsent,
		getAnalyticsConsentServerSnapshot,
	);
	if (!isProduction() || (consent !== "granted" && consent !== "denied")) {
		return null;
	}
	return (
		<p>
			בחירת האנליטיקה הנוכחית באתר זה:{" "}
			{consent === "granted" ? "מאושרת" : "נדחתה"}.{" "}
			<button
				type="button"
				className={styles.consentReset}
				onClick={() => clearAnalyticsConsent()}
			>
				לחצו כאן לשינוי הבחירה
			</button>
		</p>
	);
}
