/**
 * @jest-environment jsdom
 */

jest.mock("@/app/929/[number]/components/perushim-section.module.css", () => ({
	shareButton: "shareButton",
}));

import { act, fireEvent, render, screen } from "@testing-library/react";
import { ShareButton } from "../../../src/app/929/[number]/components/ShareButton";

describe("ShareButton", () => {
	beforeEach(() => {
		jest.clearAllMocks();
	});

	it("renders an anchor with the canonical path as href", () => {
		render(<ShareButton canonicalPath={'/929/5/רש"י'} />);

		const link = screen.getByRole("link", { name: "שיתוף" });
		expect(link).toHaveAttribute("href", '/929/5/רש"י');
	});

	it("shows share text by default", () => {
		render(<ShareButton canonicalPath="/929/1/1" />);

		expect(screen.getByText("🔗 שתף")).toBeTruthy();
	});

	it("prevents default navigation on click and copies to clipboard", async () => {
		const writeText = jest.fn().mockResolvedValue(undefined);
		Object.assign(navigator, {
			clipboard: { writeText },
			share: undefined,
		});

		render(<ShareButton canonicalPath="/929/1/1" />);
		const link = screen.getByRole("link", { name: "שיתוף" });

		await act(async () => {
			fireEvent.click(link);
		});

		expect(writeText).toHaveBeenCalled();
	});

	it("copies to clipboard and shows confirmation", async () => {
		const writeText = jest.fn().mockResolvedValue(undefined);
		Object.assign(navigator, {
			clipboard: { writeText },
			share: undefined,
		});

		render(<ShareButton canonicalPath="/929/5/test" />);

		await act(async () => {
			fireEvent.click(screen.getByRole("link", { name: "שיתוף" }));
		});

		expect(writeText).toHaveBeenCalledWith(
			`${window.location.origin}/929/5/test`,
		);
		expect(screen.getByText("הועתק!")).toBeTruthy();
	});

	it("reports a failure when the clipboard write is rejected", async () => {
		const writeText = jest.fn().mockRejectedValue(new Error("denied"));
		Object.assign(navigator, {
			clipboard: { writeText },
			share: undefined,
		});

		render(<ShareButton canonicalPath="/929/1/1" />);

		await act(async () => {
			fireEvent.click(screen.getByRole("link", { name: "שיתוף" }));
		});

		expect(screen.getByText("השיתוף נכשל")).toBeTruthy();
	});

	it("uses Web Share API when available", async () => {
		const shareFn = jest.fn().mockResolvedValue(undefined);
		Object.assign(navigator, { share: shareFn });

		render(<ShareButton canonicalPath="/929/1/1" title="Test Share Title" />);

		await act(async () => {
			fireEvent.click(screen.getByRole("link", { name: "שיתוף" }));
		});

		expect(shareFn).toHaveBeenCalledWith({
			title: "Test Share Title",
			url: `${window.location.origin}/929/1/1`,
		});
	});

	it("treats a native share dismissal as a cancel, not a failure", async () => {
		const shareFn = jest
			.fn()
			.mockRejectedValue(new DOMException("cancelled", "AbortError"));
		const writeText = jest.fn().mockResolvedValue(undefined);
		Object.assign(navigator, {
			share: shareFn,
			clipboard: { writeText },
		});

		render(<ShareButton canonicalPath="/929/1/1" />);

		await act(async () => {
			fireEvent.click(screen.getByRole("link", { name: "שיתוף" }));
		});

		// No clipboard fallback and no failure label on a user cancel (#2786).
		expect(writeText).not.toHaveBeenCalled();
		expect(screen.getByText("🔗 שתף")).toBeTruthy();
	});

	it("falls back to the clipboard on a genuine native share failure", async () => {
		const shareFn = jest
			.fn()
			.mockRejectedValue(new DOMException("not allowed", "NotAllowedError"));
		const writeText = jest.fn().mockResolvedValue(undefined);
		Object.assign(navigator, {
			share: shareFn,
			clipboard: { writeText },
		});

		render(<ShareButton canonicalPath="/929/1/1" />);

		await act(async () => {
			fireEvent.click(screen.getByRole("link", { name: "שיתוף" }));
		});

		expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/929/1/1`);
		expect(screen.getByText("הועתק!")).toBeTruthy();
	});
});
