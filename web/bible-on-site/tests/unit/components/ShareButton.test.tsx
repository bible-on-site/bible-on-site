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
		render(<ShareButton canonicalPath="/929/5/רש״י" />);

		const link = screen.getByRole("link", { name: "שיתוף" });
		expect(link).toHaveAttribute("href", "/929/5/רש״י");
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
});
