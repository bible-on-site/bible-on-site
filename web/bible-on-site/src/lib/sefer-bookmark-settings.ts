/**
 * Persisted סימניות (sefer chapter-tab bookmark) display preferences.
 *
 * Stored under its own localStorage key — separate from READER_SETTINGS —
 * because the values configure the flipbook's bookmark provider rather
 * than text rendering, and changes are pushed to the open reader through
 * SEFER_BOOKMARKS_EVENT instead of a page reload.
 *
 * Issue #2974 narrowed the configurable surface to tab visibility and
 * קיבוע (attachment). The provider's remaining presentation fields are
 * the fixed SEFER_BOOKMARK_PRESENTATION contract: legacy stored objects
 * carrying retired placement/orientation/order/upcomingOnly keys read as
 * the fixed defaults, and writes persist only the two live fields.
 */
import type { BookmarkProvider } from "html-flip-book-react";

export const SEFER_BOOKMARKS_KEY = "seferBookmarks";
export const SEFER_BOOKMARKS_EVENT = "sefer-bookmarks-changed";

export type SeferBookmarkSettings = {
	/** Whether chapter tabs are shown at all. */
	enabled: boolean;
	/** Tab turns with its target leaf or stays pinned to the book. */
	attachment: "leaf" | "pinned";
};

export const DEFAULT_SEFER_BOOKMARK_SETTINGS: SeferBookmarkSettings = {
	enabled: true,
	attachment: "leaf",
};

/**
 * Fixed provider presentation (#2974): tabs protrude from both page
 * edges, run perpendicular to them, and follow canonical perek order.
 * Legacy stored values for these keys are ignored on read and omitted on
 * write — the reader applies this contract unconditionally.
 */
export const SEFER_BOOKMARK_PRESENTATION = {
	placement: "sides",
	orientation: "perpendicular",
	order: "page",
} as const satisfies Pick<
	BookmarkProvider,
	"placement" | "orientation" | "order"
>;

const ATTACHMENTS: readonly SeferBookmarkSettings["attachment"][] = [
	"leaf",
	"pinned",
];

const pick = <T extends string>(
	value: unknown,
	allowed: readonly T[],
	fallback: T,
): T => (allowed.includes(value as T) ? (value as T) : fallback);

export function normalizeSeferBookmarkSettings(
	raw: unknown,
): SeferBookmarkSettings {
	const s = (raw ?? {}) as Partial<SeferBookmarkSettings>;
	return {
		// Only a stored boolean is honored; missing/invalid falls back to the
		// default (tabs shown), same convention as normalizeDivineNameMasking.
		enabled:
			typeof s.enabled === "boolean"
				? s.enabled
				: DEFAULT_SEFER_BOOKMARK_SETTINGS.enabled,
		attachment: pick(
			s.attachment,
			ATTACHMENTS,
			DEFAULT_SEFER_BOOKMARK_SETTINGS.attachment,
		),
	};
}

export function getSeferBookmarkSettings(): SeferBookmarkSettings {
	try {
		return normalizeSeferBookmarkSettings(
			JSON.parse(localStorage.getItem(SEFER_BOOKMARKS_KEY) ?? "null"),
		);
	} catch {
		return DEFAULT_SEFER_BOOKMARK_SETTINGS;
	}
}

/**
 * Cached snapshot for useSyncExternalStore: the same object is returned
 * until a save/storage event swaps it, which is exactly the stability
 * getSnapshot requires.
 */
let snapshot: SeferBookmarkSettings | null = null;

/**
 * Active external-store subscribers. The cache can only go stale while
 * nobody is listening — a cross-tab storage write needs a storage event
 * listener to reach this tab's cache — so the first subscriber after a
 * silent stretch re-syncs before anyone renders the stale value.
 */
let subscribers = 0;

const seferBookmarkSettingsEqual = (
	a: SeferBookmarkSettings,
	b: SeferBookmarkSettings,
): boolean =>
	(Object.keys(a) as (keyof SeferBookmarkSettings)[]).every(
		(key) => a[key] === b[key],
	);

export function saveSeferBookmarkSettings(
	settings: Partial<SeferBookmarkSettings>,
): void {
	const next = normalizeSeferBookmarkSettings(settings);
	try {
		localStorage.setItem(SEFER_BOOKMARKS_KEY, JSON.stringify(next));
	} catch {
		/* Private mode. */
	}
	snapshot = next;
	window.dispatchEvent(
		new CustomEvent(SEFER_BOOKMARKS_EVENT, { detail: next }),
	);
}

export function getSeferBookmarkSnapshot(): SeferBookmarkSettings {
	if (!snapshot) snapshot = getSeferBookmarkSettings();
	return snapshot;
}

/* istanbul ignore next: SSR renders the default tab configuration — the same
   output a fresh client produces, so hydration agrees without a settings read. */
export function getSeferBookmarkServerSnapshot(): SeferBookmarkSettings {
	return DEFAULT_SEFER_BOOKMARK_SETTINGS;
}

export function subscribeSeferBookmarks(onChange: () => void): () => void {
	const handler = () => {
		snapshot = getSeferBookmarkSettings();
		onChange();
	};
	// Cross-tab storage events fire for every key — only ours is relevant, so
	// unrelated preference writes in another tab don't churn the provider.
	const onStorage = (event: StorageEvent) => {
		if (event.key === SEFER_BOOKMARKS_KEY) handler();
	};
	window.addEventListener(SEFER_BOOKMARKS_EVENT, handler);
	window.addEventListener("storage", onStorage);
	// First listener after a silent stretch: catch up on cross-tab writes the
	// detached storage listener could not receive, and notify when the value
	// moved so useSyncExternalStore re-reads the fresh snapshot instead of
	// painting the stale configuration a closed reader left behind.
	if (subscribers === 0) {
		const latest = getSeferBookmarkSettings();
		if (snapshot === null || !seferBookmarkSettingsEqual(latest, snapshot)) {
			snapshot = latest;
			onChange();
		}
	}
	subscribers += 1;
	return () => {
		subscribers -= 1;
		window.removeEventListener(SEFER_BOOKMARKS_EVENT, handler);
		window.removeEventListener("storage", onStorage);
	};
}
