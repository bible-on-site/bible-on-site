import {
	getStoredPerekViewMode,
	PEREK_VIEW_MODE_STORAGE_KEY,
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

	it("returns no stored mode when privacy settings deny localStorage access", () => {
		const read = jest
			.spyOn(Storage.prototype, "getItem")
			.mockImplementation(() => {
				throw new DOMException("Storage access denied", "SecurityError");
			});
		try {
			expect(getStoredPerekViewMode()).toBeNull();
		} finally {
			read.mockRestore();
		}
	});

	it("keeps view switching usable when localStorage quota is exhausted", () => {
		const write = jest
			.spyOn(Storage.prototype, "setItem")
			.mockImplementation(() => {
				throw new DOMException("Storage quota exhausted", "QuotaExceededError");
			});
		try {
			expect(() => setStoredPerekViewMode("book")).not.toThrow();
		} finally {
			write.mockRestore();
		}
	});

	it("pathnameWithBookQuery adds book and preserves other params", () => {
		const href = pathnameWithBookQuery("/929/5", "foo=1", true);
		expect(href.startsWith("/929/5?")).toBe(true);
		const q = new URLSearchParams(href.split("?")[1] ?? "");
		expect(q.get("foo")).toBe("1");
		expect(q.has("book")).toBe(true);
	});

	it("pathnameWithBookQuery removes book", () => {
		expect(
			pathnameWithBookQuery("/929/5", "book=&toc=&bookPage=תוכן&x=2", false),
		).toBe("/929/5?x=2");
	});

	it("pathnameWithBookQuery omits ? when empty", () => {
		expect(pathnameWithBookQuery("/929/1", "", false)).toBe("/929/1");
	});
});
