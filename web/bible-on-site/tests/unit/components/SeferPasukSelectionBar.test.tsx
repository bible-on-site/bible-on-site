/**
 * @jest-environment jsdom
 */

import { act, fireEvent, render, screen } from "@testing-library/react";
import { SeferPasukSelectionBar } from "../../../src/app/929/[number]/components/SeferPasukSelectionBar";
import {
	getSeferPasukSelection,
	isSeferPasukSelectionMode,
	resetSeferPasukSelectionState,
	setSeferPasukSelectionMode,
	toggleSeferPasuk,
} from "../../../src/app/929/[number]/components/sefer-pasuk-selection";

beforeEach(() => {
	resetSeferPasukSelectionState();
});

describe("SeferPasukSelectionBar", () => {
	it("renders nothing while selection mode is off", () => {
		const { container } = render(<SeferPasukSelectionBar perekId={1} />);
		expect(container).toBeEmptyDOMElement();
	});

	it("reports the selection, clears it, and exits the mode", () => {
		setSeferPasukSelectionMode(1, true);
		toggleSeferPasuk(1, 3);
		render(<SeferPasukSelectionBar perekId={1} />);

		expect(screen.getByText("נבחרו 1 פסוקים")).toBeTruthy();

		fireEvent.click(screen.getByRole("button", { name: "ניקוי בחירה" }));
		expect(getSeferPasukSelection(1).size).toBe(0);
		// Clearing keeps the mode active — exiting is a separate control.
		expect(isSeferPasukSelectionMode(1)).toBe(true);
		expect(screen.getByText("סמנו פסוקים על הפרק")).toBeTruthy();

		fireEvent.click(screen.getByRole("button", { name: "סיום בחירה" }));
		expect(isSeferPasukSelectionMode(1)).toBe(false);
	});

	it("renders nothing for a zero perek id even with the mode on", () => {
		act(() => setSeferPasukSelectionMode(0, true));
		const { container } = render(<SeferPasukSelectionBar perekId={0} />);
		expect(container).toBeEmptyDOMElement();
	});
});
