import { render, screen } from "@testing-library/react";
import { useRef } from "react";
import { describe, expect, it } from "vitest";
import { useModalDialogFocus } from "~/lib/use-modal-dialog-focus";

function EmptyRefDialog() {
	const dialogRef = useRef<HTMLDivElement>(null);
	const initialFocus = useRef<HTMLButtonElement>(null);
	useModalDialogFocus(true, dialogRef, null, initialFocus);
	return (
		<div ref={dialogRef} role="dialog" tabIndex={-1} data-testid="dialog">
			<button type="button">סגור</button>
		</div>
	);
}

describe("useModalDialogFocus", () => {
	it("focuses the dialog when the initial focus ref is empty and no close control exists", () => {
		render(<EmptyRefDialog />);
		expect(document.activeElement).toBe(screen.getByTestId("dialog"));
	});
});
