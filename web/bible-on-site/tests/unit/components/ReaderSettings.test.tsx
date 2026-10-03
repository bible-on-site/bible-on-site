/**
 * @jest-environment jsdom
 */
import { fireEvent, render, screen } from "@testing-library/react";
import ReaderSettings from "@/app/929/[number]/components/ReaderSettings";
import {
	PEREK_FONT_SCALES,
	PEREK_LINE_HEIGHTS,
	READER_SETTINGS_STORAGE_KEY,
} from "@/lib/reader-settings";

describe("ReaderSettings", () => {
	beforeEach(() => {
		localStorage.clear();
		document.documentElement.style.removeProperty("--perek-font-scale");
		document.documentElement.style.removeProperty("--perek-line-height");
	});

	const fontScaleVar = () =>
		document.documentElement.style.getPropertyValue("--perek-font-scale");
	const lineHeightVar = () =>
		document.documentElement.style.getPropertyValue("--perek-line-height");

	it("renders the accessible control group with three buttons", () => {
		render(<ReaderSettings />);
		expect(
			screen.getByRole("group", { name: "הגדרות קריאה" }),
		).toBeInTheDocument();
		expect(
			screen.getByRole("button", { name: "הקטנת גופן" }),
		).toBeInTheDocument();
		expect(
			screen.getByRole("button", { name: "הגדלת גופן" }),
		).toBeInTheDocument();
		expect(
			screen.getByRole("button", { name: /ריווח שורות/ }),
		).toBeInTheDocument();
	});

	it("increases and decreases the font scale and persists it", () => {
		render(<ReaderSettings />);
		const increase = screen.getByRole("button", { name: "הגדלת גופן" });
		const decrease = screen.getByRole("button", { name: "הקטנת גופן" });

		fireEvent.click(increase);
		expect(fontScaleVar()).toBe(String(PEREK_FONT_SCALES[3]));
		fireEvent.click(decrease);
		fireEvent.click(decrease);
		expect(fontScaleVar()).toBe(String(PEREK_FONT_SCALES[1]));
		expect(localStorage.getItem(READER_SETTINGS_STORAGE_KEY)).toBe(
			JSON.stringify({ fontStep: 1, lineStep: 0 }),
		);
	});

	it("disables A+ at the maximum and A- at the minimum step", () => {
		render(<ReaderSettings />);
		const increase = screen.getByRole("button", { name: "הגדלת גופן" });
		const decrease = screen.getByRole("button", { name: "הקטנת גופן" });

		for (let i = 0; i < PEREK_FONT_SCALES.length; i++) {
			fireEvent.click(increase);
		}
		expect(increase).toBeDisabled();
		expect(decrease).not.toBeDisabled();
		expect(fontScaleVar()).toBe(
			String(PEREK_FONT_SCALES[PEREK_FONT_SCALES.length - 1]),
		);
	});

	it("cycles line spacing and persists it", () => {
		render(<ReaderSettings />);
		const spacing = screen.getByRole("button", { name: /ריווח שורות/ });
		fireEvent.click(spacing);
		expect(lineHeightVar()).toBe(String(PEREK_LINE_HEIGHTS[1]));
		fireEvent.click(spacing);
		expect(lineHeightVar()).toBe(String(PEREK_LINE_HEIGHTS[2]));
		fireEvent.click(spacing);
		expect(lineHeightVar()).toBe(String(PEREK_LINE_HEIGHTS[0]));
	});

	it("initializes button state from stored settings after mount", () => {
		localStorage.setItem(
			READER_SETTINGS_STORAGE_KEY,
			JSON.stringify({
				fontStep: PEREK_FONT_SCALES.length - 1,
				lineStep: 0,
			}),
		);
		render(<ReaderSettings />);
		expect(
			screen.getByRole("button", { name: "הגדלת גופן" }),
		).toBeDisabled();
	});
});
