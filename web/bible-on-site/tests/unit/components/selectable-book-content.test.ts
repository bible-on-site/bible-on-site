/** @jest-environment jsdom */
import { selectableBookContentRef } from "@/app/929/[number]/components/selectable-book-content";

describe("selectable book content", () => {
	function setup() {
		const book = document.createElement("div");
		const page = document.createElement("section");
		const text = document.createElement("article");
		page.append(text);
		book.append(page);
		const gesture = jest.fn();
		book.addEventListener("pointerdown", gesture);
		return { page, text, gesture, cleanup: selectableBookContentRef(page) };
	}

	it("keeps text gestures native while preserving link clicks", () => {
		const { page, text, gesture, cleanup } = setup();
		for (const type of [
			"pointerdown",
			"mousedown",
			"touchstart",
			"touchmove",
		]) {
			const bubbled = jest.fn();
			page.parentElement?.addEventListener(type, bubbled);
			const event = new Event(type, { bubbles: true, cancelable: true });
			text.dispatchEvent(event);
			expect(bubbled).not.toHaveBeenCalled();
			expect(event.defaultPrevented).toBe(false);
		}
		const clicked = jest.fn();
		page.parentElement?.addEventListener("click", clicked);
		text.dispatchEvent(new MouseEvent("click", { bubbles: true }));
		expect(clicked).toHaveBeenCalledTimes(1);
		expect(gesture).not.toHaveBeenCalled();
		cleanup?.();
	});

	it("allows page-margin gestures and removes listeners on unmount", () => {
		const { page, text, gesture, cleanup } = setup();
		page.dispatchEvent(new Event("pointerdown", { bubbles: true }));
		expect(gesture).toHaveBeenCalledTimes(1);
		cleanup?.();
		text.dispatchEvent(new Event("pointerdown", { bubbles: true }));
		expect(gesture).toHaveBeenCalledTimes(2);
	});

	it("accepts an empty ref", () => {
		expect(selectableBookContentRef(null)).toBeUndefined();
	});
});
