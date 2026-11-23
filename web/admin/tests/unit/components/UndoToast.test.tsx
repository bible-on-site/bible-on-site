import { act, fireEvent, render, screen } from "@testing-library/react";
import { hydrateRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { UndoToastProvider, useUndoAction } from "~/components/UndoToast";

function Trigger({
	message,
	commit,
	actionKey,
}: {
	message: string;
	commit: () => void;
	actionKey?: string;
}) {
	const schedule = useUndoAction();
	return (
		<button
			type="button"
			onClick={() => schedule({ message, commit, key: actionKey })}
		>
			trigger
		</button>
	);
}

function renderToast(
	commit: () => void = vi.fn(),
	durationMs = 1000,
	actionKey?: string,
) {
	return render(
		<UndoToastProvider durationMs={durationMs}>
			<Trigger message="הפריט יימחק" commit={commit} actionKey={actionKey} />
		</UndoToastProvider>,
	);
}

afterEach(() => {
	vi.useRealTimers();
});

function Bare() {
	useUndoAction();
	return null;
}

describe("UndoToastProvider", () => {
	it("hydrates cleanly and mounts the live region under document.body", async () => {
		const children = <span data-testid="child">child</span>;
		const markup = renderToStaticMarkup(
			<UndoToastProvider durationMs={1000}>{children}</UndoToastProvider>,
		);
		const host = document.createElement("div");
		host.innerHTML = markup;
		document.body.appendChild(host);

		const errors: string[] = [];
		let root: { unmount: () => void } | undefined;
		await act(async () => {
			root = hydrateRoot(
				host,
				<UndoToastProvider durationMs={1000}>{children}</UndoToastProvider>,
				{ onRecoverableError: (error) => errors.push(String(error)) },
			);
		});

		expect(errors).toEqual([]);
		// The toast region is a client-only portal: it mounts directly under
		// document.body after hydration, outside the hydrated subtree.
		const liveRegion = document.body.querySelector("[aria-live='polite']");
		expect(liveRegion).not.toBeNull();
		expect(liveRegion?.parentElement).toBe(document.body);
		await act(async () => root?.unmount());
		host.remove();
	});

	it("throws when useUndoAction runs outside the provider", () => {
		expect(() => render(<Bare />)).toThrow(
			"useUndoAction must be used inside <UndoToastProvider>",
		);
	});

	it("commits the pending action once the toast expires", () => {
		vi.useFakeTimers();
		const commit = vi.fn();
		renderToast(commit, 1000);
		fireEvent.click(screen.getByRole("button", { name: "trigger" }));

		expect(screen.getByText("הפריט יימחק")).toBeInTheDocument();
		expect(commit).not.toHaveBeenCalled();

		act(() => {
			vi.advanceTimersByTime(1000);
		});
		expect(commit).toHaveBeenCalledTimes(1);
		expect(screen.queryByText("הפריט יימחק")).not.toBeInTheDocument();
	});

	it("cancels the pending action when ביטול is clicked", () => {
		vi.useFakeTimers();
		const commit = vi.fn();
		renderToast(commit, 1000);
		fireEvent.click(screen.getByRole("button", { name: "trigger" }));

		fireEvent.click(screen.getByRole("button", { name: "ביטול" }));
		expect(screen.queryByText("הפריט יימחק")).not.toBeInTheDocument();

		act(() => {
			vi.advanceTimersByTime(2000);
		});
		expect(commit).not.toHaveBeenCalled();
	});

	it("replaces a still-pending action sharing the same key", () => {
		vi.useFakeTimers();
		const first = vi.fn();
		const second = vi.fn();
		render(
			<UndoToastProvider durationMs={1000}>
				<Trigger message="ראשון" commit={first} actionKey="same" />
				<Trigger message="שני" commit={second} actionKey="same" />
			</UndoToastProvider>,
		);
		const triggers = screen.getAllByRole("button", { name: "trigger" });
		fireEvent.click(triggers[0]);
		fireEvent.click(triggers[1]);

		// The first toast is superseded rather than stacked.
		expect(screen.queryByText("ראשון")).not.toBeInTheDocument();
		act(() => {
			vi.advanceTimersByTime(1000);
		});
		expect(first).not.toHaveBeenCalled();
		expect(second).toHaveBeenCalledTimes(1);
	});

	it("never fires a commit scheduled before the provider unmounts", () => {
		vi.useFakeTimers();
		const commit = vi.fn();
		const { unmount } = renderToast(commit, 1000);
		fireEvent.click(screen.getByRole("button", { name: "trigger" }));
		unmount();

		act(() => {
			vi.advanceTimersByTime(2000);
		});
		expect(commit).not.toHaveBeenCalled();
	});

	it("moves focus to the undo button and restores it on ביטול", () => {
		vi.useFakeTimers();
		const commit = vi.fn();
		renderToast(commit, 1000);
		const trigger = screen.getByRole("button", { name: "trigger" });
		trigger.focus();
		fireEvent.click(trigger);

		const undo = screen.getByRole("button", { name: "ביטול" });
		expect(undo).toHaveFocus();

		fireEvent.click(undo);
		expect(trigger).toHaveFocus();
	});

	it("restores focus to the trigger after the toast expires", () => {
		vi.useFakeTimers();
		const commit = vi.fn();
		renderToast(commit, 1000);
		const trigger = screen.getByRole("button", { name: "trigger" });
		trigger.focus();
		fireEvent.click(trigger);
		expect(
			screen.getByRole("button", { name: "ביטול" }),
		).toHaveFocus();

		act(() => {
			vi.advanceTimersByTime(1000);
		});
		expect(trigger).toHaveFocus();
	});

	it("leaves focus alone when the admin moved on before expiry", () => {
		vi.useFakeTimers();
		const commit = vi.fn();
		renderToast(commit, 1000);
		const trigger = screen.getByRole("button", { name: "trigger" });
		trigger.focus();
		fireEvent.click(trigger);
		expect(
			screen.getByRole("button", { name: "ביטול" }),
		).toHaveFocus();

		// The admin tabs into a form — expiry must not yank them back.
		const field = document.createElement("input");
		document.body.appendChild(field);
		field.focus();
		act(() => {
			vi.advanceTimersByTime(1000);
		});
		expect(field).toHaveFocus();
		field.remove();
	});
});
