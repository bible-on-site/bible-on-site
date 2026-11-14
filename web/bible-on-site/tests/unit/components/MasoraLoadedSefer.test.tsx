/**
 * @jest-environment jsdom
 *
 * Unit tests for MasoraLoadedSefer — the lazy loader behind the מסורה
 * sefer book. It fetches the sefer's own generated JSON (Masoretic
 * units never cross sefarim), builds a canonical perekId → perek map,
 * and only then renders the flipbook.
 */
import { act, fireEvent, render, screen } from "@testing-library/react";
import type { MasoraBookUnit } from "@/app/masora/[unit]/components/masora-book-utils";
import type {
	Perek,
	SefarimItem,
	SefarimItemWithAdditionals,
	SefarimItemWithPerakim,
} from "@/data/db/tanah-view-types";
import type { ScriptureRange } from "@/lib/reading/contract";

jest.mock("@/data/load-sefer", () => ({
	...jest.requireActual("@/data/load-sefer"),
	loadSefer: jest.fn(),
}));

let capturedSeferProps: Record<string, unknown> = {};
jest.mock("@/app/masora/[unit]/components/MasoraSefer", () => ({
	__esModule: true,
	default: (props: Record<string, unknown>) => {
		capturedSeferProps = props;
		return <div data-testid="masora-book" />;
	},
}));

import MasoraLoadedSefer from "@/app/masora/[unit]/components/MasoraLoadedSefer";
import catalog from "@/data/db/client-catalog.generated.json";
import { BookRequestError, loadSefer } from "@/data/load-sefer";

const mockLoad = jest.mocked(loadSefer);

const catalogFileOf = (seferName: string): string => {
	const file = catalog.books.find((book) => book.name === seferName)?.file;
	if (!file) throw new Error(`fixture: no catalog file for ${seferName}`);
	return file;
};

const range = (
	startPerek: number,
	startPasuk: number,
	endPerek: number,
	endPasuk: number,
): ScriptureRange => ({
	start: { perekId: startPerek, pasuk: startPasuk },
	end: { perekId: endPerek, pasuk: endPasuk },
});

const perek = (header: string): Perek => ({
	header,
	date: [],
	star_rise: [],
	pesukim: [],
});

function seferWithPerakim(
	perekFrom: number,
	perakim: Perek[],
): SefarimItemWithPerakim {
	return {
		name: `sefer-${perekFrom}`,
		helek: "תורה",
		tanachUsName: "Fixture",
		perekFrom,
		perekTo: perekFrom + perakim.length - 1,
		pesukimCount: 0,
		perakim,
	};
}

const seferWithAdditionals = (
	additionals: { letter: string; perekFrom: number; perakim: Perek[] }[],
): SefarimItemWithAdditionals => ({
	name: "split-sefer",
	helek: "נביאים",
	perekFrom: additionals[0].perekFrom,
	perekTo: additionals[additionals.length - 1].perekFrom + 1,
	pesukimCount: 0,
	additionals: additionals.map((additional) => ({
		...additional,
		perekTo: additional.perekFrom + additional.perakim.length - 1,
		helek: "נביאים",
		name: `split ${additional.letter}`,
		tanachUsName: "Fixture",
		pesukimCount: 0,
	})) as [never, never],
});

const unit: MasoraBookUnit = {
	unitId: 1,
	order: 1,
	heading: "בראשית א א-ה",
	ranges: [range(1, 1, 1, 5)],
	closingBreak: "ptuha",
};

const baseProps = () => ({
	units: [unit],
	seferName: "בראשית",
	currentUnitId: 1,
	entityRefsByPerek: {},
	perekSources: {},
	articles: [],
	perushim: [],
	initialBookPage: null,
});

const BERESHIT_FILE = catalogFileOf("בראשית");

beforeEach(() => {
	mockLoad.mockReset();
	capturedSeferProps = {};
});

