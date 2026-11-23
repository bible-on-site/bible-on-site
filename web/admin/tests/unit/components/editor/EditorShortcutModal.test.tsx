import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { EditorShortcutModal } from "~/components/editor/EditorShortcutModal";

describe("EditorShortcutModal", () => {
	it("renders nothing when closed", () => {
		const { container } = render(
			<EditorShortcutModal
				open={false}
				onClose={vi.fn()}
				extrasDraft="{}"
				onExtrasDraftChange={vi.fn()}
				onSaveExtras={vi.fn()}
			/>,
		);

		expect(container.firstChild).toBeNull();
	});

	it("renders shortcut sections and closes from both close controls", () => {
		const onClose = vi.fn();

		render(
			<EditorShortcutModal
				open={true}
				onClose={onClose}
				extrasDraft="{}"
				onExtrasDraftChange={vi.fn()}
				onSaveExtras={vi.fn()}
			/>,
		);

		expect(
			screen.getByRole("dialog", { name: "קיצורי מקלדת" }),
		).toBeInTheDocument();
		expect(screen.getByText("כותרות")).toBeInTheDocument();
		expect(screen.getByText("קישורים וטקסט")).toBeInTheDocument();
		expect(screen.getByText("רשימות")).toBeInTheDocument();

		fireEvent.click(screen.getByRole("button", { name: "סגירה" }));
		fireEvent.click(screen.getByRole("button", { name: "סגור" }));

		expect(onClose).toHaveBeenCalledTimes(2);
	});

	it("filters shortcuts by action, keys, and tags", () => {
		render(
			<EditorShortcutModal
				open={true}
				onClose={vi.fn()}
				extrasDraft="{}"
				onExtrasDraftChange={vi.fn()}
				onSaveExtras={vi.fn()}
			/>,
		);

		const search = screen.getByRole("searchbox");
		fireEvent.change(search, { target: { value: "bullet" } });
		expect(screen.getByText("רשימת תבליטים")).toBeInTheDocument();
		expect(screen.queryByText("כותרות H1–H6")).not.toBeInTheDocument();

		fireEvent.change(search, { target: { value: "Ctrl+B" } });
		expect(screen.getByText("מודגש")).toBeInTheDocument();
		expect(screen.queryByText("רשימת תבליטים")).not.toBeInTheDocument();

		fireEvent.change(search, { target: { value: "missing shortcut" } });
		expect(screen.getByText("אין תוצאות לחיפוש")).toBeInTheDocument();
	});

	it("edits and saves custom shortcut JSON", () => {
		const onExtrasDraftChange = vi.fn();
		const onSaveExtras = vi.fn();

		render(
			<EditorShortcutModal
				open={true}
				onClose={vi.fn()}
				extrasDraft='{"Mod-Shift-k":"link"}'
				onExtrasDraftChange={onExtrasDraftChange}
				onSaveExtras={onSaveExtras}
			/>,
		);

		const textarea = screen.getByLabelText("קיצורים מותאמים JSON");
		expect(textarea).toHaveValue('{"Mod-Shift-k":"link"}');

		fireEvent.change(textarea, {
			target: { value: '{"Mod-Alt-2":"heading:2"}' },
		});
		fireEvent.click(
			screen.getByRole("button", { name: "שמור JSON והחל עורך" }),
		);

		expect(onExtrasDraftChange).toHaveBeenCalledWith(
			'{"Mod-Alt-2":"heading:2"}',
		);
		expect(onSaveExtras).toHaveBeenCalledTimes(1);
	});

	it("closes on Escape", () => {
		const onClose = vi.fn();
		render(
			<EditorShortcutModal
				open={true}
				onClose={onClose}
				extrasDraft="{}"
				onExtrasDraftChange={vi.fn()}
				onSaveExtras={vi.fn()}
			/>,
		);

		fireEvent.keyDown(document, { key: "Escape" });
		expect(onClose).toHaveBeenCalledTimes(1);
	});

	it("closes on backdrop click and backdrop Enter/Space only", () => {
		const onClose = vi.fn();
		render(
			<EditorShortcutModal
				open={true}
				onClose={onClose}
				extrasDraft="{}"
				onExtrasDraftChange={vi.fn()}
				onSaveExtras={vi.fn()}
			/>,
		);

		const dialog = screen.getByRole("dialog");
		fireEvent.click(dialog);
		expect(onClose).toHaveBeenCalledTimes(1);

		// Clicks raised inside the dialog's content are theirs, not the backdrop's.
		fireEvent.click(screen.getByText("קיצורי מקלדת"));
		expect(onClose).toHaveBeenCalledTimes(1);

		fireEvent.keyDown(dialog, { key: "Enter" });
		expect(onClose).toHaveBeenCalledTimes(2);
		fireEvent.keyDown(dialog, { key: " " });
		expect(onClose).toHaveBeenCalledTimes(3);

		// Enter raised on a control inside the dialog activates that control.
		fireEvent.keyDown(screen.getByRole("button", { name: "סגור" }), {
			key: "Enter",
		});
		expect(onClose).toHaveBeenCalledTimes(3);
	});

	it("moves focus into the dialog, traps Tab, and restores the opener", () => {
		const opener = document.createElement("button");
		document.body.appendChild(opener);
		opener.focus();
		const onClose = vi.fn();

		const utils = render(
			<EditorShortcutModal
				open={true}
				onClose={onClose}
				extrasDraft="{}"
				onExtrasDraftChange={vi.fn()}
				onSaveExtras={vi.fn()}
				opener={opener}
			/>,
		);

		const closeX = screen.getByRole("button", { name: "סגירה" });
		const search = screen.getByRole("searchbox");
		const textarea = screen.getByLabelText("קיצורים מותאמים JSON");
		const saveBtn = screen.getByRole("button", { name: "שמור JSON והחל עורך" });

		// Initial focus lands on the close control.
		expect(closeX).toHaveFocus();

		// fireEvent.keyDown returns false when preventDefault fired — proof the
		// handler intercepted the Tab instead of letting jsdom (which never moves
		// focus itself) or a real browser escape the dialog.
		saveBtn.focus();
		expect(fireEvent.keyDown(saveBtn, { key: "Tab" })).toBe(false);
		expect(closeX).toHaveFocus();

		closeX.focus();
		expect(fireEvent.keyDown(closeX, { key: "Tab", shiftKey: true })).toBe(
			false,
		);
		expect(saveBtn).toHaveFocus();

		// Focus on the dialog container counts as an edge: wrap, never escape.
		screen.getByRole("dialog").focus();
		expect(
			fireEvent.keyDown(screen.getByRole("dialog"), { key: "Tab" }),
		).toBe(false);
		expect(closeX).toHaveFocus();

		// Mid-list Tab is left for the browser: not intercepted, focus unmoved.
		search.focus();
		expect(fireEvent.keyDown(search, { key: "Tab" })).toBe(true);
		expect(search).toHaveFocus();
		expect(fireEvent.keyDown(textarea, { key: "Tab" })).toBe(true);

		// On close the focus goes back to the element that opened the modal.
		utils.rerender(
			<EditorShortcutModal
				open={false}
				onClose={onClose}
				extrasDraft="{}"
				onExtrasDraftChange={vi.fn()}
				onSaveExtras={vi.fn()}
				opener={opener}
			/>,
		);
		expect(opener).toHaveFocus();
		opener.remove();
	});

	it("restores focus to the previously focused element without an opener prop", () => {
		const outside = document.createElement("button");
		document.body.appendChild(outside);
		outside.focus();

		const utils = render(
			<EditorShortcutModal
				open={true}
				onClose={vi.fn()}
				extrasDraft="{}"
				onExtrasDraftChange={vi.fn()}
				onSaveExtras={vi.fn()}
			/>,
		);
		expect(screen.getByRole("button", { name: "סגירה" })).toHaveFocus();

		utils.rerender(
			<EditorShortcutModal
				open={false}
				onClose={vi.fn()}
				extrasDraft="{}"
				onExtrasDraftChange={vi.fn()}
				onSaveExtras={vi.fn()}
			/>,
		);
		expect(outside).toHaveFocus();
		outside.remove();
	});

	it("inerts the page behind the dialog while open", () => {
		const alreadyInert = document.createElement("div");
		alreadyInert.setAttribute("inert", "");
		document.body.appendChild(alreadyInert);

		const utils = render(
			<EditorShortcutModal
				open={true}
				onClose={vi.fn()}
				extrasDraft="{}"
				onExtrasDraftChange={vi.fn()}
				onSaveExtras={vi.fn()}
			/>,
		);

		const dialog = screen.getByRole("dialog");
		for (const sibling of document.body.children) {
			if (sibling === dialog) continue;
			expect(sibling).toHaveAttribute("inert");
		}
		expect(dialog).not.toHaveAttribute("inert");

		utils.rerender(
			<EditorShortcutModal
				open={false}
				onClose={vi.fn()}
				extrasDraft="{}"
				onExtrasDraftChange={vi.fn()}
				onSaveExtras={vi.fn()}
			/>,
		);
		for (const sibling of document.body.children) {
			if (sibling === alreadyInert) continue;
			expect(sibling).not.toHaveAttribute("inert");
		}
		// A sibling that was already inert keeps its own attribute.
		expect(alreadyInert).toHaveAttribute("inert");
		alreadyInert.remove();
	});
});
