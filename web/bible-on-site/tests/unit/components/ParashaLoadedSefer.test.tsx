/**
 * @jest-environment jsdom
 *
 * Unit tests for ParashaLoadedSefer — the lazy loader behind the פרשה
 * sefer book. It fetches the Torah sefer file plus just the perakim the
 * parashot's Haftarot reach (one range-scoped request), builds a
 * canonical perekId → perek map, and only then renders the flipbook.
 */
import { act, fireEvent, render, screen } from "@testing-library/react";
import type { ParashaBookUnit } from "@/app/parasha/[unit]/components/parasha-book-utils";
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

jest.mock("@/app/components/reading/unit-book-actions", () => ({
	getPerakimText: jest.fn(),
}));

let capturedSeferProps: Record<string, unknown> = {};
jest.mock("@/app/parasha/[unit]/components/ParashaSefer", () => ({
	__esModule: true,
	default: (props: Record<string, unknown>) => {
		capturedSeferProps = props;
		return <div data-testid="parasha-book" />;
	},
}));

import ParashaLoadedSefer from "@/app/parasha/[unit]/components/ParashaLoadedSefer";
import { getPerakimText } from "@/app/components/reading/unit-book-actions";
import catalog from "@/data/db/client-catalog.generated.json";
import { BookRequestError, loadSefer } from "@/data/load-sefer";

const mockLoad = jest.mocked(loadSefer);
const mockGetPerakimText = jest.mocked(getPerakimText);

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

/** A parasha whose Haftarah reaches ישעיהו (perekIds 335–400). */
const unitWithHaftara: ParashaBookUnit = {
	unitId: 1,
	slug: "בראשית",
	name: "בראשית",
	order: 1,
	refSpan: "בראשית א א - ו ח",
	ranges: [range(1, 1, 6, 8)],
	haftarot: [
		{
			id: "haftara-ashkenazi",
			label: "אשכנזים",
			refSpan: "ישעיהו מב ה - מג א",
			ranges: [range(335, 5, 336, 1)],
		},
	],
	notes: [],
};

const torahOnlyUnit: ParashaBookUnit = {
	...unitWithHaftara,
	haftarot: [],
};

const baseProps = (units: ParashaBookUnit[] = [unitWithHaftara]) => ({
	units,
	seferName: "בראשית",
	currentUnitId: 1,
	entityRefsByPerek: {},
	perekSources: {},
	articles: [],
	perushim: [],
	haftaraArticles: [],
	haftaraPerushim: [],
	initialBookPage: null,
	haftara: false,
});

// בראשית (perekIds 1–50) is the generated file the fixtures resolve
// through the client catalog; Haftarah perakim arrive via getPerakimText.
const BERESHIT_FILE = catalogFileOf("בראשית");

beforeEach(() => {
	mockLoad.mockReset();
	mockGetPerakimText.mockReset().mockResolvedValue({});
	capturedSeferProps = {};
});

