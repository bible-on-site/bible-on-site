/** @jest-environment jsdom */
import {
	DEFAULT_SEFER_BOOKMARK_SETTINGS,
	getSeferBookmarkServerSnapshot,
	getSeferBookmarkSettings,
	getSeferBookmarkSnapshot,
	normalizeSeferBookmarkSettings,
	SEFER_BOOKMARKS_EVENT,
	SEFER_BOOKMARKS_KEY,
	saveSeferBookmarkSettings,
	seferBookmarkProviderOrder,
	subscribeSeferBookmarks,
} from "@/lib/sefer-bookmark-settings";

beforeEach(() => {
	localStorage.clear();
	// The settings module keeps a snapshot cache for useSyncExternalStore;
	// resetting through the public save API clears it between tests.
	saveSeferBookmarkSettings(DEFAULT_SEFER_BOOKMARK_SETTINGS);
});

describe("normalizeSeferBookmarkSettings", () => {
	it("falls back to defaults for garbage input", () => {
		for (const raw of [null, undefined, 5, "x", []])
			expect(normalizeSeferBookmarkSettings(raw)).toEqual(
				DEFAULT_SEFER_BOOKMARK_SETTINGS,
			);
	});
	it("rejects option values outside each field's allowed set", () => {
		const normalized = normalizeSeferBookmarkSettings({
			enabled: true,
			placement: "inside",
			orientation: "diagonal",
			attachment: "glue",
			order: "alphabetical",
			upcomingOnly: "yes",
		});
		expect(normalized).toEqual({
			...DEFAULT_SEFER_BOOKMARK_SETTINGS,
			enabled: true,
		});
	});
	it("keeps valid choices", () =>
		expect(
			normalizeSeferBookmarkSettings({
				enabled: false,
				placement: "top",
				orientation: "parallel",
				attachment: "pinned",
				order: "reverse-page",
				upcomingOnly: true,
			}),
		).toEqual({
			enabled: false,
			placement: "top",
			orientation: "parallel",
			attachment: "pinned",
			order: "reverse-page",
			upcomingOnly: true,
		}));
	it("falls back to the default for a non-boolean enabled flag", () =>
		expect(normalizeSeferBookmarkSettings({ enabled: "yes" }).enabled).toBe(
			true,
		));
});

describe("defaults (#2543)", () => {
	it("defaults to enabled tabs on both sides when nothing was stored", () => {
		localStorage.clear();
		expect(getSeferBookmarkSettings()).toEqual(DEFAULT_SEFER_BOOKMARK_SETTINGS);
		expect(getSeferBookmarkSettings()).toEqual(
			expect.objectContaining({
				enabled: true,
				placement: "sides",
				orientation: "perpendicular",
				attachment: "leaf",
				order: "page",
				upcomingOnly: false,
			}),
		);
	});
	it("keeps a stored disabled toggle", () => {
		localStorage.setItem(
			SEFER_BOOKMARKS_KEY,
			JSON.stringify({ enabled: false }),
		);
		const s = getSeferBookmarkSettings();
		expect(s.enabled).toBe(false);
		expect(s.placement).toBe("sides");
	});
});

describe("persistence and change notifications", () => {
	it("round-trips settings through localStorage", () => {
		const settings = normalizeSeferBookmarkSettings({
			enabled: false,
			placement: "bottom",
			order: "title",
		});
		saveSeferBookmarkSettings(settings);
		expect(
			JSON.parse(localStorage.getItem(SEFER_BOOKMARKS_KEY) ?? "null"),
		).toEqual(settings);
		expect(getSeferBookmarkSettings()).toEqual(settings);
	});
	it("persists only serializable values — no functions in storage", () => {
		saveSeferBookmarkSettings({ order: "title" });
		expect(localStorage.getItem(SEFER_BOOKMARKS_KEY)).not.toContain("(");
		expect(
			JSON.parse(localStorage.getItem(SEFER_BOOKMARKS_KEY) ?? "null"),
		).toEqual(expect.objectContaining({ order: "title" }));
	});
	it("falls back to defaults when stored JSON is malformed", () => {
		localStorage.setItem(SEFER_BOOKMARKS_KEY, "{oops");
		expect(getSeferBookmarkSettings()).toEqual(DEFAULT_SEFER_BOOKMARK_SETTINGS);
	});
	it("dispatches a change event whose detail carries the settings", () => {
		const seen: string[] = [];
		const unsubscribe = subscribeSeferBookmarks(() =>
			seen.push(getSeferBookmarkSnapshot().placement),
		);
		saveSeferBookmarkSettings({ placement: "top" });
		expect(seen).toEqual(["top"]);
		unsubscribe();
		saveSeferBookmarkSettings({ placement: "left" });
		expect(seen).toEqual(["top"]);
	});
	it("re-reads localStorage on cross-tab storage events", () => {
		subscribeSeferBookmarks(() => {});
		expect(getSeferBookmarkSnapshot().placement).toBe("sides");
		localStorage.setItem(
			SEFER_BOOKMARKS_KEY,
			JSON.stringify({ placement: "right" }),
		);
		// Events for other keys are ignored; only our key re-reads.
		window.dispatchEvent(new StorageEvent("storage", { key: "otherPref" }));
		expect(getSeferBookmarkSnapshot().placement).toBe("sides");
		window.dispatchEvent(
			new StorageEvent("storage", { key: SEFER_BOOKMARKS_KEY }),
		);
		expect(getSeferBookmarkSnapshot().placement).toBe("right");
	});
	it("keeps the snapshot object stable between changes", () => {
		const first = getSeferBookmarkSnapshot();
		expect(getSeferBookmarkSnapshot()).toBe(first);
		saveSeferBookmarkSettings({ enabled: false });
		expect(getSeferBookmarkSnapshot()).not.toBe(first);
	});
	it("serves the defaults to SSR so hydration agrees with a fresh client", () => {
		saveSeferBookmarkSettings({ enabled: false, placement: "left" });
		expect(getSeferBookmarkServerSnapshot()).toEqual(
			DEFAULT_SEFER_BOOKMARK_SETTINGS,
		);
	});
	it("emits the saved payload on the documented event", () =>
		new Promise<void>((resolve) => {
			window.addEventListener(
				SEFER_BOOKMARKS_EVENT,
				(event) => {
					expect((event as CustomEvent).detail.placement).toBe("bottom");
					resolve();
				},
				{ once: true },
			);
			saveSeferBookmarkSettings({ placement: "bottom" });
		}));
});

describe("seferBookmarkProviderOrder", () => {
	const titleOrder = (a: { label: string }, b: { label: string }) =>
		a.label.localeCompare(b.label);

	it("passes through page and reverse-page orders", () => {
		expect(
			seferBookmarkProviderOrder(
				normalizeSeferBookmarkSettings({ order: "page" }),
				titleOrder,
			),
		).toBe("page");
		expect(
			seferBookmarkProviderOrder(
				normalizeSeferBookmarkSettings({ order: "reverse-page" }),
				titleOrder,
			),
		).toBe("reverse-page");
	});
	it("maps the serializable title enum to the comparator", () => {
		expect(
			seferBookmarkProviderOrder(
				normalizeSeferBookmarkSettings({ order: "title" }),
				titleOrder,
			),
		).toBe(titleOrder);
	});
});