describe("MasoraLoadedSefer", () => {
	it("loads the sefer's own file and maps its perakim", async () => {
		mockLoad.mockImplementation(() =>
			Promise.resolve(seferWithPerakim(1, [perek("א"), perek("ב")])),
		);
		const props = baseProps();
		render(<MasoraLoadedSefer {...props} />);
		expect(screen.getByLabelText("טוען תצוגת ספר...")).toBeInTheDocument();
		expect(await screen.findByTestId("masora-book")).toBeInTheDocument();
		expect(mockLoad).toHaveBeenCalledTimes(1);
		expect(mockLoad).toHaveBeenCalledWith(BERESHIT_FILE);
		const perekById = capturedSeferProps.perekById as Map<number, Perek>;
		expect(perekById.get(1)?.header).toBe("א");
		expect(perekById.get(2)?.header).toBe("ב");
		// The page's own props flow through untouched.
		expect(capturedSeferProps.units).toBe(props.units);
		expect(capturedSeferProps.currentUnitId).toBe(1);
	});

	it("maps perakim through book additionals when a sefer is split", async () => {
		mockLoad.mockResolvedValue(
			seferWithAdditionals([
				{ letter: "א", perekFrom: 288, perakim: [perek("א"), perek("ב")] },
				{ letter: "ב", perekFrom: 290, perakim: [perek("א")] },
			]) as SefarimItem,
		);
		render(<MasoraLoadedSefer {...baseProps()} />);
		expect(await screen.findByTestId("masora-book")).toBeInTheDocument();
		const perekById = capturedSeferProps.perekById as Map<number, Perek>;
		expect(perekById.get(289)?.header).toBe("ב");
		expect(perekById.get(290)?.header).toBe("א");
	});

	it("fails immediately for a sefer missing from the catalog", async () => {
		render(<MasoraLoadedSefer {...baseProps()} seferName="לא קיים" />);
		expect(await screen.findByRole("alert")).toHaveTextContent(
			"לא ניתן לטעון את הספר.",
		);
		// No fetch was attempted and the failure offers a retry, not a
		// page refresh — the asset list itself is at fault.
		expect(mockLoad).not.toHaveBeenCalled();
		expect(
			screen.getByRole("button", { name: "נסה שוב" }),
		).toBeInTheDocument();
	});

	it.each([new Error("network"), new BookRequestError(503)])(
		"reports a failed load and retries on demand (%s)",
		async (failure) => {
			const diagnostic = jest
				.spyOn(console, "error")
				.mockImplementation(() => {});
			try {
				mockLoad
					.mockRejectedValueOnce(failure)
					.mockImplementationOnce(() =>
						Promise.resolve(seferWithPerakim(1, [perek("א")])),
					);
				render(<MasoraLoadedSefer {...baseProps()} />);
				expect(await screen.findByRole("alert")).toHaveTextContent(
					"לא ניתן לטעון את הספר.",
				);
				expect(diagnostic).toHaveBeenCalledWith(
					"Failed to load masora book",
					expect.objectContaining({ error: failure }),
				);
				fireEvent.click(screen.getByRole("button", { name: "נסה שוב" }));
				expect(await screen.findByTestId("masora-book")).toBeInTheDocument();
				expect(mockLoad).toHaveBeenCalledTimes(2);
			} finally {
				diagnostic.mockRestore();
			}
		},
	);

	it("offers a full page refresh for a missing asset", async () => {
		const previousUrl = window.location.href;
		const diagnostic = jest
			.spyOn(console, "error")
			.mockImplementation(() => {});
		try {
			history.replaceState(null, "", "/מסורה/1?book&bookPage=back");
			mockLoad.mockRejectedValueOnce(new BookRequestError(404));
			render(<MasoraLoadedSefer {...baseProps()} />);
			await screen.findByRole("alert");
			const href =
				screen
					.getByRole("link", { name: "רענן את הדף" })
					.getAttribute("href") ?? "";
			expect(decodeURIComponent(href)).toBe("/מסורה/1?book&bookPage=back");
			expect(
				screen.queryByRole("button", { name: "נסה שוב" }),
			).not.toBeInTheDocument();
		} finally {
			diagnostic.mockRestore();
			history.replaceState(null, "", previousUrl);
		}
	});

	it("ignores a late resolution after the component unmounts", async () => {
		let resolve!: (value: SefarimItem) => void;
		mockLoad.mockReturnValue(
			new Promise((done) => {
				resolve = done;
			}),
		);
		const { unmount } = render(<MasoraLoadedSefer {...baseProps()} />);
		unmount();
		await act(async () => {
			resolve(seferWithPerakim(1, [perek("א")]));
		});
		expect(screen.queryByTestId("masora-book")).toBeNull();
	});
});