describe("ParashaLoadedSefer", () => {
	it("loads the Torah sefer plus just the perakim its Haftarot reach", async () => {
		const auxPesukim = { pesukim: [{ segments: [{ type: "stuma" as const }] }] };
		mockLoad.mockImplementation(() =>
			Promise.resolve(seferWithPerakim(1, [perek("א")])),
		);
		mockGetPerakimText.mockResolvedValue({
			335: auxPesukim,
			336: auxPesukim,
		});
		render(<ParashaLoadedSefer {...baseProps()} />);
		expect(screen.getByLabelText("טוען תצוגת ספר...")).toBeInTheDocument();
		expect(await screen.findByTestId("parasha-book")).toBeInTheDocument();
		expect(mockLoad.mock.calls.map(([file]) => file)).toEqual([
			BERESHIT_FILE,
		]);
		expect(mockGetPerakimText).toHaveBeenCalledWith([335, 336]);
		const perekById = capturedSeferProps.perekById as Map<number, Perek>;
		expect(perekById.get(1)?.header).toBe("א");
		expect(perekById.get(336)?.pesukim).toEqual(auxPesukim.pesukim);
	});

	it("maps perakim through book additionals when a sefer is split", async () => {
		mockLoad.mockResolvedValue(
			seferWithAdditionals([
				{ letter: "א", perekFrom: 288, perakim: [perek("א"), perek("ב")] },
				{ letter: "ב", perekFrom: 290, perakim: [perek("א")] },
			]) as SefarimItem,
		);
		render(<ParashaLoadedSefer {...baseProps([torahOnlyUnit])} />);
		expect(await screen.findByTestId("parasha-book")).toBeInTheDocument();
		const perekById = capturedSeferProps.perekById as Map<number, Perek>;
		expect(perekById.get(289)?.header).toBe("ב");
		expect(perekById.get(290)?.header).toBe("א");
	});

	it("loads only the auxiliary perakim when the main sefer is unknown", async () => {
		mockGetPerakimText.mockResolvedValue({
			335: { pesukim: [] },
			336: { pesukim: [] },
		});
		render(<ParashaLoadedSefer {...baseProps()} seferName="לא קיים" />);
		expect(await screen.findByTestId("parasha-book")).toBeInTheDocument();
		expect(mockLoad).not.toHaveBeenCalled();
		expect(mockGetPerakimText).toHaveBeenCalledWith([335, 336]);
	});

	it("fetches no auxiliary perakim for parashot without Haftarot", async () => {
		mockLoad.mockImplementation(() =>
			Promise.resolve(seferWithPerakim(1, [perek("א")])),
		);
		render(<ParashaLoadedSefer {...baseProps([torahOnlyUnit])} />);
		expect(await screen.findByTestId("parasha-book")).toBeInTheDocument();
		expect(mockLoad).toHaveBeenCalledTimes(1);
		expect(mockLoad).toHaveBeenCalledWith(BERESHIT_FILE);
		expect(mockGetPerakimText).toHaveBeenCalledWith([]);
	});

	it("keeps the loading indicator while the loaded map is stale", async () => {
		let pending = false;
		const pendingResolvers: Array<
			(value: Record<number, { pesukim: Perek["pesukim"] }>) => void
		> = [];
		mockLoad.mockImplementation(() =>
			Promise.resolve(seferWithPerakim(1, [perek("א")])),
		);
		mockGetPerakimText.mockImplementation(() => {
			if (pending) {
				return new Promise((done) => pendingResolvers.push(done));
			}
			return Promise.resolve({});
		});
		const otherUnit: ParashaBookUnit = {
			...unitWithHaftara,
			haftarot: [
				{
					id: "haftara-ashkenazi",
					label: "אשכנזים",
					refSpan: "ירמיהו א א-י",
					ranges: [range(401, 1, 401, 10)],
				},
			],
		};
		const view = render(<ParashaLoadedSefer {...baseProps([torahOnlyUnit])} />);
		expect(await screen.findByTestId("parasha-book")).toBeInTheDocument();
		// A new set of needed files restarts the load; until it resolves the
		// previous map must not render as if it were current.
		pending = true;
		view.rerender(<ParashaLoadedSefer {...baseProps([otherUnit])} />);
		expect(screen.queryByTestId("parasha-book")).toBeNull();
		expect(screen.getByLabelText("טוען תצוגת ספר...")).toBeInTheDocument();
		await act(async () => {
			for (const done of pendingResolvers) {
				done({ 401: { pesukim: [] } });
			}
		});
		expect(await screen.findByTestId("parasha-book")).toBeInTheDocument();
		const perekById = capturedSeferProps.perekById as Map<
			number,
			Pick<Perek, "pesukim">
		>;
		expect(perekById.get(401)?.pesukim).toEqual([]);
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
				render(<ParashaLoadedSefer {...baseProps([torahOnlyUnit])} />);
				expect(await screen.findByRole("alert")).toHaveTextContent(
					"לא ניתן לטעון את הספר.",
				);
				expect(diagnostic).toHaveBeenCalledWith(
					"Failed to load parasha book",
					expect.objectContaining({ error: failure }),
				);
				fireEvent.click(screen.getByRole("button", { name: "נסה שוב" }));
				expect(await screen.findByTestId("parasha-book")).toBeInTheDocument();
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
			history.replaceState(null, "", "/פרשה/בראשית?book&bookPage=5");
			mockLoad.mockRejectedValueOnce(new BookRequestError(404));
			render(<ParashaLoadedSefer {...baseProps([torahOnlyUnit])} />);
			await screen.findByRole("alert");
			const href =
				screen
					.getByRole("link", { name: "רענן את הדף" })
					.getAttribute("href") ?? "";
			expect(decodeURIComponent(href)).toBe("/פרשה/בראשית?book&bookPage=5");
			expect(
				screen.queryByRole("button", { name: "נסה שוב" }),
			).not.toBeInTheDocument();
		} finally {
			diagnostic.mockRestore();
			history.replaceState(null, "", previousUrl);
		}
	});

	it("ignores a late failure after the component unmounts", async () => {
		let reject!: (error: Error) => void;
		mockLoad.mockReturnValue(
			new Promise((_done, fail) => {
				reject = fail;
			}),
		);
		const diagnostic = jest
			.spyOn(console, "error")
			.mockImplementation(() => {});
		try {
			const { unmount } = render(
				<ParashaLoadedSefer {...baseProps([torahOnlyUnit])} />,
			);
			unmount();
			await act(async () => {
				reject(new Error("late failure"));
			});
			expect(diagnostic).not.toHaveBeenCalled();
		} finally {
			diagnostic.mockRestore();
		}
	});

	it("ignores a late resolution after the component unmounts", async () => {
		let resolve!: (value: SefarimItem) => void;
		mockLoad.mockReturnValue(
			new Promise((done) => {
				resolve = done;
			}),
		);
		const { unmount } = render(
			<ParashaLoadedSefer {...baseProps([torahOnlyUnit])} />,
		);
		unmount();
		await act(async () => {
			resolve(seferWithPerakim(1, [perek("א")]));
		});
		expect(screen.queryByTestId("parasha-book")).toBeNull();
	});
});
