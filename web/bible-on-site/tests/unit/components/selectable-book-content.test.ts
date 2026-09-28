/** @jest-environment jsdom */
import { createSelectableBookContentRef } from "@/app/929/[number]/components/selectable-book-content";

describe("selectable book content", () => {
	function setup() {
		const book = document.createElement("div");
		const page = document.createElement("section");
		const text = document.createElement("article");
		page.append(text);
		book.append(page);
		document.body.append(book);
		const bookGesture = jest.fn();
		const click = jest.fn();
		const onSwipe = jest.fn();
		book.addEventListener("pointerdown", bookGesture);
		book.addEventListener("touchstart", bookGesture);
		book.addEventListener("touchmove", bookGesture);
		book.addEventListener("click", click);
		const cleanupRef = createSelectableBookContentRef(onSwipe)(page);
		return {
			book,
			page,
			text,
			bookGesture,
			click,
			onSwipe,
			cleanup: () => {
				cleanupRef?.();
				book.remove();
			},
		};
	}
	function pointer(type: string, x: number, pointerType = "mouse") {
		const event = new MouseEvent(type, {
			bubbles: true,
			cancelable: true,
			button: 0,
			clientX: x,
			clientY: 40,
		});
		Object.defineProperty(event, "pointerType", { value: pointerType });
		return event;
	}

	it("allows a short mouse text drag and its link click", () => {
		const { text, bookGesture, click, onSwipe, cleanup } = setup();
		const down = pointer("pointerdown", 100);
		text.dispatchEvent(down);
		text.dispatchEvent(pointer("pointerup", 150));
		text.dispatchEvent(new MouseEvent("click", { bubbles: true }));
		expect(down.defaultPrevented).toBe(false);
		expect(bookGesture).not.toHaveBeenCalled();
		expect(onSwipe).not.toHaveBeenCalled();
		expect(click).toHaveBeenCalledTimes(1);
		cleanup();
	});

	it("lets touch swipes reach the flipbook", () => {
		const { text, bookGesture, onSwipe, cleanup } = setup();
		text.dispatchEvent(pointer("pointerdown", 100, "touch"));
		text.dispatchEvent(new Event("touchstart", { bubbles: true }));
		text.dispatchEvent(new Event("touchmove", { bubbles: true }));
		expect(bookGesture).toHaveBeenCalledTimes(3);
		expect(onSwipe).not.toHaveBeenCalled();
		cleanup();
	});

	it("does not turn a page during a slow long text drag", async () => {
		const { text, onSwipe, cleanup } = setup();
		text.dispatchEvent(pointer("pointerdown", 100));
		await new Promise((resolve) => setTimeout(resolve, 500));
		text.dispatchEvent(pointer("pointerup", 300));
		expect(onSwipe).not.toHaveBeenCalled();
		cleanup();
	});

	it("turns fast mouse swipes without activating links", () => {
		const { text, click, onSwipe, cleanup } = setup();
		text.dispatchEvent(pointer("pointerdown", 100));
		text.dispatchEvent(pointer("pointerup", 300));
		const firstClick = new MouseEvent("click", {
			bubbles: true,
			cancelable: true,
		});
		text.dispatchEvent(firstClick);
		expect(firstClick.defaultPrevented).toBe(true);
		expect(click).not.toHaveBeenCalled();
		text.dispatchEvent(pointer("pointerdown", 300));
		text.dispatchEvent(pointer("pointerup", 100));
		text.dispatchEvent(new MouseEvent("click", { bubbles: true }));
		expect(onSwipe.mock.calls).toEqual([["next"], ["previous"]]);
		cleanup();
	});

	it("allows page-margin gestures and removes listeners on unmount", () => {
		const { book, page, text, bookGesture, cleanup } = setup();
		page.dispatchEvent(pointer("pointerdown", 100));
		expect(bookGesture).toHaveBeenCalledTimes(1);
		cleanup();
		document.body.append(book);
		text.dispatchEvent(pointer("pointerdown", 100));
		expect(bookGesture).toHaveBeenCalledTimes(2);
		book.remove();
	});

	it("accepts an empty ref", () => {
		expect(createSelectableBookContentRef(jest.fn())(null)).toBeUndefined();
	});
});
