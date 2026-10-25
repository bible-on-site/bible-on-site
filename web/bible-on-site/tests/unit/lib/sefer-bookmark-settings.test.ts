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

/**
 * Cross-tab storage event the listener can inspect. The subscriber only
 * reads `event.key`, so a plain Event carrying the property is enough —
 * the DOM externs CodeQL checks declare a narrower StorageEvent
 * constructor than the runtime one and flag the two-argument call.
 */
const storageEvent = (key: string) =>
	Object.assign(new Event("storage"), { key });

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
		const unsubscribe = subscribeSeferBookmarks(() => {});
		expect(getSeferBookmarkSnapshot().placement).toBe("sides");
		localStorage.setItem(
			SEFER_BOOKMARKS_KEY,
			JSON.stringify({ placement: "right" }),
		);
		// Events for other keys are ignored; only our key re-reads.
		window.dispatchEvent(storageEvent("otherPref"));
		expect(getSeferBookmarkSnapshot().placement).toBe("sides");
		window.dispatchEvent(storageEvent(SEFER_BOOKMARKS_KEY));
		expect(getSeferBookmarkSnapshot().placement).toBe("right");
		unsubscribe();
	});
	it("refreshes the stale snapshot when the first subscriber returns", () => {
		const first = subscribeSeferBookmarks(() => {});
		expect(getSeferBookmarkSnapshot().placement).toBe("sides");
		first();
		// Another tab writes while no storage listener is attached; the
		// cached snapshot can no longer observe the change.
		localStorage.setItem(
			SEFER_BOOKMARKS_KEY,
			JSON.stringify({ placement: "bottom" }),
		);
		const seen: string[] = [];
		const second = subscribeSeferBookmarks(() =>
			seen.push(getSeferBookmarkSnapshot().placement),
		);
		expect(getSeferBookmarkSnapshot().placement).toBe("bottom");
		expect(seen).toEqual(["bottom"]);
		second();
	});
	it("does not notify the first subscriber when nothing changed", () => {
		const first = subscribeSeferBookmarks(() => {});
		first();
		let calls = 0;
		const second = subscribeSeferBookmarks(() => {
			calls += 1;
		});
		expect(calls).toBe(0);
		second();
	});
	it("seeds the snapshot for a first subscriber that never read it", async () => {
		// A fresh module has snapshot === null — reachable for a direct
		// (non-useSyncExternalStore) subscriber before any snapshot read.
		jest.resetModules();
		const fresh = await import("@/lib/sefer-bookmark-settings");
		localStorage.setItem(
			fresh.SEFER_BOOKMARKS_KEY,
			JSON.stringify({ placement: "top" }),
		);
		const seen: string[] = [];
		const unsubscribe = fresh.subscribeSeferBookmarks(() =>
			seen.push(fresh.getSeferBookmarkSnapshot().placement),
		);
		expect(fresh.getSeferBookmarkSnapshot().placement).toBe("top");
		expect(seen).toEqual(["top"]);
		unsubscribe();
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
