/** @jest-environment jsdom */
import { createSelectableBookContentRef } from "@/app/929/[number]/components/selectable-book-content";

describe("selectable book content", () => {
	function pointer(type: string, x: number, pointerType = "mouse") {
		const event = new MouseEvent(type, {
			bubbles: true,
			cancelable: true,
			button: 0,
			clientX: x,
			clientY: 40,
		});
		Object.defineProperties(event, {
			pointerId: { value: 1 },
			pointerType: { value: pointerType },
		});
		return event;
	}

	function setup() {
		const book = document.createElement("div");
		const page = document.createElement("section");
		const text = document.createElement("article");
		page.append(text);
		book.append(page);
		document.body.append(book);
		const onDown = jest.fn();
		const onMove = jest.fn();
		const onClick = jest.fn();
		book.addEventListener("pointerdown", onDown);
		book.addEventListener("pointermove", onMove);
		book.addEventListener("click", onClick);
		const cleanupRef = createSelectableBookContentRef()(page);
		return {
			book,
			page,
			text,
			onDown,
			onMove,
			onClick,
			cleanup: () => {
				cleanupRef?.();
				book.remove();
			},
		};
	}

	it("lets clicks and short text selections work without starting a book pan", () => {
		const { text, onDown, onMove, onClick, cleanup } = setup();
		text.dispatchEvent(pointer("pointerdown", 100));
		const move = pointer("pointermove", 150);
		text.dispatchEvent(move);
		text.dispatchEvent(pointer("pointerup", 150));
		text.dispatchEvent(new MouseEvent("click", { bubbles: true }));
		expect(onDown).toHaveBeenCalledTimes(1);
		expect(onMove).not.toHaveBeenCalled();
		expect(move.defaultPrevented).toBe(false);
		expect(onClick).toHaveBeenCalledTimes(1);
		cleanup();
	});

	it("keeps a slow text selection out of the book pan", async () => {
		const { text, onMove, cleanup } = setup();
		text.dispatchEvent(pointer("pointerdown", 100));
		await new Promise((resolve) => setTimeout(resolve, 500));
		const move = pointer("pointermove", 300);
		text.dispatchEvent(move);
		text.dispatchEvent(pointer("pointerup", 300));
		expect(onMove).not.toHaveBeenCalled();
		expect(move.defaultPrevented).toBe(false);
		cleanup();
	});

	it("hands a quick horizontal drag to the book without selecting or clicking", () => {
		const { text, onDown, onMove, onClick, cleanup } = setup();
		const selection = window.getSelection();
		if (!selection) throw new Error("Selection is unavailable");
		const clearSelection = jest.spyOn(selection, "removeAllRanges");
		text.dispatchEvent(pointer("pointerdown", 100));
		const move = pointer("pointermove", 250);
		text.dispatchEvent(move);
		text.dispatchEvent(pointer("pointermove", 350));
		text.dispatchEvent(pointer("pointerup", 350));
		const click = new MouseEvent("click", { bubbles: true, cancelable: true });
		text.dispatchEvent(click);
		expect(onDown).toHaveBeenCalledTimes(1);
		expect(onMove).toHaveBeenCalledTimes(2);
		expect(move.defaultPrevented).toBe(true);
		expect(clearSelection).toHaveBeenCalled();
		expect(click.defaultPrevented).toBe(true);
		expect(onClick).not.toHaveBeenCalled();
		clearSelection.mockRestore();
		cleanup();
	});

	it("leaves touch and page-padding gestures to the book and cleans up", () => {
		const { page, text, onDown, onMove, cleanup } = setup();
		text.dispatchEvent(pointer("pointerdown", 100, "touch"));
		text.dispatchEvent(pointer("pointermove", 300, "touch"));
		page.dispatchEvent(pointer("pointerdown", 100));
		page.dispatchEvent(pointer("pointermove", 300));
		expect(onDown).toHaveBeenCalledTimes(2);
		expect(onMove).toHaveBeenCalledTimes(2);
		cleanup();
		text.dispatchEvent(pointer("pointerdown", 100));
		text.dispatchEvent(pointer("pointermove", 300));
		expect(onMove).toHaveBeenCalledTimes(3);
	});
});
