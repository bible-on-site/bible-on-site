/**
 * Perek reader settings (font size, horizontal and vertical spacing).
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
export const PEREK_WORD_SPACINGS = [0.12, 0.2, 0.28, 0.36, 0.44] as const;

/**
 * Tanakh font choices applied to the perek text. Index 0 is the default
 * (Taamey D — no `data-tanakh-font` attribute); index 1 opts out to
 * Noto Serif Hebrew. Applied as `data-tanakh-font` on <html>, which CSS
 * selectors match.
 */
export const PEREK_TANAKH_FONTS = ["", "noto"] as const;

/**
 * Storage schema version. v1 indexed fonts as [0=default(Noto), 1=taamey];
 * after Taamey became the default both meanings resolve to index 0, so v1
 * payloads are migrated rather than reinterpreted as an opt-out.
 */
export const READER_SETTINGS_VERSION = 2;

export type ReaderSettings = {
	/** Index into PEREK_FONT_SCALES. */
	fontStep: number;
	/** Index into PEREK_LINE_HEIGHTS. */
	lineStep: number;
	wordStep: number;
	/** Index into PEREK_TANAKH_FONTS. */
	fontId: number;
	/** Storage schema version; see READER_SETTINGS_VERSION. */
	v: number;
};

export const DEFAULT_READER_SETTINGS: ReaderSettings = {
	fontStep: PEREK_FONT_SCALES.indexOf(1),
	lineStep: 0,
	wordStep: 0,
	fontId: 0,
	v: READER_SETTINGS_VERSION,
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
		wordStep:
			candidate.wordStep == null
				? 0
				: clampStep(candidate.wordStep, PEREK_WORD_SPACINGS.length - 1),
		fontId:
			candidate.fontId == null
				? DEFAULT_READER_SETTINGS.fontId
				: clampStep(candidate.fontId, PEREK_TANAKH_FONTS.length - 1),
		v: READER_SETTINGS_VERSION,
	};
}

export function getStoredReaderSettings(): ReaderSettings {
	/* istanbul ignore next: SSR */
	if (typeof window === "undefined") return DEFAULT_READER_SETTINGS;
	try {
		const stored = JSON.parse(
			localStorage.getItem(READER_SETTINGS_STORAGE_KEY) ?? "null",
		);
		// v1 fontId semantics predate the Taamey default; collapse to default
		// so experiment opt-ins keep Taamey and nobody flips to an opt-out.
		const migrated =
			stored?.v === READER_SETTINGS_VERSION ? stored : { ...stored, fontId: 0 };
		return normalizeSettings(migrated);
	} catch {
		return DEFAULT_READER_SETTINGS;
	}
}

export function setStoredReaderSettings(
	settings: Partial<ReaderSettings>,
): void {
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
	settings: Partial<ReaderSettings>,
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
	root.style.setProperty(
		"--perek-word-spacing",
		`${PEREK_WORD_SPACINGS[normalized.wordStep]}em`,
	);
	const tanakhFont = PEREK_TANAKH_FONTS[normalized.fontId];
	if (tanakhFont) root.dataset.tanakhFont = tanakhFont;
	else delete root.dataset.tanakhFont;
}

/**
 * Inline bootstrap that re-applies stored settings before first paint so
 * returning readers see no font-size / line-height flash. Rendered as a raw
 * <script> in the root layout's head, including visits that reach the reader
 * through client-side navigation; kept dependency-free on purpose.
 *
 * Deliberately a static literal: building this string by interpolating the
 * constants above trips static-analysis code-construction rules, so the
 * storage key, arrays and default indices are duplicated here verbatim. The
 * reader-settings unit test asserts they stay in sync.
 */
export const READER_SETTINGS_BOOTSTRAP = `(function(){try{var s=JSON.parse(localStorage.getItem("perekReaderSettings")||"null")||{};var f=[0.85,0.92,1,1.15,1.3],l=[1.5,1.75,2],w=[0.12,0.2,0.28,0.36,0.44],tf=["","noto"];function c(v,m){return typeof v==="number"&&isFinite(v)?Math.min(Math.max(Math.round(v),0),m):0}var e=document.documentElement;e.style.setProperty("--perek-font-scale",String(f[s.fontStep==null?2:c(s.fontStep,f.length-1)]));e.style.setProperty("--perek-line-height",String(l[s.lineStep==null?0:c(s.lineStep,l.length-1)]));e.style.setProperty("--perek-word-spacing",String(w[s.wordStep==null?0:c(s.wordStep,w.length-1)])+"em");var t=tf[s.v===2&&s.fontId!=null?c(s.fontId,tf.length-1):0];if(t){e.dataset.tanakhFont=t}else{delete e.dataset.tanakhFont}}catch(e){}})();`;
