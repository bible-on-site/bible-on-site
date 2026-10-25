/**
 * @jest-environment jsdom
 */

import { act, fireEvent, render, screen } from "@testing-library/react";
import { SeferPasukNumber } from "../../../src/app/929/[number]/components/SeferPasukNumber";
import { setSeferOpenPerush } from "../../../src/app/929/[number]/components/sefer-pasuk-navigation";
import {
	getSeferPasukSelection,
	isSeferPasukSelectionMode,
	resetSeferPasukSelectionState,
	setSeferPasukSelectionMode,
} from "../../../src/app/929/[number]/components/sefer-pasuk-selection";

const PEREK = 7;

beforeEach(() => {
	resetSeferPasukSelectionState();
	setSeferOpenPerush(PEREK, null);
});

describe("SeferPasukNumber", () => {
	it("keeps its plain letter when no perush is open and mode is off", () => {
		render(<SeferPasukNumber perekId={PEREK} pasuk={3} />);
		expect(screen.getByText("ג")).toBeTruthy();
		// No recitation context and no open perush: inert text, no control.
		expect(screen.queryByRole("button")).toBeNull();
	});

	it("becomes a selection toggle while the perek's selection mode is on", () => {
		setSeferPasukSelectionMode(PEREK, true);
		render(<SeferPasukNumber perekId={PEREK} pasuk={3} />);

		const toggle = screen.getByRole("button", { name: "בחירת פסוק ג" });
		expect(toggle.getAttribute("aria-pressed")).toBe("false");
		expect(toggle.getAttribute("data-flipbook-no-flip")).toBe("true");

		fireEvent.click(toggle);
		expect(getSeferPasukSelection(PEREK).has(3)).toBe(true);
		expect(toggle.getAttribute("aria-pressed")).toBe("true");
		expect(screen.getByRole("button", { name: "הסרת פסוק ג" })).toBeTruthy();

		fireEvent.click(toggle);
		expect(getSeferPasukSelection(PEREK).size).toBe(0);
	});

	it("reactivates its control when selection mode exits", () => {
		setSeferPasukSelectionMode(PEREK, true);
		render(<SeferPasukNumber perekId={PEREK} pasuk={3} />);
		expect(screen.queryByRole("button")).not.toBeNull();

		act(() => setSeferPasukSelectionMode(PEREK, false));
		expect(isSeferPasukSelectionMode(PEREK)).toBe(false);
		expect(screen.queryByRole("button")).toBeNull();
	});
});
