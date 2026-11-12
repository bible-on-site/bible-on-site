/**
 * @jest-environment jsdom
 */
import {
	CALENDAR_FLIP_VIEW_STORAGE_KEY,
	getStoredCalendarFlipView,
	setStoredCalendarFlipView,
} from "@/lib/calendar-flip-view";

describe("calendar-flip-view", () => {
	beforeEach(() => {
		window.localStorage.clear();
		jest.restoreAllMocks();
	});

	it("returns null when no preference was stored", () => {
		expect(getStoredCalendarFlipView()).toBeNull();
	});

	it("round-trips the stored presentation", () => {
		setStoredCalendarFlipView("flip");
		expect(getStoredCalendarFlipView()).toBe("flip");
		setStoredCalendarFlipView("overview");
		expect(getStoredCalendarFlipView()).toBe("overview");
	});

	it("returns null for a value the writer never produced", () => {
		window.localStorage.setItem(CALENDAR_FLIP_VIEW_STORAGE_KEY, "bogus");
		expect(getStoredCalendarFlipView()).toBeNull();
	});

	it("warns and falls back when storage reads are denied", () => {
		const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
		jest.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
			throw new DOMException("denied");
		});
		expect(getStoredCalendarFlipView()).toBeNull();
		expect(warn).toHaveBeenCalledWith(
			"Failed to read the calendar presentation preference",
			expect.any(DOMException),
		);
	});

	it("warns and keeps the session alive when writes are denied", () => {
		const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
		jest.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
			throw new DOMException("quota");
		});
		expect(() => setStoredCalendarFlipView("flip")).not.toThrow();
		expect(warn).toHaveBeenCalledWith(
			"Failed to persist the calendar presentation preference",
			expect.any(DOMException),
		);
	});
});
