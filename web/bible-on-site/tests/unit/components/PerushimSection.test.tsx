/**
 * @jest-environment jsdom
 */
jest.mock("../../../src/app/929/[number]/actions", () => ({
	getPerushNotesForPage: jest.fn(),
}));

import { act, fireEvent, render, screen } from "@testing-library/react";
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

	it("delegates to onPerushClick when provided", () => {
		const onPerushClick = jest.fn();
		const perushim: PerushSummary[] = [
			{ id: 1, name: "רש״י", parshanName: "רש״י", noteCount: 55 },
		];
		render(
			<PerushimSection
				perekId={1}
				perushim={perushim}
				onPerushClick={onPerushClick}
			/>,
		);
		fireEvent.click(screen.getByRole("button", { name: /רש״י/ }));
		expect(onPerushClick).toHaveBeenCalledWith(perushim[0]);
		expect(mockGetPerushNotesForPage).not.toHaveBeenCalled();
	});

	it("handles error in internal handlePerushClick", async () => {
		mockGetPerushNotesForPage.mockRejectedValue(new Error("fail"));
		const perushim: PerushSummary[] = [
			{ id: 1, name: "רש״י", parshanName: "רש״י", noteCount: 55 },
		];
		render(<PerushimSection perekId={1} perushim={perushim} />);

		await act(async () => {
			fireEvent.click(screen.getByRole("button", { name: /רש״י/ }));
		});

		// Should still show carousel (selected set to null on error)
		expect(screen.getByText("פרשנים על הפרק")).toBeTruthy();
	});
});
