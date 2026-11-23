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

	it("traps Tab inside the dialog", () => {
		renderDialog({ confirmLabel: "מחק" });
		const cancel = screen.getByRole("button", { name: "ביטול" });
		const confirm = screen.getByRole("button", { name: "מחק" });
		expect(confirm).toHaveFocus();

		// fireEvent.keyDown returns false when preventDefault fired — proof the
		// handler intercepted the Tab instead of letting focus leave the dialog.
		expect(fireEvent.keyDown(confirm, { key: "Tab" })).toBe(false);
		expect(cancel).toHaveFocus();
		expect(fireEvent.keyDown(cancel, { key: "Tab", shiftKey: true })).toBe(
			false,
		);
		expect(confirm).toHaveFocus();

		// Focus on the dialog container counts as an edge: wrap, never escape.
		screen.getByRole("dialog").focus();
		expect(
			fireEvent.keyDown(screen.getByRole("dialog"), { key: "Tab" }),
		).toBe(false);
		expect(cancel).toHaveFocus();

		// Mid-list Tab is left for the browser: not intercepted, focus unmoved.
		expect(fireEvent.keyDown(cancel, { key: "Tab" })).toBe(true);
		expect(cancel).toHaveFocus();
	});

	it("inerts the page behind the dialog while open", () => {
		const alreadyInert = document.createElement("div");
		alreadyInert.setAttribute("inert", "");
		document.body.appendChild(alreadyInert);
		// Transient UI (the undo toast) is exempted from the inert sweep.
		const keepActive = document.createElement("div");
		keepActive.setAttribute("data-modal-keep-active", "");
		document.body.appendChild(keepActive);

		const props = renderDialog();
		const dialog = screen.getByRole("dialog");
		for (const sibling of document.body.children) {
			if (sibling === dialog || sibling === keepActive) continue;
			expect(sibling).toHaveAttribute("inert");
		}
		expect(dialog).not.toHaveAttribute("inert");
		expect(keepActive).not.toHaveAttribute("inert");

		props.rerender(<ConfirmDialog {...props} open={false} />);
		for (const sibling of document.body.children) {
			if (sibling === alreadyInert) continue;
			expect(sibling).not.toHaveAttribute("inert");
		}
		// A sibling that was already inert keeps its own attribute.
		expect(alreadyInert).toHaveAttribute("inert");
		alreadyInert.remove();
		keepActive.remove();
	});

	it("restores focus to the recorded opener element", () => {
		const outside = document.createElement("button");
		document.body.appendChild(outside);
		const props = renderDialog({ opener: outside, confirmLabel: "מחק" });
		expect(screen.getByRole("button", { name: "מחק" })).toHaveFocus();

		props.rerender(<ConfirmDialog {...props} open={false} />);
		expect(outside).toHaveFocus();
		outside.remove();
	});
});
