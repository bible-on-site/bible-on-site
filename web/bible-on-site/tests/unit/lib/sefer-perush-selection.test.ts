import {
	clearSeferPerushOverride,
	DEFAULT_SEFER_PERUSH_SELECTION,
	getStoredSeferPerushSelection,
	hasSeferPerushOverride,
	resolveSeferPerushSelection,
	SEFER_PERUSH_SELECTION_EVENT,
	SEFER_PERUSH_SELECTION_STORAGE_KEY,
	setSeferPerushOverride,
	setSeferPerushSelection,
} from "../../../src/lib/sefer-perush-selection";

describe("sefer-perush-selection", () => {
	beforeEach(() => {
		localStorage.clear();
	});

	afterEach(() => jest.restoreAllMocks());

	describe("with empty or corrupt storage", () => {
		it("returns the default selection when nothing is stored", () => {
			expect(getStoredSeferPerushSelection()).toEqual(
				DEFAULT_SEFER_PERUSH_SELECTION,
			);
		});

		it("returns defaults on malformed stored JSON", () => {
			localStorage.setItem(SEFER_PERUSH_SELECTION_STORAGE_KEY, "not-json{");
			expect(getStoredSeferPerushSelection()).toEqual(
				DEFAULT_SEFER_PERUSH_SELECTION,
			);
		});

		it("normalizes non-array, duplicate, and non-integer stored ids", () => {
			localStorage.setItem(
				SEFER_PERUSH_SELECTION_STORAGE_KEY,
				JSON.stringify({
					v: 1,
					global: [3, 3, "x", 1.5, -2, 7, null],
					sefer: { בראשית: "oops", שמות: [2, "a", 0, 4] },
				}),
			);
			expect(getStoredSeferPerushSelection()).toEqual({
				v: 1,
				global: [3, 7],
				sefer: { שמות: [2, 4] },
			});
		});

		it("falls back safely when storage cannot be read", () => {
			jest.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
				throw new DOMException("Access denied", "SecurityError");
			});
			expect(getStoredSeferPerushSelection()).toEqual(
				DEFAULT_SEFER_PERUSH_SELECTION,
			);
		});

		it("does not throw when storage cannot be written", () => {
			jest.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
				throw new DOMException("Quota exceeded", "QuotaExceededError");
			});
			expect(() => setSeferPerushSelection("בראשית", [1])).not.toThrow();
		});
	});

	describe("resolution precedence", () => {
		it("inherits the global default for a sefer without an override", () => {
			setSeferPerushSelection("בראשית", [1, 2]);
			expect(resolveSeferPerushSelection("שמות")).toEqual({
				ids: [1, 2],
				isOverride: false,
			});
		});

		it("prefers the sefer override over the global default", () => {
			setSeferPerushSelection("בראשית", [1, 2]);
			setSeferPerushOverride("שמות", [9]);
			expect(resolveSeferPerushSelection("שמות")).toEqual({
				ids: [9],
				isOverride: true,
			});
			expect(resolveSeferPerushSelection("בראשית")).toEqual({
				ids: [1, 2],
				isOverride: true,
			});
		});

		it("an empty override is still an override, not inheritance", () => {
			setSeferPerushSelection("בראשית", [1, 2]);
			setSeferPerushOverride("שמות", []);
			expect(resolveSeferPerushSelection("שמות")).toEqual({
				ids: [],
				isOverride: true,
			});
			expect(hasSeferPerushOverride("שמות")).toBe(true);
		});
	});

	describe("writes", () => {
		it("automatically saves the global default and the current sefer", () => {
			setSeferPerushSelection("בראשית", [4, 5]);
			const stored = getStoredSeferPerushSelection();
			expect(stored.global).toEqual([4, 5]);
			expect(stored.sefer).toEqual({ בראשית: [4, 5] });
		});

		it("updates the default without overwriting other saved sefarim", () => {
			setSeferPerushSelection("בראשית", [1, 2]);
			setSeferPerushOverride("שמות", [9]);
			setSeferPerushSelection("שמות", [9, 8]);
			const stored = getStoredSeferPerushSelection();
			expect(stored.global).toEqual([9, 8]);
			expect(stored.sefer.בראשית).toEqual([1, 2]);
			expect(stored.sefer.שמות).toEqual([9, 8]);
		});

		it("clears an override back to inheritance without touching it twice", () => {
			setSeferPerushSelection("בראשית", [1]);
			setSeferPerushOverride("שמות", [9]);
			clearSeferPerushOverride("שמות");
			expect(hasSeferPerushOverride("שמות")).toBe(false);
			expect(resolveSeferPerushSelection("שמות")).toEqual({
				ids: [1],
				isOverride: false,
			});
			// Clearing a sefer that already inherits is a no-op, not a write.
			localStorage.clear();
			clearSeferPerushOverride("ויקרא");
			expect(
				localStorage.getItem(SEFER_PERUSH_SELECTION_STORAGE_KEY),
			).toBeNull();
		});

		it("deduplicates and drops invalid ids on write", () => {
			setSeferPerushOverride("בראשית", [
				3,
				3,
				0,
				-1,
				1.5,
				"x" as unknown as number,
				5,
			]);
			expect(resolveSeferPerushSelection("בראשית").ids).toEqual([3, 5]);
		});

		it("broadcasts the selection change in the same tab", () => {
			const listener = jest.fn();
			window.addEventListener(SEFER_PERUSH_SELECTION_EVENT, listener);
			setSeferPerushSelection("בראשית", [7]);
			expect(listener).toHaveBeenCalledTimes(1);
			window.removeEventListener(SEFER_PERUSH_SELECTION_EVENT, listener);
		});
	});
});
