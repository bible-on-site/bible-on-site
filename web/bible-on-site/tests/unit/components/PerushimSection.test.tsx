/**
 * @jest-environment jsdom
 */
jest.mock("../../../src/app/929/[number]/actions", () => ({
	getPerushNotesForPage: jest.fn(),
}));

import { fireEvent, render, screen } from "@testing-library/react";
import { getPerushNotesForPage } from "../../../src/app/929/[number]/actions";
import { PerushimSection } from "../../../src/app/929/[number]/components/PerushimSection";
import type { PerushSummary } from "../../../src/lib/perushim";

const mockGetPerushNotesForPage = getPerushNotesForPage as jest.MockedFunction<
	typeof getPerushNotesForPage
>;

describe("PerushimSection", () => {
	beforeEach(() => {
		jest.clearAllMocks();
	});

	it("renders section header and empty message when no perushim", () => {
		render(<PerushimSection perekId={1} perushim={[]} />);
		expect(screen.getByText("פרשנים על הפרק")).toBeTruthy();
		expect(screen.getByText("אין פרשנות לפרק זה")).toBeTruthy();
	});

	it("renders carousel when perushim provided", () => {
		const perushim: PerushSummary[] = [
			{ id: 1, name: "רש״י", parshanName: "רש״י", noteCount: 55 },
			{
				id: 14,
				name: "ביאור שטיינזלץ",
				parshanName: "עדין שטיינזלץ",
				noteCount: 31,
			},
		];
		render(<PerushimSection perekId={1} perushim={perushim} />);
		expect(screen.getByRole("button", { name: /רש״י/ })).toBeTruthy();
		expect(screen.getByRole("button", { name: /ביאור שטיינזלץ/ })).toBeTruthy();
		expect(screen.getByText("55 פסוקים")).toBeTruthy();
	});

	it("clicking a perush calls getPerushNotesForPage", () => {
		mockGetPerushNotesForPage.mockResolvedValue([]);
		const perushim: PerushSummary[] = [
			{
				id: 14,
				name: "ביאור שטיינזלץ",
				parshanName: "עדין שטיינזלץ",
				noteCount: 31,
			},
		];
		render(<PerushimSection perekId={1} perushim={perushim} />);
		fireEvent.click(screen.getByRole("button", { name: /ביאור שטיינזלץ/ }));
		expect(mockGetPerushNotesForPage).toHaveBeenCalledWith(14, 1);
	});
});
