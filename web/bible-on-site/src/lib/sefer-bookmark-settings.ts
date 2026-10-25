/**
 * Persisted סימניות (sefer chapter-tab bookmark) display preferences.
 *
 * Stored under its own localStorage key — separate from READER_SETTINGS —
 * because the values configure the flipbook's bookmark provider rather
 * than text rendering, and changes are pushed to the open reader through
 * SEFER_BOOKMARKS_EVENT instead of a page reload. The stored shape stays
 * serializable: function-valued provider options (the title-order
 * comparator) are mapped back from the stored enum at use time.
 */
import type {
	Bookmark,
	BookmarkPlacement,
	BookmarkProvider,
} from "html-flip-book-react";

export const SEFER_BOOKMARKS_KEY = "seferBookmarks";
export const SEFER_BOOKMARKS_EVENT = "sefer-bookmarks-changed";

/** Chapter-tab ordering; "title" maps to a Hebrew-aware comparator at use time. */
export type SeferBookmarkOrder = "page" | "reverse-page" | "title";

export type SeferBookmarkSettings = {
	/** Whether chapter tabs are shown at all. */
	enabled: boolean;
	/** Which book edge(s) the tabs protrude from. */
	placement: BookmarkPlacement;
	/** Tab runs perpendicular to its edge (physical-book look) or along it. */
	orientation: "perpendicular" | "parallel";
	/** Tab turns with its target leaf or stays pinned to the book. */
	attachment: "leaf" | "pinned";
	/** Canonical perek order, reversed, or ordered by title. */
	order: SeferBookmarkOrder;
	/** Show only chapters at/after the current position. */
	upcomingOnly: boolean;
};

export const DEFAULT_SEFER_BOOKMARK_SETTINGS: SeferBookmarkSettings = {
	enabled: true,
	placement: "sides",
	orientation: "perpendicular",
	attachment: "leaf",
	order: "page",
	upcomingOnly: false,
};

const PLACEMENTS: readonly BookmarkPlacement[] = [
	"top",
	"bottom",
	"sides",
	"left",
	"right",
	"top-bottom",
];
const ORIENTATIONS: readonly SeferBookmarkSettings["orientation"][] = [
	"perpendicular",
	"parallel",
];
const ATTACHMENTS: readonly SeferBookmarkSettings["attachment"][] = [
	"leaf",
	"pinned",
];
const ORDERS: readonly SeferBookmarkOrder[] = ["page", "reverse-page", "title"];

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
		placement: pick(
			s.placement,
			PLACEMENTS,
			DEFAULT_SEFER_BOOKMARK_SETTINGS.placement,
		),
		orientation: pick(
			s.orientation,
			ORIENTATIONS,
			DEFAULT_SEFER_BOOKMARK_SETTINGS.orientation,
		),
		attachment: pick(
			s.attachment,
			ATTACHMENTS,
			DEFAULT_SEFER_BOOKMARK_SETTINGS.attachment,
		),
		order: pick(s.order, ORDERS, DEFAULT_SEFER_BOOKMARK_SETTINGS.order),
		upcomingOnly:
			typeof s.upcomingOnly === "boolean"
				? s.upcomingOnly
				: DEFAULT_SEFER_BOOKMARK_SETTINGS.upcomingOnly,
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
	return () => {
		window.removeEventListener(SEFER_BOOKMARKS_EVENT, handler);
		window.removeEventListener("storage", onStorage);
	};
}

/** Provider `order` field derived from the serializable setting. The "title"
 * enum maps to the Hebrew-aware comparator at the call site, keeping the
 * persisted shape free of functions. */
export function seferBookmarkProviderOrder(
	settings: SeferBookmarkSettings,
	titleOrder: (a: Bookmark, b: Bookmark) => number,
): BookmarkProvider["order"] {
	return settings.order === "title" ? titleOrder : settings.order;
}
