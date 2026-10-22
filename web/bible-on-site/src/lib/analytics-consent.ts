/** Optional service analytics: informed continued use, with a local opt-out. */
// Deliberately start a fresh preference for the revised rollout (#2400).
// The retired analyticsConsent key is no longer read.
export const ANALYTICS_CONSENT_KEY = "analyticsPreference" as const;
export const ANALYTICS_NOTICE_KEY = "analyticsNoticeSeen" as const;
export const ANALYTICS_CONSENT_EVENT = "analytics-consent-changed" as const;
const NOTICE_VERSION = "2026-10";

export type AnalyticsConsent = "granted" | "denied";
export type AnalyticsStatus = "pending" | "enabled" | "disabled";
let volatileChoice: AnalyticsConsent | null | undefined;
let volatileNoticeSeen = false;

export function getAnalyticsConsent(): AnalyticsConsent | null {
	if (typeof window === "undefined") return null;
	if (volatileChoice !== undefined) return volatileChoice;
	try {
		const raw = localStorage.getItem(ANALYTICS_CONSENT_KEY);
		return raw === "granted" || raw === "denied" ? raw : null;
	} catch {
		return null;
	}
}

export function setAnalyticsConsent(consent: AnalyticsConsent): void {
	try {
		localStorage.setItem(ANALYTICS_CONSENT_KEY, consent);
		volatileChoice = undefined;
	} catch {
		volatileChoice = consent;
	}
	window.dispatchEvent(new CustomEvent(ANALYTICS_CONSENT_EVENT));
}

export function clearAnalyticsConsent(): void {
	volatileNoticeSeen = false;
	try {
		localStorage.removeItem(ANALYTICS_CONSENT_KEY);
		volatileChoice = undefined;
	} catch {
		volatileChoice = null;
	}
	window.dispatchEvent(new CustomEvent(ANALYTICS_CONSENT_EVENT));
}

/** Record continued use separately from an explicit permission. */
export function markAnalyticsNoticeSeen(): void {
	try {
		localStorage.setItem(ANALYTICS_NOTICE_KEY, NOTICE_VERSION);
		volatileNoticeSeen = false;
	} catch {
		volatileNoticeSeen = true;
	}
	window.dispatchEvent(new CustomEvent(ANALYTICS_CONSENT_EVENT));
}

export function getAnalyticsStatus(): AnalyticsStatus {
	const choice = getAnalyticsConsent();
	if (choice === "denied") return "disabled";
	if (choice === "granted" || volatileNoticeSeen) return "enabled";
	try {
		return localStorage.getItem(ANALYTICS_NOTICE_KEY) === NOTICE_VERSION
			? "enabled"
			: "pending";
	} catch {
		return "pending";
	}
}

/** Render the entry disclosure on the initial HTML; never start GA in SSR. */
export function getAnalyticsStatusServerSnapshot(): AnalyticsStatus {
	return "pending";
}

export function getAnalyticsConsentServerSnapshot(): "unset" {
	return "unset";
}

export function subscribeAnalyticsConsent(onChange: () => void): () => void {
	const onStorage = (event: StorageEvent) => {
		if (event.key === null || event.key === ANALYTICS_CONSENT_KEY)
			volatileChoice = undefined;
		if (event.key === null || event.key === ANALYTICS_NOTICE_KEY)
			volatileNoticeSeen = false;
		if (
			event.key === null ||
			event.key === ANALYTICS_CONSENT_KEY ||
			event.key === ANALYTICS_NOTICE_KEY
		)
			onChange();
	};
	window.addEventListener(ANALYTICS_CONSENT_EVENT, onChange);
	window.addEventListener("storage", onStorage);
	return () => {
		window.removeEventListener(ANALYTICS_CONSENT_EVENT, onChange);
		window.removeEventListener("storage", onStorage);
	};
}
