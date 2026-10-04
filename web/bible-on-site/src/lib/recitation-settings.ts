export type RecitationSettings = {
	speed: number;
	volume: number;
	/** null preserves the recording's original pauses; milliseconds otherwise. */
	versePauseMs: number | null;
};
export const RECITATION_SETTINGS_KEY = "perekRecitationSettings";
export const RECITATION_SETTINGS_EVENT = "recitation-settings-changed";
export const OPEN_READER_SETTINGS_EVENT = "open-reader-settings";
export const DEFAULT_RECITATION_SETTINGS: RecitationSettings = {
	speed: 1,
	volume: 1,
	versePauseMs: null,
};
const bounded = (value: unknown, fallback: number, min: number, max: number) =>
	typeof value === "number" && Number.isFinite(value)
		? Math.min(max, Math.max(min, value))
		: fallback;
export function normalizeRecitationSettings(raw: unknown): RecitationSettings {
	const s = (raw ?? {}) as Partial<RecitationSettings>;
	return {
		speed: bounded(s.speed, 1, 0.5, 2),
		volume: bounded(s.volume, 1, 0, 1),
		versePauseMs:
			s.versePauseMs == null ? null : bounded(s.versePauseMs, 0, 0, 5000),
	};
}
export function getRecitationSettings(): RecitationSettings {
	try {
		return normalizeRecitationSettings(
			JSON.parse(localStorage.getItem(RECITATION_SETTINGS_KEY) ?? "null"),
		);
	} catch {
		return DEFAULT_RECITATION_SETTINGS;
	}
}
export function saveRecitationSettings(settings: RecitationSettings): void {
	const next = normalizeRecitationSettings(settings);
	try {
		localStorage.setItem(RECITATION_SETTINGS_KEY, JSON.stringify(next));
	} catch {
		/* Private mode. */
	}
	window.dispatchEvent(
		new CustomEvent(RECITATION_SETTINGS_EVENT, { detail: next }),
	);
}
export type SettingsSection = "display" | "recitation";
export function openReaderSettings(
	section: SettingsSection,
	opener: HTMLElement,
) {
	window.dispatchEvent(
		new CustomEvent(OPEN_READER_SETTINGS_EVENT, {
			detail: { section, opener },
		}),
	);
}
