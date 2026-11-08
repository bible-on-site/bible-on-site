/**
 * Perek reader settings (font size, horizontal and vertical spacing).
 *
 * Persisted in localStorage and applied as CSS custom properties on
 * <html>, so both the basic view (.perekText in page.module.css) and the
 * sefer/book view (.perekText in sefer.module.css) pick them up through
 * normal var() lookups.
 */

export const READER_SETTINGS_STORAGE_KEY = "perekReaderSettings" as const;

/**
 * Font-size scale steps applied to the perek text (default = 1).
 * #2405: extended to 200% — new steps are appended so stored indices keep
 * meaning the same scale (index 4 is still 130%).
 */
export const PEREK_FONT_SCALES = [
	0.85, 0.92, 1, 1.15, 1.3, 1.5, 1.7, 2,
] as const;

/**
 * Line-height and word-spacing steps applied to the perek text (5 levels
 * each). The controls display `step + 1`, so the default index 2 is shown as
 * level 3. Appending steps keeps stored indices meaning the same spacing.
 */
export const PEREK_LINE_HEIGHTS = [1.5, 1.75, 2, 2.25, 2.5] as const;
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
	lineStep: 2,
	wordStep: 2,
	fontId: 0,
	v: READER_SETTINGS_VERSION,
};

const clampStep = (value: number, max: number, fallback = 0) =>
	Number.isFinite(value)
		? Math.min(Math.max(Math.round(value), 0), max)
		: fallback;

function normalizeSettings(raw: unknown): ReaderSettings {
	const candidate = (raw ?? {}) as Partial<ReaderSettings>;
	return {
		fontStep:
			candidate.fontStep == null
				? DEFAULT_READER_SETTINGS.fontStep
				: clampStep(
						candidate.fontStep,
						PEREK_FONT_SCALES.length - 1,
						DEFAULT_READER_SETTINGS.fontStep,
					),
		lineStep:
			candidate.lineStep == null
				? DEFAULT_READER_SETTINGS.lineStep
				: clampStep(
						candidate.lineStep,
						PEREK_LINE_HEIGHTS.length - 1,
						DEFAULT_READER_SETTINGS.lineStep,
					),
		wordStep:
			candidate.wordStep == null
				? DEFAULT_READER_SETTINGS.wordStep
				: clampStep(
						candidate.wordStep,
						PEREK_WORD_SPACINGS.length - 1,
						DEFAULT_READER_SETTINGS.wordStep,
					),
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

/**
 * Same-tab change broadcast, mirroring RECITATION_SETTINGS_EVENT — writers
 * other than the reader settings dialog (the top-nav accessibility menu)
 * dispatch through this so every open control reflects the same values.
 */
export const READER_SETTINGS_EVENT = "reader-settings-changed";

export function setStoredReaderSettings(
	settings: Partial<ReaderSettings>,
): void {
	const next = normalizeSettings(settings);
	try {
		localStorage.setItem(READER_SETTINGS_STORAGE_KEY, JSON.stringify(next));
	} catch {
		/* quota / private mode */
	}
	/* istanbul ignore next: SSR has no window; callers are client-only */
	if (typeof window !== "undefined")
		window.dispatchEvent(
			new CustomEvent<ReaderSettings>(READER_SETTINGS_EVENT, {
				detail: next,
			}),
		);
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
export const READER_SETTINGS_BOOTSTRAP = `(function(){try{var s=JSON.parse(localStorage.getItem("perekReaderSettings")||"null")||{};var f=[0.85,0.92,1,1.15,1.3,1.5,1.7,2],l=[1.5,1.75,2,2.25,2.5],w=[0.12,0.2,0.28,0.36,0.44],tf=["","noto"];function c(v,m,d){return typeof v==="number"&&isFinite(v)?Math.min(Math.max(Math.round(v),0),m):d}var e=document.documentElement;e.style.setProperty("--perek-font-scale",String(f[c(s.fontStep,f.length-1,2)]));e.style.setProperty("--perek-line-height",String(l[c(s.lineStep,l.length-1,2)]));e.style.setProperty("--perek-word-spacing",String(w[c(s.wordStep,w.length-1,2)])+"em");var t=tf[s.v===2&&s.fontId!=null?c(s.fontId,tf.length-1,0):0];if(t){e.dataset.tanakhFont=t}else{delete e.dataset.tanakhFont}}catch(e){}})();`;
