/** @jest-environment jsdom */
import {
	createSelectableBookContentRef,
	type MouseBookMode,
} from "@/app/929/[number]/components/selectable-book-content";

describe("Sefer mouse mode", () => {
	function pointerDown(pointerType: string) {
		const event = new MouseEvent("pointerdown", {
			bubbles: true,
			cancelable: true,
			button: 0,
		});
		Object.defineProperty(event, "pointerType", { value: pointerType });
		return event;
	}

	function setup(mode: MouseBookMode) {
		const book = document.createElement("div");
		const page = document.createElement("section");
		const text = document.createElement("article");
		page.append(text);
		book.append(page);
		document.body.append(book);
		const onPointerDown = jest.fn();
		const onMouseDown = jest.fn();
		book.addEventListener("pointerdown", onPointerDown);
		book.addEventListener("mousedown", onMouseDown);
		const cleanupRef = createSelectableBookContentRef(mode)(page);
		return {
			text,
			onPointerDown,
			onMouseDown,
			cleanup: () => {
				cleanupRef?.();
				book.remove();
			},
		};
	}

	it("lets the flipbook receive mouse down over verse text in turning mode", () => {
		const { text, onPointerDown, onMouseDown, cleanup } = setup("turn");
		text.dispatchEvent(pointerDown("mouse"));
		text.dispatchEvent(
			new MouseEvent("mousedown", { bubbles: true, button: 0 }),
		);
		expect(onPointerDown).toHaveBeenCalledTimes(1);
		expect(onMouseDown).toHaveBeenCalledTimes(1);
		cleanup();
	});

	it("keeps mouse down over verse text out of the flipbook in selection mode", () => {
		const { text, onPointerDown, onMouseDown, cleanup } = setup("select");
		const pointer = pointerDown("mouse");
		text.dispatchEvent(pointer);
		const event = new MouseEvent("mousedown", {
			bubbles: true,
			cancelable: true,
			button: 0,
		});
		text.dispatchEvent(event);
		expect(onPointerDown).not.toHaveBeenCalled();
		expect(onMouseDown).not.toHaveBeenCalled();
		expect(pointer.defaultPrevented).toBe(false);
		expect(event.defaultPrevented).toBe(false);
		text.dispatchEvent(pointerDown("touch"));
		expect(onPointerDown).toHaveBeenCalledTimes(1);
		cleanup();
		text.dispatchEvent(pointerDown("mouse"));
		text.dispatchEvent(
			new MouseEvent("mousedown", { bubbles: true, button: 0 }),
		);
		expect(onPointerDown).toHaveBeenCalledTimes(2);
		expect(onMouseDown).toHaveBeenCalledTimes(1);
	});
});
