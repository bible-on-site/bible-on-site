/** @jest-environment jsdom */
import {
	DEFAULT_SEFER_BOOKMARK_SETTINGS,
	getSeferBookmarkServerSnapshot,
	getSeferBookmarkSettings,
	getSeferBookmarkSnapshot,
	normalizeSeferBookmarkSettings,
	SEFER_BOOKMARK_PRESENTATION,
	SEFER_BOOKMARKS_EVENT,
	SEFER_BOOKMARKS_KEY,
	saveSeferBookmarkSettings,
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
	it("keeps the two live choices and drops retired legacy keys (#2974)", () => {
		const normalized = normalizeSeferBookmarkSettings({
			enabled: false,
			attachment: "pinned",
			placement: "top",
			orientation: "parallel",
			order: "title",
			upcomingOnly: true,
		});
		expect(normalized).toEqual({ enabled: false, attachment: "pinned" });
	});
	it("rejects values outside each live field's allowed set", () =>
		expect(
			normalizeSeferBookmarkSettings({
				enabled: true,
				attachment: "glue",
			}),
		).toEqual(DEFAULT_SEFER_BOOKMARK_SETTINGS));
	it("falls back to the default for a non-boolean enabled flag", () =>
		expect(normalizeSeferBookmarkSettings({ enabled: "yes" }).enabled).toBe(
			true,
		));
	it("normalizes only the two live fields — the result has no retired keys", () => {
		const normalized = normalizeSeferBookmarkSettings({
			placement: "left",
			order: "reverse-page",
			upcomingOnly: true,
		});
		expect(Object.keys(normalized).sort()).toEqual(["attachment", "enabled"]);
	});
});

describe("defaults (#2543, #2974)", () => {
	it("defaults to enabled leaf tabs when nothing was stored", () => {
		localStorage.clear();
		expect(getSeferBookmarkSettings()).toEqual(DEFAULT_SEFER_BOOKMARK_SETTINGS);
		expect(getSeferBookmarkSettings()).toEqual({
			enabled: true,
			attachment: "leaf",
		});
	});
	it("keeps a stored disabled toggle", () => {
		localStorage.setItem(
			SEFER_BOOKMARKS_KEY,
			JSON.stringify({ enabled: false }),
		);
		const s = getSeferBookmarkSettings();
		expect(s.enabled).toBe(false);
		expect(s.attachment).toBe("leaf");
	});
	it("keeps a stored pinned attachment", () => {
		localStorage.setItem(
			SEFER_BOOKMARKS_KEY,
			JSON.stringify({ attachment: "pinned" }),
		);
		expect(getSeferBookmarkSettings().attachment).toBe("pinned");
	});
});

describe("fixed presentation contract (#2974)", () => {
	it("pins the retired provider fields to their fixed values", () =>
		expect(SEFER_BOOKMARK_PRESENTATION).toEqual({
			placement: "sides",
			orientation: "perpendicular",
			order: "page",
		}));
});

