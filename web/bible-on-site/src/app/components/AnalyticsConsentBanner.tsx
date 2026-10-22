"use client";

import Link from "next/link";
import { useSyncExternalStore } from "react";
import {
	getAnalyticsConsent,
	getAnalyticsConsentServerSnapshot,
	setAnalyticsConsent,
	subscribeAnalyticsConsent,
} from "@/lib/analytics-consent";
import { isProduction } from "@/util/environment";
import styles from "./AnalyticsConsentBanner.module.css";

/**
 * One-time analytics opt-in strip (#2400). Shows only on production while the
 * user has not answered; both choices persist and the banner never re-asks.
 * Ahrefs stays unconditional (cookieless); only GA4 is gated here.
 */
export function AnalyticsConsentBanner() {
	const consent = useSyncExternalStore(
		subscribeAnalyticsConsent,
		getAnalyticsConsent,
		getAnalyticsConsentServerSnapshot,
	);
	if (!isProduction() || consent !== null) {
		return null;
	}
	return (
		<section className={styles.banner} aria-label="הסכמה לאנליטיקה">
			<p className={styles.text}>
				סליחה על ההפרעה! נתוני שימוש עוזרים לנו לשפר את חוויית הלימוד היומי
				ומועברים לשירותי הניתוח של גוגל.{" "}
				<Link href="/#privacyPolicy" className={styles.link}>
					מדיניות הפרטיות
				</Link>
			</p>
			<div className={styles.actions}>
				<button
					type="button"
					className={styles.accept}
					onClick={() => setAnalyticsConsent("granted")}
				>
					מאשר
				</button>
				<button
					type="button"
					className={styles.deny}
					onClick={() => setAnalyticsConsent("denied")}
				>
					לא תודה
				</button>
			</div>
		</section>
	);
}
