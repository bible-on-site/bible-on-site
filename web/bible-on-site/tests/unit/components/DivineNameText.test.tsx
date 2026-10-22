/** @jest-environment jsdom */
import { act, render, screen } from "@testing-library/react";
import { DivineNameText } from "@/app/929/[number]/components/DivineNameText";
import { DEFAULT_DIVINE_NAME_MASKING } from "@/lib/divine-name-masking";
import {
	DIVINE_NAME_MASKING_KEY,
	normalizeDivineNameMasking,
	saveDivineNameMaskingSettings,
} from "@/lib/divine-name-settings";

beforeEach(() => {
	localStorage.clear();
	saveDivineNameMaskingSettings(DEFAULT_DIVINE_NAME_MASKING);
});

describe("DivineNameText", () => {
	it("masks names out of the box for a fresh install (#2404)", () => {
		render(<DivineNameText value="יְהוָ֑ה אֵ֑ל" />);
		expect(screen.getByText("ה' א-ל")).toBeTruthy();
	});
	it("renders the canonical value while masking is off", () => {
		saveDivineNameMaskingSettings(
			normalizeDivineNameMasking({ enabled: false }),
		);
		render(<DivineNameText value="יְהוָ֑ה" />);
		expect(screen.getByText("יְהוָ֑ה")).toBeTruthy();
	});
	it("renders the masked value once masking is on", () => {
		saveDivineNameMaskingSettings(
			normalizeDivineNameMasking({ enabled: true }),
		);
		render(<DivineNameText value="יְהוָ֑ה" />);
		expect(screen.getByText("ה'")).toBeTruthy();
		expect(screen.queryByText("יְהוָ֑ה")).toBeNull();
	});
	it("leaves ordinary words untouched while masking is on", () => {
		saveDivineNameMaskingSettings(
			normalizeDivineNameMasking({ enabled: true }),
		);
		render(<DivineNameText value="בְּרֵאשִׁ֖ית" />);
		expect(screen.getByText("בְּרֵאשִׁ֖ית")).toBeTruthy();
	});
	it("masks each word of a multi-word segment value", () => {
		// Bracketed multi-word qri arrives as a single segment value.
		saveDivineNameMaskingSettings(
			normalizeDivineNameMasking({ enabled: true }),
		);
		render(<DivineNameText value="יְהוָה אֱלֹהִים" />);
		expect(screen.getByText("ה' א-להים")).toBeTruthy();
	});
	it("re-renders when preferences change and restores canonical text when off", () => {
		render(<DivineNameText value="אֱלֹהִ֑ים" />);
		expect(screen.getByText("א-להים")).toBeTruthy();
		act(() =>
			saveDivineNameMaskingSettings(
				normalizeDivineNameMasking({ enabled: true, elohim: "elokim" }),
			),
		);
		expect(screen.getByText("אלקים")).toBeTruthy();
		act(() =>
			saveDivineNameMaskingSettings(
				normalizeDivineNameMasking({ enabled: false }),
			),
		);
		expect(screen.getByText("אֱלֹהִ֑ים")).toBeTruthy();
	});
	it("reacts to a same-key storage event from another tab", () => {
		render(<DivineNameText value="אֵ֑ל" />);
		act(() => {
			localStorage.setItem(
				DIVINE_NAME_MASKING_KEY,
				JSON.stringify({ enabled: false }),
			);
			window.dispatchEvent(
				new StorageEvent("storage", { key: DIVINE_NAME_MASKING_KEY }),
			);
		});
		expect(screen.getByText("אֵ֑ל")).toBeTruthy();
	});
	it("ignores storage events for unrelated keys", () => {
		render(<DivineNameText value="אֵ֑ל" />);
		act(() => {
			localStorage.setItem(
				DIVINE_NAME_MASKING_KEY,
				JSON.stringify({ enabled: false }),
			);
			window.dispatchEvent(new StorageEvent("storage", { key: "otherPref" }));
		});
		// The stored opt-out was not re-read, so the masked default stays.
		expect(screen.getByText("א-ל")).toBeTruthy();
	});
});
