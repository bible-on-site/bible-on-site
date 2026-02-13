jest.mock("pdf-lib", () => {
	const drawText = jest.fn();
	const mockPage = { drawText };
	const pages: (typeof mockPage)[] = [];
	const mockDoc = {
		embedFont: jest.fn().mockResolvedValue({ name: "Helvetica" }),
		addPage: jest.fn(() => {
			const p = { drawText: jest.fn() };
			pages.push(p);
			return p;
		}),
		getPages: jest.fn(() => pages),
		save: jest.fn().mockResolvedValue(new Uint8Array([80, 68, 70])),
	};
	return {
		PDFDocument: {
			create: jest.fn().mockResolvedValue(mockDoc),
		},
		rgb: jest.fn().mockReturnValue({ r: 0, g: 0, b: 0 }),
		StandardFonts: { Helvetica: "Helvetica" },
		__mockDoc: mockDoc,
		__mockPages: pages,
	};
});

jest.mock("../../../src/data/perek-dto", () => ({
	getPerekByPerekId: jest.fn(),
}));

jest.mock("../../../src/data/sefer-dto", () => ({
	getSeferByName: jest.fn(),
	getPerekIdsForSefer: jest.fn(),
}));

import { getPerekByPerekId } from "../../../src/data/perek-dto";
import {
	getPerekIdsForSefer,
	getSeferByName,
} from "../../../src/data/sefer-dto";
import {
	buildTanachPdfForPerekRange,
	createTanachPageRangesHandler,
} from "../../../src/lib/download/tanach-pdf";

const mockGetPerekByPerekId = getPerekByPerekId as jest.MockedFunction<
	typeof getPerekByPerekId
>;
const mockGetSeferByName = getSeferByName as jest.MockedFunction<
	typeof getSeferByName
>;
const mockGetPerekIdsForSefer = getPerekIdsForSefer as jest.MockedFunction<
	typeof getPerekIdsForSefer
>;

// Access mock internals for assertions
// biome-ignore lint/suspicious/noExplicitAny: test helper to access mock internals
const pdfLib = jest.requireMock("pdf-lib") as any;

function makePerek(
	sefer: string,
	perekHeb: string,
	header: string,
	pasukTexts: string[],
) {
	return {
		sefer,
		perekHeb,
		header,
		pesukim: pasukTexts.map((text) => ({
			segments: [{ type: "qri" as const, value: text }],
		})),
	};
}

describe("buildTanachPdfForPerekRange", () => {
	beforeEach(() => {
		jest.clearAllMocks();
		// Reset pages array
		pdfLib.__mockPages.length = 0;
	});

	it("produces a Uint8Array", async () => {
		mockGetPerekByPerekId.mockReturnValue(
			makePerek("בראשית", "א", "פרק א", ["בראשית ברא"]) as ReturnType<
				typeof getPerekByPerekId
			>,
		);

		const result = await buildTanachPdfForPerekRange([1]);

		expect(result).toBeInstanceOf(Uint8Array);
		expect(pdfLib.__mockDoc.save).toHaveBeenCalled();
		expect(pdfLib.__mockDoc.addPage).toHaveBeenCalled();
	});

	it("handles page overflow by adding new pages", async () => {
		// Create a perek with many pasukim to trigger page overflow.
		// pageHeight=842, margin=50, lineHeight=11*1.4=15.4
		// Available lines per page ~ (842 - 2*50) / 15.4 ~ 48 lines
		// With header + empty line + 50 pasukim we should exceed one page.
		const manyPasukim = Array.from({ length: 55 }, (_, i) => `פסוק ${i + 1}`);
		mockGetPerekByPerekId.mockReturnValue(
			makePerek("בראשית", "א", "פרק א", manyPasukim) as ReturnType<
				typeof getPerekByPerekId
			>,
		);

		await buildTanachPdfForPerekRange([1]);

		// Initial page + at least one overflow page
		expect(pdfLib.__mockDoc.addPage.mock.calls.length).toBeGreaterThan(1);
	});
});

describe("createTanachPageRangesHandler", () => {
	beforeEach(() => {
		jest.clearAllMocks();
		pdfLib.__mockPages.length = 0;
	});

	it('returns ["pdf", Uint8Array] for valid pages', async () => {
		const mockSefer = { name: "בראשית", perekFrom: 1, perekTo: 50 };
		mockGetSeferByName.mockReturnValue(
			mockSefer as ReturnType<typeof getSeferByName>,
		);
		mockGetPerekIdsForSefer.mockReturnValue([1, 2, 3]);
		mockGetPerekByPerekId.mockReturnValue(
			makePerek("בראשית", "א", "פרק א", ["בראשית ברא"]) as ReturnType<
				typeof getPerekByPerekId
			>,
		);

		const handler = createTanachPageRangesHandler();
		const result = await handler([1], [{ pageIndex: 1 }], {
			seferName: "בראשית",
		});

		expect(result[0]).toBe("pdf");
		expect(result[1]).toBeInstanceOf(Uint8Array);
	});

	it("throws when context.seferName is missing", async () => {
		const handler = createTanachPageRangesHandler();

		await expect(handler([1], [{ pageIndex: 1 }], {})).rejects.toThrow(
			"Tanach PDF requires context.seferName",
		);
	});

	it("throws when context is undefined", async () => {
		const handler = createTanachPageRangesHandler();

		await expect(handler([1], [{ pageIndex: 1 }], undefined)).rejects.toThrow(
			"Tanach PDF requires context.seferName",
		);
	});

	it("throws when no content pages in range (only even pages)", async () => {
		const mockSefer = { name: "בראשית", perekFrom: 1, perekTo: 50 };
		mockGetSeferByName.mockReturnValue(
			mockSefer as ReturnType<typeof getSeferByName>,
		);
		mockGetPerekIdsForSefer.mockReturnValue([1, 2, 3]);

		const handler = createTanachPageRangesHandler();

		await expect(
			handler([0, 2, 4], [{ pageIndex: 0 }], { seferName: "בראשית" }),
		).rejects.toThrow("No content pages in selected range");
	});

	it("skips cover (0) and blank (even) pages", async () => {
		const mockSefer = { name: "בראשית", perekFrom: 1, perekTo: 50 };
		mockGetSeferByName.mockReturnValue(
			mockSefer as ReturnType<typeof getSeferByName>,
		);
		mockGetPerekIdsForSefer.mockReturnValue([10, 20, 30]);
		mockGetPerekByPerekId.mockReturnValue(
			makePerek("בראשית", "א", "פרק א", ["text"]) as ReturnType<
				typeof getPerekByPerekId
			>,
		);

		const handler = createTanachPageRangesHandler();
		// pages: 0 = cover (skipped), 1 = perek[0]=10, 2 = blank (skipped),
		//         3 = perek[1]=20, 4 = blank (skipped)
		const result = await handler([0, 1, 2, 3, 4], [{ pageIndex: 0 }], {
			seferName: "בראשית",
		});

		expect(result[0]).toBe("pdf");
		// getPerekByPerekId should be called for perek IDs 10 and 20 only (pages 1 and 3)
		expect(mockGetPerekByPerekId).toHaveBeenCalledWith(10);
		expect(mockGetPerekByPerekId).toHaveBeenCalledWith(20);
		expect(mockGetPerekByPerekId).toHaveBeenCalledTimes(2);
	});
});
