import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ConfirmDialog } from "~/components/ConfirmDialog";

function renderDialog(overrides: Record<string, unknown> = {}) {
	const props = {
		open: true,
		title: "מחיקת ערך",
		message: "האם אתה בטוח?",
		onConfirm: vi.fn(),
		onCancel: vi.fn(),
		...overrides,
	};
	const utils = render(<ConfirmDialog {...props} />);
	return { ...props, ...utils };
}

describe("ConfirmDialog", () => {
	it("renders nothing while closed", () => {
		renderDialog({ open: false });
		expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
	});

	it("renders the title and message inside a modal dialog", () => {
		renderDialog();
		const dialog = screen.getByRole("dialog");
		expect(dialog).toHaveAttribute("aria-modal", "true");
		expect(screen.getByText("מחיקת ערך")).toBeInTheDocument();
		expect(screen.getByText("האם אתה בטוח?")).toBeInTheDocument();
	});

	it("fires onConfirm from the confirm button and onCancel from cancel", () => {
		const props = renderDialog({ confirmLabel: "מחק" });
		fireEvent.click(screen.getByRole("button", { name: "מחק" }));
		expect(props.onConfirm).toHaveBeenCalledTimes(1);
		expect(props.onCancel).not.toHaveBeenCalled();

		fireEvent.click(screen.getByRole("button", { name: "ביטול" }));
		expect(props.onCancel).toHaveBeenCalledTimes(1);
	});

	it("cancels on Escape", () => {
		const props = renderDialog();
		fireEvent.keyDown(document, { key: "Escape" });
		expect(props.onCancel).toHaveBeenCalledTimes(1);
		expect(props.onConfirm).not.toHaveBeenCalled();
	});

	it("ignores non-Escape keys", () => {
		const props = renderDialog();
		fireEvent.keyDown(document, { key: "Enter" });
		expect(props.onCancel).not.toHaveBeenCalled();
	});

	it("moves focus to the confirm button and restores it on close", () => {
		const outside = document.createElement("button");
		document.body.appendChild(outside);
		outside.focus();
		const props = renderDialog({ confirmLabel: "מחק" });
		expect(screen.getByRole("button", { name: "מחק" })).toHaveFocus();

		props.rerender(<ConfirmDialog {...props} open={false} />);
		expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
		expect(outside).toHaveFocus();
		outside.remove();
	});

	it("keeps focus where the user put it when parents rerender callbacks", () => {
		const props = renderDialog({ confirmLabel: "מחק" });
		const cancel = screen.getByRole("button", { name: "ביטול" });
		cancel.focus();
		expect(cancel).toHaveFocus();

		// Autosave-driven parent rerenders recreate onCancel — focus must not
		// jump back to the destructive button.
		props.rerender(<ConfirmDialog {...props} onCancel={vi.fn()} />);
		expect(cancel).toHaveFocus();
	});
});
