/**
 * Sefer-view perush selection (#2544): which perushim the commentary panel
 * shows. The user's selection is the Tanach-wide default; a sefer may carry
 * an explicit override that takes over for that sefer alone until it is
 * cleared back to inheriting.
 *
 * Stored ids are stable perush identities (the `id` from PerushSummary), not
 * names — a name edit in the catalog must not silently drop a selection.
 * A stored id absent from the current perek's eligible perushim stays saved:
 * availability only filters what renders, never what is remembered.
 *
 * Precedence (resolved per perek): explicit perush deep link > sefer
 * override > global default. Visiting a deep link never rewrites storage.
 */

export const SEFER_PERUSH_SELECTION_STORAGE_KEY =
	"seferPerushSelection" as const;
export const SEFER_PERUSH_SELECTION_VERSION = 1;

export interface SeferPerushSelection {
	/** Tanach-wide default perush ids. */
	global: number[];
	/** Per-sefer overrides keyed by sefer name; absent = inherit global. */
	sefer: Record<string, number[]>;
	v: number;
}

export const DEFAULT_SEFER_PERUSH_SELECTION: SeferPerushSelection = {
	global: [],
	sefer: {},
	v: SEFER_PERUSH_SELECTION_VERSION,
};

function normalizeIds(raw: unknown): number[] {
	if (!Array.isArray(raw)) return [];
	const seen = new Set<number>();
	for (const item of raw) {
		if (typeof item === "number" && Number.isInteger(item) && item > 0) {
			seen.add(item);
		}
	}
	return [...seen];
}

function normalizeSelection(raw: unknown): SeferPerushSelection {
	const candidate = (raw ?? {}) as Partial<SeferPerushSelection>;
	const sefer: Record<string, number[]> = {};
	if (candidate.sefer != null && typeof candidate.sefer === "object") {
		for (const [name, ids] of Object.entries(candidate.sefer)) {
			// A non-array entry is corruption, not an empty override — drop it.
			if (typeof name === "string" && name.length > 0 && Array.isArray(ids)) {
				sefer[name] = normalizeIds(ids);
			}
		}
	}
	return {
		global: normalizeIds(candidate.global),
		sefer,
		v: SEFER_PERUSH_SELECTION_VERSION,
	};
}

export function getStoredSeferPerushSelection(): SeferPerushSelection {
	/* istanbul ignore next: SSR */
	if (typeof window === "undefined") return DEFAULT_SEFER_PERUSH_SELECTION;
	try {
		const stored = JSON.parse(
			localStorage.getItem(SEFER_PERUSH_SELECTION_STORAGE_KEY) ?? "null",
		);
		// A missing/older/corrupt payload normalizes to defaults — never throws.
		return normalizeSelection(stored);
	} catch {
		return DEFAULT_SEFER_PERUSH_SELECTION;
	}
}

/** Same-tab broadcast so open readers reflect a selection change. */
export const SEFER_PERUSH_SELECTION_EVENT = "sefer-perush-selection-changed";

function writeSelection(next: SeferPerushSelection): void {
	try {
		localStorage.setItem(
			SEFER_PERUSH_SELECTION_STORAGE_KEY,
			JSON.stringify(next),
		);
	} catch {
		/* quota / private mode */
	}
	/* istanbul ignore next: SSR has no window; callers are client-only */
	if (typeof window !== "undefined") {
		window.dispatchEvent(
			new CustomEvent<SeferPerushSelection>(SEFER_PERUSH_SELECTION_EVENT, {
				detail: next,
			}),
		);
	}
}

/** Whether a sefer carries an explicit override (vs inheriting the default). */
export function hasSeferPerushOverride(seferName: string): boolean {
	return seferName in getStoredSeferPerushSelection().sefer;
}

/**
 * The effective selection for a sefer: its override when present, else the
 * global default. Returns the stored ids verbatim — availability filtering
 * is the renderer's job.
 */
export function resolveSeferPerushSelection(seferName: string): {
	ids: number[];
	isOverride: boolean;
} {
	const stored = getStoredSeferPerushSelection();
	if (seferName in stored.sefer) {
		return { ids: stored.sefer[seferName], isOverride: true };
	}
	return { ids: stored.global, isOverride: false };
}

/**
 * Writes the current sefer's selection. While the sefer inherits, a change
 * updates the shared global default (one selection follows the user across
 * the Tanach); once overridden, changes stay scoped to that sefer.
 */
export function setSeferPerushSelection(
	seferName: string,
	ids: number[],
): void {
	const stored = getStoredSeferPerushSelection();
	const normalized = normalizeIds(ids);
	if (seferName in stored.sefer) {
		stored.sefer[seferName] = normalized;
	} else {
		stored.global = normalized;
	}
	writeSelection(stored);
}

/** Pins the sefer to its own list, detaching it from the global default. */
export function setSeferPerushOverride(seferName: string, ids: number[]): void {
	const stored = getStoredSeferPerushSelection();
	stored.sefer[seferName] = normalizeIds(ids);
	writeSelection(stored);
}

/** Returns the sefer to inheriting the global default. */
export function clearSeferPerushOverride(seferName: string): void {
	const stored = getStoredSeferPerushSelection();
	if (!(seferName in stored.sefer)) return;
	delete stored.sefer[seferName];
	writeSelection(stored);
}
