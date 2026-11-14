/**
 * Persisted הסתר שם השם (divine-name masking) preferences.
 *
 * Stored under its own localStorage key — separate from READER_SETTINGS —
 * because the values feed text rendering rather than CSS, and changes are
 * pushed to open readers through DIVINE_NAME_MASKING_EVENT instead of a
 * page reload. Mirrors the app's PreferencesService keys.
 */
import {
	DEFAULT_DIVINE_NAME_MASKING,
	type DivineNameMaskingSettings,
	type ElMaskOption,
	type ElohimMaskOption,
	type ShaddaiMaskOption,
	type YhwhMaskOption,
} from "./divine-name-masking";

export const DIVINE_NAME_MASKING_KEY = "divineNameMasking";
export const DIVINE_NAME_MASKING_EVENT = "divine-name-masking-changed";

const ELOHIM_OPTIONS: readonly ElohimMaskOption[] = [
	"asis",
	"elokim",
	"hyphen",
	"custom",
];
const YHWH_OPTIONS: readonly YhwhMaskOption[] = ["heh", "dalet", "custom"];
const EL_OPTIONS: readonly ElMaskOption[] = ["asis", "hyphen"];
const SHADDAI_OPTIONS: readonly ShaddaiMaskOption[] = [
	"asis",
	"hyphen",
	"custom",
];

const pick = <T extends string>(
	value: unknown,
	allowed: readonly T[],
	fallback: T,
): T => (allowed.includes(value as T) ? (value as T) : fallback);

/** Long enough for a phrase, short enough to keep pasuk layout sane. */
const MAX_CUSTOM_LENGTH = 40;
const custom = (value: unknown): string =>
	typeof value === "string" ? value.trim().slice(0, MAX_CUSTOM_LENGTH) : "";

export function normalizeDivineNameMasking(
	raw: unknown,
): DivineNameMaskingSettings {
	const s = (raw ?? {}) as Partial<DivineNameMaskingSettings>;
	return {
		// Only a stored boolean is honored; missing/invalid falls back to the
		// default (enabled per #2404), same convention as pick() below.
		enabled:
			typeof s.enabled === "boolean"
				? s.enabled
				: DEFAULT_DIVINE_NAME_MASKING.enabled,
		elohim: pick(s.elohim, ELOHIM_OPTIONS, DEFAULT_DIVINE_NAME_MASKING.elohim),
		elohimCustom: custom(s.elohimCustom),
		yhwh: pick(s.yhwh, YHWH_OPTIONS, DEFAULT_DIVINE_NAME_MASKING.yhwh),
		yhwhCustom: custom(s.yhwhCustom),
		el: pick(s.el, EL_OPTIONS, DEFAULT_DIVINE_NAME_MASKING.el),
		shaddai: pick(
			s.shaddai,
			SHADDAI_OPTIONS,
			DEFAULT_DIVINE_NAME_MASKING.shaddai,
		),
		shaddaiCustom: custom(s.shaddaiCustom),
	};
}

export function getDivineNameMaskingSettings(): DivineNameMaskingSettings {
	try {
		return normalizeDivineNameMasking(
			JSON.parse(localStorage.getItem(DIVINE_NAME_MASKING_KEY) ?? "null"),
		);
	} catch {
		return DEFAULT_DIVINE_NAME_MASKING;
	}
}

/**
 * Cached snapshot for useSyncExternalStore: the same object is returned
 * until a save/storage event swaps it, which is exactly the stability
 * getSnapshot requires.
 */
let snapshot: DivineNameMaskingSettings | null = null;

/**
 * Active external-store subscribers. One pair of window listeners fans out
 * to every subscriber: a reader page holds hundreds of DivineNameText
 * components, and the flip book's leaf buffer mounts/unmounts pages on
 * every turn, so per-component window listeners churned hundreds of
 * add/removeEventListener calls per flip (#2805). The cache can only go
 * stale while nobody is listening — a cross-tab storage write needs a
 * storage event listener to reach this tab's cache — so the first
 * subscriber after a silent stretch re-syncs before anyone renders the
 * stale value.
 */
const listeners = new Set<() => void>();

const divineNameMaskingSettingsEqual = (
	a: DivineNameMaskingSettings,
	b: DivineNameMaskingSettings,
): boolean =>
	(Object.keys(a) as (keyof DivineNameMaskingSettings)[]).every(
		(key) => a[key] === b[key],
	);

export function saveDivineNameMaskingSettings(
	settings: DivineNameMaskingSettings,
): void {
	const next = normalizeDivineNameMasking(settings);
	try {
		localStorage.setItem(DIVINE_NAME_MASKING_KEY, JSON.stringify(next));
	} catch {
		/* Private mode. */
	}
	snapshot = next;
	window.dispatchEvent(
		new CustomEvent(DIVINE_NAME_MASKING_EVENT, { detail: next }),
	);
}

export function getDivineNameMaskingSnapshot(): DivineNameMaskingSettings {
	if (!snapshot) snapshot = getDivineNameMaskingSettings();
	return snapshot;
}

/* istanbul ignore next: SSR renders the default masking — the same output a
   fresh client produces, so hydration agrees without a settings read. */
export function getDivineNameMaskingServerSnapshot(): DivineNameMaskingSettings {
	return DEFAULT_DIVINE_NAME_MASKING;
}

const notifyListeners = () => {
	snapshot = getDivineNameMaskingSettings();
	for (const listener of listeners) listener();
};

// Cross-tab storage events fire for every key — only ours is relevant, so
// unrelated preference writes in another tab don't refresh every segment.
const onStorage = (event: StorageEvent) => {
	if (event.key === DIVINE_NAME_MASKING_KEY) notifyListeners();
};

export function subscribeDivineNameMasking(onChange: () => void): () => void {
	// First listener after a silent stretch: install the shared window
	// listeners, then catch up on cross-tab writes they could not receive
	// and notify when the value moved so useSyncExternalStore re-reads the
	// fresh snapshot instead of painting the stale configuration a closed
	// reader left behind.
	const isFirst = listeners.size === 0;
	if (isFirst) {
		window.addEventListener(DIVINE_NAME_MASKING_EVENT, notifyListeners);
		window.addEventListener("storage", onStorage);
	}
	listeners.add(onChange);
	if (isFirst) {
		const latest = getDivineNameMaskingSettings();
		if (snapshot === null || !divineNameMaskingSettingsEqual(latest, snapshot)) {
			snapshot = latest;
			onChange();
		}
	}
	return () => {
		listeners.delete(onChange);
		if (listeners.size === 0) {
			window.removeEventListener(DIVINE_NAME_MASKING_EVENT, notifyListeners);
			window.removeEventListener("storage", onStorage);
		}
	};
}
