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

		expect(screen.getByRole("dialog", { name: "קיצורי מקלדת" })).toBeInTheDocument();
		expect(screen.getByText("כותרות")).toBeInTheDocument();
		expect(screen.getByText("קישורים וטקסט")).toBeInTheDocument();
		expect(screen.getByText("רשימות")).toBeInTheDocument();

		fireEvent.click(screen.getByRole("button", { name: "✕" }));
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
		fireEvent.click(screen.getByRole("button", { name: "שמור JSON והחל עורך" }));

		expect(onExtrasDraftChange).toHaveBeenCalledWith('{"Mod-Alt-2":"heading:2"}');
		expect(onSaveExtras).toHaveBeenCalledTimes(1);
	});
});
