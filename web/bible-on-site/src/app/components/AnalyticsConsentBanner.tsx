"use client";

import Link from "next/link";
import { useEffect, useSyncExternalStore } from "react";
import {
	getAnalyticsStatus,
	getAnalyticsStatusServerSnapshot,
	markAnalyticsNoticeSeen,
	setAnalyticsConsent,
	subscribeAnalyticsConsent,
} from "@/lib/analytics-consent";
import { isProduction } from "@/util/environment";
import styles from "./AnalyticsConsentBanner.module.css";

/** Entry disclosure, without an approval prompt or a learning interruption. */
export function AnalyticsConsentBanner() {
	const status = useSyncExternalStore(
		subscribeAnalyticsConsent,
		getAnalyticsStatus,
		getAnalyticsStatusServerSnapshot,
	);
	useEffect(() => {
		if (!isProduction() || status !== "pending") return;
		const onContinue = (event: Event) => {
			if (!event.isTrusted || !(event.target instanceof Element)) return;
			// Reading the policy or using its controls is not continued learning.
			if (
				event.target.closest(
					'[data-analytics-notice], #privacyPolicy, a[href*="privacyPolicy"]',
				)
			)
				return;
			markAnalyticsNoticeSeen();
		};
		document.addEventListener("click", onContinue);
		document.addEventListener("wheel", onContinue, { passive: true });
		document.addEventListener("touchmove", onContinue, { passive: true });
		return () => {
			document.removeEventListener("click", onContinue);
			document.removeEventListener("wheel", onContinue);
			document.removeEventListener("touchmove", onContinue);
		};
	}, [status]);
	if (!isProduction() || status !== "pending") return null;
	return (
		<section
			className={styles.banner}
			aria-label="מידע על מדידת שימוש"
			data-analytics-notice
			data-nosnippet
		>
			<p className={styles.text}>
				נתוני שימוש נמסרים לשירותי מדידה כדי לשפר את הלימוד. המשך השימוש מאפשר
				מדידה.{" "}
				<Link
					href="/#privacyPolicy"
					rel="privacy-policy"
					className={styles.link}
				>
					פרטים ופרטיות
				</Link>
			</p>
			<button
				type="button"
				className={styles.deny}
				onClick={() => setAnalyticsConsent("denied")}
			>
				כיבוי מדידה
			</button>
			<button
				type="button"
				className={styles.dismiss}
				aria-label="סגירת ההודעה"
				onClick={markAnalyticsNoticeSeen}
			>
				×
			</button>
		</section>
	);
}