describe("persistence and change notifications", () => {
	it("round-trips settings through localStorage", () => {
		const settings = normalizeSeferBookmarkSettings({
			enabled: false,
			attachment: "pinned",
		});
		saveSeferBookmarkSettings(settings);
		expect(
			JSON.parse(localStorage.getItem(SEFER_BOOKMARKS_KEY) ?? "null"),
		).toEqual(settings);
		expect(getSeferBookmarkSettings()).toEqual(settings);
	});
	it("writes only the live fields — legacy keys are not persisted", () => {
		// A legacy-shaped caller object spreading retired fields must not
		// leak them back into storage.
		const legacy = {
			enabled: false,
			attachment: "pinned",
			placement: "top",
			orientation: "parallel",
			order: "title",
			upcomingOnly: true,
		} as const;
		saveSeferBookmarkSettings(legacy);
		expect(
			JSON.parse(localStorage.getItem(SEFER_BOOKMARKS_KEY) ?? "null"),
		).toEqual({ enabled: false, attachment: "pinned" });
	});
	it("partial updates keep the other live preference", () => {
		saveSeferBookmarkSettings({ enabled: false, attachment: "pinned" });
		saveSeferBookmarkSettings({ ...getSeferBookmarkSnapshot(), enabled: true });
		expect(getSeferBookmarkSettings()).toEqual({
			enabled: true,
			attachment: "pinned",
		});
	});
	it("falls back to defaults when stored JSON is malformed", () => {
		localStorage.setItem(SEFER_BOOKMARKS_KEY, "{oops");
		expect(getSeferBookmarkSettings()).toEqual(DEFAULT_SEFER_BOOKMARK_SETTINGS);
	});
	it("still updates the snapshot when storage is unavailable", () => {
		// Private-mode storage: the write throws, but the in-memory snapshot
		// and the change event must still fire for the open reader.
		const spy = jest
			.spyOn(Storage.prototype, "setItem")
			.mockImplementation(() => {
				throw new DOMException("QuotaExceededError");
			});
		saveSeferBookmarkSettings({ attachment: "pinned" });
		expect(getSeferBookmarkSnapshot().attachment).toBe("pinned");
		spy.mockRestore();
	});
	it("dispatches a change event whose detail carries the settings", () => {
		const seen: string[] = [];
		const unsubscribe = subscribeSeferBookmarks(() =>
			seen.push(getSeferBookmarkSnapshot().attachment),
		);
		saveSeferBookmarkSettings({ attachment: "pinned" });
		expect(seen).toEqual(["pinned"]);
		unsubscribe();
		saveSeferBookmarkSettings({ attachment: "leaf" });
		expect(seen).toEqual(["pinned"]);
	});
	it("re-reads localStorage on cross-tab storage events", () => {
		const unsubscribe = subscribeSeferBookmarks(() => {});
		expect(getSeferBookmarkSnapshot().attachment).toBe("leaf");
		localStorage.setItem(
			SEFER_BOOKMARKS_KEY,
			JSON.stringify({ attachment: "pinned" }),
		);
		// Events for other keys are ignored; only our key re-reads.
		window.dispatchEvent(storageEvent("otherPref"));
		expect(getSeferBookmarkSnapshot().attachment).toBe("leaf");
		window.dispatchEvent(storageEvent(SEFER_BOOKMARKS_KEY));
		expect(getSeferBookmarkSnapshot().attachment).toBe("pinned");
		unsubscribe();
	});
	it("refreshes the stale snapshot when the first subscriber returns", () => {
		const first = subscribeSeferBookmarks(() => {});
		expect(getSeferBookmarkSnapshot().attachment).toBe("leaf");
		first();
		// Another tab writes while no storage listener is attached; the
		// cached snapshot can no longer observe the change.
		localStorage.setItem(
			SEFER_BOOKMARKS_KEY,
			JSON.stringify({ attachment: "pinned" }),
		);
		const seen: string[] = [];
		const second = subscribeSeferBookmarks(() =>
			seen.push(getSeferBookmarkSnapshot().attachment),
		);
		expect(getSeferBookmarkSnapshot().attachment).toBe("pinned");
		expect(seen).toEqual(["pinned"]);
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
			JSON.stringify({ attachment: "pinned" }),
		);
		const seen: string[] = [];
		const unsubscribe = fresh.subscribeSeferBookmarks(() =>
			seen.push(fresh.getSeferBookmarkSnapshot().attachment),
		);
		expect(fresh.getSeferBookmarkSnapshot().attachment).toBe("pinned");
		expect(seen).toEqual(["pinned"]);
		unsubscribe();
	});
	it("keeps the snapshot object stable between changes", () => {
		const first = getSeferBookmarkSnapshot();
		expect(getSeferBookmarkSnapshot()).toBe(first);
		saveSeferBookmarkSettings({ enabled: false });
		expect(getSeferBookmarkSnapshot()).not.toBe(first);
	});
	it("serves the defaults to SSR so hydration agrees with a fresh client", () => {
		saveSeferBookmarkSettings({ enabled: false, attachment: "pinned" });
		expect(getSeferBookmarkServerSnapshot()).toEqual(
			DEFAULT_SEFER_BOOKMARK_SETTINGS,
		);
	});
	it("emits the saved payload on the documented event", () =>
		new Promise<void>((resolve) => {
			window.addEventListener(
				SEFER_BOOKMARKS_EVENT,
				(event) => {
					expect((event as CustomEvent).detail.attachment).toBe("pinned");
					resolve();
				},
				{ once: true },
			);
			saveSeferBookmarkSettings({ attachment: "pinned" });
		}));
});
