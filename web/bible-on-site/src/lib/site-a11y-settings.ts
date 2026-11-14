/**
 * Site-wide accessibility preferences (issue #2767): ניגודיות גבוהה
 * (high-contrast palette) and קו תחתון לקישורים (persistent underline on
 * textual links).
 *
 * These are deliberately NOT fields of `perekReaderSettings`: the
 * reader-settings normalizer rebuilds a fixed {fontStep, lineStep, wordStep,
 * fontId} schema, so global preferences stored there would be silently
 * dropped by the הגדרות קריאה dialog's next write. This module owns its own
 * storage key, normalizer, change event and pre-paint bootstrap.
 *
 * Persisted in localStorage and applied as `data-a11y-contrast` /
 * `data-a11y-links` attributes on <html>; the palette and underline rules
 * live in globals.css so portals, dynamically rendered content and CSS
 * modules all resolve the same root attributes.
 */

export const SITE_A11Y_STORAGE_KEY = "siteA11ySettings" as const;

/** Storage schema version — bump when stored field semantics change. */
export const SITE_A11Y_VERSION = 1;

/** Attribute values consumed by globals.css. */
export const A11Y_CONTRAST_HIGH = "high" as const;
export const A11Y_LINKS_UNDERLINED = "underlined" as const;

export type SiteA11ySettings = {
	/** High-contrast coordinated palette (data-a11y-contrast="high"). */
	contrast: boolean;
	/** Persistent underline on textual links (data-a11y-links="underlined"). */
	links: boolean;
	/** Storage schema version; see SITE_A11Y_VERSION. */
	v: number;
};

export const DEFAULT_SITE_A11Y_SETTINGS: SiteA11ySettings = {
	contrast: false,
	links: false,
	v: SITE_A11Y_VERSION,
};

function normalizeSettings(raw: unknown): SiteA11ySettings {
	const candidate = (raw ?? {}) as Partial<SiteA11ySettings>;
	return {
		contrast: candidate.contrast === true,
		links: candidate.links === true,
		v: SITE_A11Y_VERSION,
	};
}

export function getStoredSiteA11ySettings(): SiteA11ySettings {
	/* istanbul ignore next: SSR */
	if (typeof window === "undefined") return DEFAULT_SITE_A11Y_SETTINGS;
	try {
		return normalizeSettings(
			JSON.parse(localStorage.getItem(SITE_A11Y_STORAGE_KEY) ?? "null"),
		);
	} catch {
		return DEFAULT_SITE_A11Y_SETTINGS;
	}
}

/**
 * Same-tab change broadcast, mirroring READER_SETTINGS_EVENT — every open
 * control reflects the same values (the menu is currently the only writer,
 * but the contract keeps future writers honest).
 */
export const SITE_A11Y_EVENT = "site-a11y-settings-changed";

export function setStoredSiteA11ySettings(
	settings: Partial<SiteA11ySettings>,
): void {
	const next = normalizeSettings(settings);
	try {
		localStorage.setItem(SITE_A11Y_STORAGE_KEY, JSON.stringify(next));
	} catch {
		/* quota / private mode */
	}
	/* istanbul ignore next: SSR has no window; callers are client-only */
	if (typeof window !== "undefined")
		window.dispatchEvent(
			new CustomEvent<SiteA11ySettings>(SITE_A11Y_EVENT, { detail: next }),
		);
}

/**
 * Apply the preferences as data attributes on the document root. Both
 * attributes are removed (not set to a negative value) when disabled so the
 * default stylesheet keeps full ownership of the baseline presentation.
 */
export function applySiteA11ySettings(
	settings: Partial<SiteA11ySettings>,
	root: HTMLElement = document.documentElement,
): void {
	const normalized = normalizeSettings(settings);
	if (normalized.contrast) root.dataset.a11yContrast = A11Y_CONTRAST_HIGH;
	else delete root.dataset.a11yContrast;
	if (normalized.links) root.dataset.a11yLinks = A11Y_LINKS_UNDERLINED;
	else delete root.dataset.a11yLinks;
}

/**
 * Inline bootstrap that re-applies stored preferences before first paint so
 * returning users see no palette/underline flash — same pattern as
 * READER_SETTINGS_BOOTSTRAP and rendered alongside it in the root layout's
 * head, including client-side navigation. Kept dependency-free on purpose.
 *
 * Deliberately a static literal: interpolating the constants above trips
 * static-analysis code-construction rules, so the storage key and attribute
 * names/values are duplicated here verbatim. The site-a11y-settings unit
 * test asserts they stay in sync.
 */
export const SITE_A11Y_BOOTSTRAP = `(function(){try{var s=JSON.parse(localStorage.getItem("siteA11ySettings")||"null")||{};var e=document.documentElement;if(s.contrast===true){e.dataset.a11yContrast="high"}else{delete e.dataset.a11yContrast}if(s.links===true){e.dataset.a11yLinks="underlined"}else{delete e.dataset.a11yLinks}}catch(e){}})();`;
