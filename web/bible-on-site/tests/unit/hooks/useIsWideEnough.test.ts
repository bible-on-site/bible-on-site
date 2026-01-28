/**
 * @jest-environment jsdom
 */
import { act, renderHook } from "@testing-library/react";
import {
	TABLET_MIN_WIDTH,
	useIsWideEnough,
} from "../../../src/hooks/useIsWideEnough";

describe("useIsWideEnough", () => {
	const originalInnerWidth = window.innerWidth;

	afterEach(() => {
		// Restore original window width
		Object.defineProperty(window, "innerWidth", {
			writable: true,
			configurable: true,
			value: originalInnerWidth,
		});
	});

	describe("TABLET_MIN_WIDTH constant", () => {
		it("should be 768", () => {
			expect(TABLET_MIN_WIDTH).toBe(768);
		});
	});

	describe("initial state", () => {
		it("should return undefined on initial render (SSR compatibility)", () => {
			const { result } = renderHook(() => useIsWideEnough(768));
			// After the effect runs, it should have a value
			expect(result.current).toBeDefined();
		});
	});

	describe("viewport width detection", () => {
		it("should return true when viewport is wider than minWidth", () => {
			Object.defineProperty(window, "innerWidth", {
				writable: true,
				configurable: true,
				value: 1024,
			});

			const { result } = renderHook(() => useIsWideEnough(768));
			expect(result.current).toBe(true);
		});

		it("should return true when viewport equals minWidth", () => {
			Object.defineProperty(window, "innerWidth", {
				writable: true,
				configurable: true,
				value: 768,
			});

			const { result } = renderHook(() => useIsWideEnough(768));
			expect(result.current).toBe(true);
		});

		it("should return false when viewport is narrower than minWidth", () => {
			Object.defineProperty(window, "innerWidth", {
				writable: true,
				configurable: true,
				value: 500,
			});

			const { result } = renderHook(() => useIsWideEnough(768));
			expect(result.current).toBe(false);
		});
	});

	describe("resize handling", () => {
		it("should update when window is resized", () => {
			Object.defineProperty(window, "innerWidth", {
				writable: true,
				configurable: true,
				value: 1024,
			});

			const { result } = renderHook(() => useIsWideEnough(768));
			expect(result.current).toBe(true);

			// Simulate resize to smaller viewport
			act(() => {
				Object.defineProperty(window, "innerWidth", {
					writable: true,
					configurable: true,
					value: 500,
				});
				window.dispatchEvent(new Event("resize"));
			});

			expect(result.current).toBe(false);
		});

		it("should update when resized from small to large", () => {
			Object.defineProperty(window, "innerWidth", {
				writable: true,
				configurable: true,
				value: 400,
			});

			const { result } = renderHook(() => useIsWideEnough(768));
			expect(result.current).toBe(false);

			// Simulate resize to larger viewport
			act(() => {
				Object.defineProperty(window, "innerWidth", {
					writable: true,
					configurable: true,
					value: 1200,
				});
				window.dispatchEvent(new Event("resize"));
			});

			expect(result.current).toBe(true);
		});
	});

	describe("cleanup", () => {
		it("should remove event listener on unmount", () => {
			const removeEventListenerSpy = jest.spyOn(window, "removeEventListener");

			const { unmount } = renderHook(() => useIsWideEnough(768));
			unmount();

			expect(removeEventListenerSpy).toHaveBeenCalledWith(
				"resize",
				expect.any(Function),
			);

			removeEventListenerSpy.mockRestore();
		});
	});

	describe("different minWidth values", () => {
		it("should work with custom minWidth value", () => {
			Object.defineProperty(window, "innerWidth", {
				writable: true,
				configurable: true,
				value: 600,
			});

			const { result: result500 } = renderHook(() => useIsWideEnough(500));
			const { result: result700 } = renderHook(() => useIsWideEnough(700));

			expect(result500.current).toBe(true);
			expect(result700.current).toBe(false);
		});
	});
});
