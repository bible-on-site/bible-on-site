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

const pick = <T extends string>(value: unknown, allowed: readonly T[], fallback: T): T =>
	allowed.includes(value as T) ? (value as T) : fallback;

/** Long enough for a phrase, short enough to keep pasuk layout sane. */
const MAX_CUSTOM_LENGTH = 40;
const custom = (value: unknown): string =>
	typeof value === "string" ? value.trim().slice(0, MAX_CUSTOM_LENGTH) : "";

export function normalizeDivineNameMasking(
	raw: unknown,
): DivineNameMaskingSettings {
	const s = (raw ?? {}) as Partial<DivineNameMaskingSettings>;
	return {
		enabled: s.enabled === true,
		elohim: pick(s.elohim, ELOHIM_OPTIONS, DEFAULT_DIVINE_NAME_MASKING.elohim),
		elohimCustom: custom(s.elohimCustom),
		yhwh: pick(s.yhwh, YHWH_OPTIONS, DEFAULT_DIVINE_NAME_MASKING.yhwh),
		yhwhCustom: custom(s.yhwhCustom),
		el: pick(s.el, EL_OPTIONS, DEFAULT_DIVINE_NAME_MASKING.el),
		shaddai: pick(s.shaddai, SHADDAI_OPTIONS, DEFAULT_DIVINE_NAME_MASKING.shaddai),
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

/* istanbul ignore next: SSR renders the canonical text. */
export function getDivineNameMaskingServerSnapshot(): DivineNameMaskingSettings {
	return DEFAULT_DIVINE_NAME_MASKING;
}

export function subscribeDivineNameMasking(onChange: () => void): () => void {
	const handler = () => {
		snapshot = getDivineNameMaskingSettings();
		onChange();
	};
	// Cross-tab storage events fire for every key — only ours is relevant, so
	// unrelated preference writes in another tab don't refresh every segment.
	const onStorage = (event: StorageEvent) => {
		if (event.key === DIVINE_NAME_MASKING_KEY) handler();
	};
	window.addEventListener(DIVINE_NAME_MASKING_EVENT, handler);
	window.addEventListener("storage", onStorage);
	return () => {
		window.removeEventListener(DIVINE_NAME_MASKING_EVENT, handler);
		window.removeEventListener("storage", onStorage);
	};
}
