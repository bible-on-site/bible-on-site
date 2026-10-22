/**
 * Analytics opt-in consent (#2400, Israeli Privacy Protection Law
 * Amendment 13). Persisted in localStorage like the other user settings;
 * Google Analytics loads only after an explicit "granted". Ahrefs analytics
 * is cookieless and stays unconditional.
 */

export const ANALYTICS_CONSENT_KEY = "analyticsConsent" as const;
export const ANALYTICS_CONSENT_EVENT = "analytics-consent-changed" as const;

export type AnalyticsConsent = "granted" | "denied";

/** Undecided users get null; anything else stored is treated as never asked. */
export function getAnalyticsConsent(): AnalyticsConsent | null {
	/* istanbul ignore next: SSR */
	if (typeof window === "undefined") return null;
	try {
		const raw = localStorage.getItem(ANALYTICS_CONSENT_KEY);
		if (raw === "granted" || raw === "denied") return raw;
		return null;
	} catch {
		return null;
	}
}

export function setAnalyticsConsent(consent: AnalyticsConsent): void {
	try {
		localStorage.setItem(ANALYTICS_CONSENT_KEY, consent);
	} catch {
		/* quota / private mode */
	}
	window.dispatchEvent(new CustomEvent(ANALYTICS_CONSENT_EVENT));
}

/** Forgets the stored answer so the banner asks again (#2400 privacy control). */
export function clearAnalyticsConsent(): void {
	try {
		localStorage.removeItem(ANALYTICS_CONSENT_KEY);
	} catch {
		/* quota / private mode */
	}
	window.dispatchEvent(new CustomEvent(ANALYTICS_CONSENT_EVENT));
}

/**
 * Server snapshot for useSyncExternalStore: a distinct "unset" sentinel so
 * SSR and hydration render no consent-gated markup at all (no banner flash
 * for returning users, no GA scripts before a client-side grant).
 */
export function getAnalyticsConsentServerSnapshot(): "unset" {
	return "unset";
}

export function subscribeAnalyticsConsent(onChange: () => void): () => void {
	// Cross-tab storage events fire for every key; only ours is relevant.
	const onStorage = (event: StorageEvent) => {
		if (event.key === ANALYTICS_CONSENT_KEY) onChange();
	};
	window.addEventListener(ANALYTICS_CONSENT_EVENT, onChange);
	window.addEventListener("storage", onStorage);
	return () => {
		window.removeEventListener(ANALYTICS_CONSENT_EVENT, onChange);
		window.removeEventListener("storage", onStorage);
	};
}
