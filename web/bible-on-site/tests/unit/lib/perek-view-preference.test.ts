import {
	PEREK_VIEW_MODE_STORAGE_KEY,
	getStoredPerekViewMode,
	pathnameWithBookQuery,
	setStoredPerekViewMode,
} from "../../../src/lib/perek-view-preference";

describe("perek-view-preference", () => {
	beforeEach(() => {
		localStorage.clear();
	});

	it("setStoredPerekViewMode and getStoredPerekViewMode roundtrip", () => {
		expect(getStoredPerekViewMode()).toBeNull();
		setStoredPerekViewMode("book");
		expect(localStorage.getItem(PEREK_VIEW_MODE_STORAGE_KEY)).toBe("book");
		expect(getStoredPerekViewMode()).toBe("book");
		setStoredPerekViewMode("seo");
		expect(getStoredPerekViewMode()).toBe("seo");
	});

	it("getStoredPerekViewMode returns null for unknown values", () => {
		localStorage.setItem(PEREK_VIEW_MODE_STORAGE_KEY, "other");
		expect(getStoredPerekViewMode()).toBeNull();
	});

	it("pathnameWithBookQuery adds book and preserves other params", () => {
		const href = pathnameWithBookQuery("/929/5", "foo=1", true);
		expect(href.startsWith("/929/5?")).toBe(true);
		const q = new URLSearchParams(href.split("?")[1] ?? "");
		expect(q.get("foo")).toBe("1");
		expect(q.has("book")).toBe(true);
	});

	it("pathnameWithBookQuery removes book", () => {
		expect(pathnameWithBookQuery("/929/5", "book=&x=2", false)).toBe(
			"/929/5?x=2",
		);
	});

	it("pathnameWithBookQuery omits ? when empty", () => {
		expect(pathnameWithBookQuery("/929/1", "", false)).toBe("/929/1");
	});
});
