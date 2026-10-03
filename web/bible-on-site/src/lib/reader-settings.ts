/**
 * Perek reader settings (font size, line spacing).
 *
 * Persisted in localStorage and applied as CSS custom properties on
 * <html>, so both the basic view (.perekText in page.module.css) and the
 * sefer/book view (.perekText in sefer.module.css) pick them up through
 * normal var() lookups.
 */

export const READER_SETTINGS_STORAGE_KEY = "perekReaderSettings" as const;

/** Font-size scale steps applied to the perek text (5 levels, default = 1). */
export const PEREK_FONT_SCALES = [0.85, 0.92, 1, 1.15, 1.3] as const;

/** Line-height steps applied to the perek text (3 levels, default = 1.5). */
export const PEREK_LINE_HEIGHTS = [1.5, 1.75, 2] as const;

export type ReaderSettings = {
	/** Index into PEREK_FONT_SCALES. */
	fontStep: number;
	/** Index into PEREK_LINE_HEIGHTS. */
	lineStep: number;
};

export const DEFAULT_READER_SETTINGS: ReaderSettings = {
	fontStep: PEREK_FONT_SCALES.indexOf(1),
	lineStep: 0,
};

const clampStep = (value: number, max: number) =>
	Number.isFinite(value) ? Math.min(Math.max(Math.round(value), 0), max) : 0;

function normalizeSettings(raw: unknown): ReaderSettings {
	const candidate = (raw ?? {}) as Partial<ReaderSettings>;
	return {
		fontStep:
			candidate.fontStep == null
				? DEFAULT_READER_SETTINGS.fontStep
				: clampStep(candidate.fontStep, PEREK_FONT_SCALES.length - 1),
		lineStep:
			candidate.lineStep == null
				? DEFAULT_READER_SETTINGS.lineStep
				: clampStep(candidate.lineStep, PEREK_LINE_HEIGHTS.length - 1),
	};
}

export function getStoredReaderSettings(): ReaderSettings {
	/* istanbul ignore next: SSR */
	if (typeof window === "undefined") return DEFAULT_READER_SETTINGS;
	try {
		return normalizeSettings(
			JSON.parse(localStorage.getItem(READER_SETTINGS_STORAGE_KEY) ?? "null"),
		);
	} catch {
		return DEFAULT_READER_SETTINGS;
	}
}

export function setStoredReaderSettings(settings: ReaderSettings): void {
	try {
		localStorage.setItem(
			READER_SETTINGS_STORAGE_KEY,
			JSON.stringify(normalizeSettings(settings)),
		);
	} catch {
		/* quota / private mode */
	}
}

/** Apply the settings as CSS variables on the document root. */
export function applyReaderSettings(
	settings: ReaderSettings,
	root: HTMLElement = document.documentElement,
): void {
	const normalized = normalizeSettings(settings);
	root.style.setProperty(
		"--perek-font-scale",
		String(PEREK_FONT_SCALES[normalized.fontStep]),
	);
	root.style.setProperty(
		"--perek-line-height",
		String(PEREK_LINE_HEIGHTS[normalized.lineStep]),
	);
}

/**
 * Inline bootstrap that re-applies stored settings before first paint so
 * returning readers see no font-size / line-height flash. Rendered as a raw
 * <script> at the top of the perek layout; kept dependency-free on purpose.
 */
export const READER_SETTINGS_BOOTSTRAP = `(function(){try{var s=JSON.parse(localStorage.getItem(${JSON.stringify(READER_SETTINGS_STORAGE_KEY)})||"null")||{};var f=${JSON.stringify(PEREK_FONT_SCALES)},l=${JSON.stringify(PEREK_LINE_HEIGHTS)};function c(v,m){return isFinite(v)?Math.min(Math.max(Math.round(v),0),m):0}var e=document.documentElement;e.style.setProperty("--perek-font-scale",String(f[s.fontStep==null?${DEFAULT_READER_SETTINGS.fontStep}:c(s.fontStep,f.length-1)]));e.style.setProperty("--perek-line-height",String(l[s.lineStep==null?${DEFAULT_READER_SETTINGS.lineStep}:c(s.lineStep,l.length-1)]))}catch(e){}})();`;
