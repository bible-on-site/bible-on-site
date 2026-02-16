jest.mock("node:fs", () => ({
	readFileSync: jest.fn().mockReturnValue(new Uint8Array([0, 1, 2, 3])),
}));

jest.mock("@pdf-lib/fontkit", () => ({
	create: jest.fn(),
}));

jest.mock("pdf-lib", () => {
	const drawText = jest.fn();
	const drawLine = jest.fn();
	const mockPage = { drawText, drawLine };
	const pages: (typeof mockPage)[] = [];
	const mockFont = {
		name: "FrankRuhlLibre-Regular",
		widthOfTextAtSize: jest.fn().mockReturnValue(50),
	};
	const mockBoldFont = {
		name: "FrankRuhlLibre-Bold",
		widthOfTextAtSize: jest.fn().mockReturnValue(55),
	};
	const mockDoc = {
		registerFontkit: jest.fn(),
		embedFont: jest.fn().mockImplementation((_bytes, _opts) => {
			// First call = regular, second call = bold
			if (mockDoc.embedFont.mock.calls.length <= 1) {
				return Promise.resolve(mockFont);
			}
			return Promise.resolve(mockBoldFont);
		}),
		addPage: jest.fn(() => {
			const p = { drawText: jest.fn(), drawLine: jest.fn() };
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
		__mockDoc: mockDoc,
		__mockPages: pages,
		__mockFont: mockFont,
		__mockBoldFont: mockBoldFont,
	};
});

jest.mock("../../../src/data/perek-dto", () => ({
	getPerekByPerekId: jest.fn(),
}));

jest.mock("../../../src/data/sefer-dto", () => ({
	getSeferByName: jest.fn(),
	getPerekIdsForSefer: jest.fn(),
}));

jest.mock("../../../src/lib/perushim", () => ({
	getPerushimByPerekId: jest.fn(),
}));

jest.mock("../../../src/lib/articles/service", () => ({
	getArticlesByPerekId: jest.fn(),
}));

import { getPerekByPerekId } from "../../../src/data/perek-dto";
import {
	getPerekIdsForSefer,
	getSeferByName,
} from "../../../src/data/sefer-dto";
import { getPerushimByPerekId } from "../../../src/lib/perushim";
import { getArticlesByPerekId } from "../../../src/lib/articles/service";
import {
	buildTanachPdfForPerekRange,
	createTanachPageRangesHandler,
	segmentsToText,
	semanticPagesToPerekIds,
	stripHtml,
	wrapText,
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
const mockGetPerushimByPerekId = getPerushimByPerekId as jest.MockedFunction<
	typeof getPerushimByPerekId
>;
const mockGetArticlesByPerekId = getArticlesByPerekId as jest.MockedFunction<
	typeof getArticlesByPerekId
>;

// biome-ignore lint/suspicious/noExplicitAny: test helper to access mock internals
const pdfLib = jest.requireMock("pdf-lib") as any;

function makePerek(
	sefer: string,
	perekHeb: string,
	header: string,
	pasukTexts: string[],
) {
	return {
		perekId: 1,
		sefer,
		perekHeb,
		header,
		helek: "תורה",
		source: `${sefer} ${perekHeb}`,
		pesukim: pasukTexts.map((text) => ({
			segments: [{ type: "qri" as const, value: text }],
		})),
	};
}

describe("segmentsToText", () => {
	it("extracts qri text and joins with spaces", () => {
		const segments = [
			{ type: "qri" as const, value: "בְּרֵאשִׁית" },
			{ type: "stuma" as const, value: "" },
			{ type: "qri" as const, value: "בָּרָא" },
		];
		expect(segmentsToText(segments)).toBe("בְּרֵאשִׁית בָּרָא");
	});

	it("handles ktiv segments", () => {
		const segments = [{ type: "ktiv" as const, value: "הִוא" }];
		expect(segmentsToText(segments)).toBe("הִוא");
	});

	it("returns empty string for no qri/ktiv segments", () => {
		const segments = [
			{ type: "stuma" as const, value: "" },
			{ type: "ptuha" as const, value: "" },
		];
		expect(segmentsToText(segments)).toBe("");
	});
});

describe("stripHtml", () => {
	it("strips HTML tags", () => {
		expect(stripHtml("<p>Hello <b>world</b></p>")).toBe("Hello world");
	});

	it("decodes HTML entities", () => {
		expect(stripHtml("a &amp; b &lt; c")).toBe("a & b < c");
	});

	it("handles empty string", () => {
		expect(stripHtml("")).toBe("");
	});

	it("handles br tags as spaces", () => {
		expect(stripHtml("line1<br/>line2")).toBe("line1 line2");
	});
});

describe("wrapText", () => {
	const mockFont = {
		widthOfTextAtSize: (text: string, _size: number) => text.length * 10,
	};

	it("wraps long text into multiple lines", () => {
		const result = wrapText("one two three four five", mockFont, 12, 100);
		expect(result.length).toBeGreaterThan(1);
	});

	it("keeps short text on one line", () => {
		const result = wrapText("short", mockFont, 12, 200);
		expect(result).toEqual(["short"]);
	});

	it("returns empty line for empty text", () => {
		const result = wrapText("", mockFont, 12, 200);
		expect(result).toEqual([""]);
	});

	it("handles a single very long word", () => {
		const result = wrapText("superlongword", mockFont, 12, 50);
		expect(result).toEqual(["superlongword"]);
	});
});

describe("semanticPagesToPerekIds", () => {
	beforeEach(() => {
		jest.clearAllMocks();
	});

	it("maps Hebrew semantic names to correct perek IDs", () => {
		const mockSefer = { name: "במדבר", perekFrom: 360, perekTo: 395 };
		mockGetSeferByName.mockReturnValue(
			mockSefer as ReturnType<typeof getSeferByName>,
		);
		// Bamidbar has 36 perakim: IDs 360-395
		mockGetPerekIdsForSefer.mockReturnValue(
			Array.from({ length: 36 }, (_, i) => 360 + i),
		);

		const semanticPages = [
			{ pageIndex: 3, semanticName: "א'", title: "מפקד בני ישראל" },
			{ pageIndex: 5, semanticName: "ב'", title: "חניה לפי דגלים" },
			{ pageIndex: 7, semanticName: "ג'", title: "תולדות אהרן" },
		];

		const result = semanticPagesToPerekIds(semanticPages, "במדבר");

		expect(result).toEqual([360, 361, 362]);
		expect(mockGetSeferByName).toHaveBeenCalledWith("במדבר");
	});

	it("deduplicates perek IDs", () => {
		const mockSefer = { name: "בראשית" };
		mockGetSeferByName.mockReturnValue(
			mockSefer as ReturnType<typeof getSeferByName>,
		);
		mockGetPerekIdsForSefer.mockReturnValue([1, 2, 3]);

		const semanticPages = [
			{ pageIndex: 3, semanticName: "א'", title: "בראשית" },
			{ pageIndex: 3, semanticName: "א'", title: "בראשית" },
		];

		const result = semanticPagesToPerekIds(semanticPages, "בראשית");

		expect(result).toEqual([1]);
	});

	it("skips pages with invalid semantic names", () => {
		const mockSefer = { name: "בראשית" };
		mockGetSeferByName.mockReturnValue(
			mockSefer as ReturnType<typeof getSeferByName>,
		);
		mockGetPerekIdsForSefer.mockReturnValue([1, 2, 3]);

		const semanticPages = [
			{ pageIndex: 0, semanticName: "", title: "" },
			{ pageIndex: 3, semanticName: "א'", title: "בראשית" },
		];

		const result = semanticPagesToPerekIds(semanticPages, "בראשית");

		expect(result).toEqual([1]);
	});

	it("skips perek numbers beyond sefer range", () => {
		const mockSefer = { name: "בראשית" };
		mockGetSeferByName.mockReturnValue(
			mockSefer as ReturnType<typeof getSeferByName>,
		);
		mockGetPerekIdsForSefer.mockReturnValue([1, 2]);

		const semanticPages = [
			{ pageIndex: 3, semanticName: "א'", title: "" },
			{ pageIndex: 7, semanticName: "ק'", title: "" }, // 100 — way beyond range
		];

		const result = semanticPagesToPerekIds(semanticPages, "בראשית");

		expect(result).toEqual([1]);
	});
});

describe("buildTanachPdfForPerekRange", () => {
	beforeEach(() => {
		jest.clearAllMocks();
		pdfLib.__mockPages.length = 0;
		// Reset embedFont call counter
		pdfLib.__mockDoc.embedFont.mockImplementation(() => {
			if (pdfLib.__mockDoc.embedFont.mock.calls.length <= 1) {
				return Promise.resolve(pdfLib.__mockFont);
			}
			return Promise.resolve(pdfLib.__mockBoldFont);
		});
		mockGetPerushimByPerekId.mockResolvedValue([]);
		mockGetArticlesByPerekId.mockResolvedValue([]);
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
	});

	it("registers fontkit and embeds two fonts (regular + bold)", async () => {
		mockGetPerekByPerekId.mockReturnValue(
			makePerek("בראשית", "א", "פרק א", ["בראשית ברא"]) as ReturnType<
				typeof getPerekByPerekId
			>,
		);

		await buildTanachPdfForPerekRange([1]);

		expect(pdfLib.__mockDoc.registerFontkit).toHaveBeenCalled();
		expect(pdfLib.__mockDoc.embedFont).toHaveBeenCalledTimes(2);
		expect(pdfLib.__mockDoc.embedFont).toHaveBeenCalledWith(
			expect.any(Uint8Array),
			{ subset: true },
		);
	});

	it("creates a new page for each perek", async () => {
		mockGetPerekByPerekId
			.mockReturnValueOnce(
				makePerek("בראשית", "א", "בריאת העולם", ["בראשית ברא"]) as ReturnType<
					typeof getPerekByPerekId
				>,
			)
			.mockReturnValueOnce(
				makePerek("בראשית", "ב", "גן עדן", ["אלה תולדות"]) as ReturnType<
					typeof getPerekByPerekId
				>,
			);

		await buildTanachPdfForPerekRange([1, 2]);

		// Should add 2 pages (one per perek)
		expect(pdfLib.__mockDoc.addPage).toHaveBeenCalledTimes(2);
	});

	it("draws title in bold and header in regular font", async () => {
		mockGetPerekByPerekId.mockReturnValue(
			makePerek("בראשית", "א", "בריאת העולם", ["text"]) as ReturnType<
				typeof getPerekByPerekId
			>,
		);

		await buildTanachPdfForPerekRange([1]);

		const page = pdfLib.__mockPages[0];
		const calls = page.drawText.mock.calls;
		expect(calls.length).toBeGreaterThanOrEqual(2);

		// First call should be the title "בראשית א" with the bold font
		const titleCall = calls[0];
		expect(titleCall[0]).toBe("בראשית א");
		expect(titleCall[1].font).toBe(pdfLib.__mockBoldFont);
		expect(titleCall[1].size).toBe(18);

		// Second call should be the header with regular font
		const headerCall = calls[1];
		expect(headerCall[0]).toBe("בריאת העולם");
		expect(headerCall[1].font).toBe(pdfLib.__mockFont);
	});

	it("right-aligns text for RTL layout", async () => {
		mockGetPerekByPerekId.mockReturnValue(
			makePerek("בראשית", "א", "פרק א", ["בראשית ברא"]) as ReturnType<
				typeof getPerekByPerekId
			>,
		);

		await buildTanachPdfForPerekRange([1]);

		const page = pdfLib.__mockPages[0];
		const calls = page.drawText.mock.calls;
		for (const call of calls) {
			const opts = call[1];
			expect(opts.x).toBeGreaterThanOrEqual(50); // margin
		}
	});

	it("handles perek with empty header gracefully", async () => {
		mockGetPerekByPerekId.mockReturnValue(
			makePerek("בראשית", "א", "", ["בראשית ברא"]) as ReturnType<
				typeof getPerekByPerekId
			>,
		);

		const result = await buildTanachPdfForPerekRange([1]);
		expect(result).toBeInstanceOf(Uint8Array);

		const page = pdfLib.__mockPages[0];
		const calls = page.drawText.mock.calls;
		// Should not have a header line — just title + pasuk + page number
		const texts = calls.map((c: [string]) => c[0]);
		expect(texts).not.toContain("");
	});

	it("includes perushim section when available", async () => {
		mockGetPerekByPerekId.mockReturnValue(
			makePerek("בראשית", "א", "פרק א", ["text"]) as ReturnType<
				typeof getPerekByPerekId
			>,
		);
		mockGetPerushimByPerekId.mockResolvedValue([
			{ id: 1, name: "רש\"י", parshanName: "רבי שלמה יצחקי", noteCount: 5 },
			{ id: 2, name: "אבן עזרא", parshanName: "אברהם אבן עזרא", noteCount: 3 },
		]);

		await buildTanachPdfForPerekRange([1]);

		const page = pdfLib.__mockPages[0];
		const allText = page.drawText.mock.calls.map(
			(c: [string]) => c[0],
		);

		expect(allText).toContain("פירושים זמינים");
		expect(allText.some((t: string) => t.includes("רש\"י"))).toBe(true);
		expect(allText.some((t: string) => t.includes("אבן עזרא"))).toBe(true);
	});

	it("includes articles section when available", async () => {
		mockGetPerekByPerekId.mockReturnValue(
			makePerek("בראשית", "א", "פרק א", ["text"]) as ReturnType<
				typeof getPerekByPerekId
			>,
		);
		mockGetArticlesByPerekId.mockResolvedValue([
			{
				id: 1,
				perekId: 1,
				authorId: 1,
				abstract: "<p>This is an <b>abstract</b></p>",
				content: null,
				name: "מאמר על בריאת העולם",
				priority: 1,
				authorName: "הרב כהן",
				authorImageUrl: "",
			},
		]);

		await buildTanachPdfForPerekRange([1]);

		const page = pdfLib.__mockPages[0];
		const allText = page.drawText.mock.calls.map(
			(c: [string]) => c[0],
		);

		expect(allText).toContain("מאמרים");
		expect(allText).toContain("• מאמר על בריאת העולם");
		expect(allText).toContain("מאת: הרב כהן");
		// HTML should be stripped from abstract
		expect(allText.some((t: string) => t.includes("This is an abstract"))).toBe(
			true,
		);
	});

	it("gracefully handles DB errors for perushim/articles", async () => {
		mockGetPerekByPerekId.mockReturnValue(
			makePerek("בראשית", "א", "פרק א", ["text"]) as ReturnType<
				typeof getPerekByPerekId
			>,
		);
		mockGetPerushimByPerekId.mockRejectedValue(new Error("DB down"));
		mockGetArticlesByPerekId.mockRejectedValue(new Error("DB down"));

		const result = await buildTanachPdfForPerekRange([1]);
		expect(result).toBeInstanceOf(Uint8Array);
	});

	it("adds page numbers to all pages", async () => {
		mockGetPerekByPerekId.mockReturnValue(
			makePerek("בראשית", "א", "פרק א", ["text"]) as ReturnType<
				typeof getPerekByPerekId
			>,
		);

		await buildTanachPdfForPerekRange([1]);

		// The page number "1" should be drawn on the first page
		const page = pdfLib.__mockPages[0];
		const allText = page.drawText.mock.calls.map(
			(c: [string]) => c[0],
		);
		expect(allText).toContain("1");
	});
});

describe("createTanachPageRangesHandler", () => {
	beforeEach(() => {
		jest.clearAllMocks();
		pdfLib.__mockPages.length = 0;
		pdfLib.__mockDoc.embedFont.mockImplementation(() => {
			if (pdfLib.__mockDoc.embedFont.mock.calls.length <= 1) {
				return Promise.resolve(pdfLib.__mockFont);
			}
			return Promise.resolve(pdfLib.__mockBoldFont);
		});
		mockGetPerushimByPerekId.mockResolvedValue([]);
		mockGetArticlesByPerekId.mockResolvedValue([]);
	});

	it("uses semanticPages to resolve perek IDs (not hardcoded formula)", async () => {
		const mockSefer = { name: "במדבר", perekFrom: 360, perekTo: 395 };
		mockGetSeferByName.mockReturnValue(
			mockSefer as ReturnType<typeof getSeferByName>,
		);
		// perekIds[0]=360 (א), perekIds[1]=361 (ב), perekIds[2]=362 (ג)
		mockGetPerekIdsForSefer.mockReturnValue([360, 361, 362, 363]);
		mockGetPerekByPerekId.mockReturnValue(
			makePerek("במדבר", "א", "מפקד", ["text"]) as ReturnType<
				typeof getPerekByPerekId
			>,
		);

		const handler = createTanachPageRangesHandler();
		const semanticPages = [
			{ pageIndex: 3, semanticName: "א'", title: "מפקד" },
			{ pageIndex: 5, semanticName: "ב'", title: "דגלים" },
			{ pageIndex: 7, semanticName: "ג'", title: "תולדות" },
		];

		const result = await handler(
			[3, 4, 5, 6, 7],
			semanticPages,
			{ seferName: "במדבר" },
		);

		expect(result[0]).toBe("pdf");
		expect(result[1]).toBeInstanceOf(Uint8Array);

		// Should have called getPerekByPerekId with the CORRECT IDs: 360, 361, 362
		expect(mockGetPerekByPerekId).toHaveBeenCalledWith(360);
		expect(mockGetPerekByPerekId).toHaveBeenCalledWith(361);
		expect(mockGetPerekByPerekId).toHaveBeenCalledWith(362);
		expect(mockGetPerekByPerekId).toHaveBeenCalledTimes(3);
	});

	it("throws when context.seferName is missing", async () => {
		const handler = createTanachPageRangesHandler();

		await expect(
			handler([1], [{ pageIndex: 1, semanticName: "א'", title: "" }], {}),
		).rejects.toThrow("Tanach PDF requires context.seferName");
	});

	it("throws when context is undefined", async () => {
		const handler = createTanachPageRangesHandler();

		await expect(
			handler(
				[1],
				[{ pageIndex: 1, semanticName: "א'", title: "" }],
				undefined,
			),
		).rejects.toThrow("Tanach PDF requires context.seferName");
	});

	it("throws when no content pages in semantic info", async () => {
		const mockSefer = { name: "בראשית" };
		mockGetSeferByName.mockReturnValue(
			mockSefer as ReturnType<typeof getSeferByName>,
		);
		mockGetPerekIdsForSefer.mockReturnValue([1, 2, 3]);

		const handler = createTanachPageRangesHandler();

		await expect(
			handler(
				[0, 2, 4],
				[], // no semantic pages
				{ seferName: "בראשית" },
			),
		).rejects.toThrow("No content pages in selected range");
	});

	it("ignores raw pages parameter (uses semanticPages only)", async () => {
		const mockSefer = { name: "בראשית" };
		mockGetSeferByName.mockReturnValue(
			mockSefer as ReturnType<typeof getSeferByName>,
		);
		mockGetPerekIdsForSefer.mockReturnValue([1, 2, 3]);
		mockGetPerekByPerekId.mockReturnValue(
			makePerek("בראשית", "א", "header", ["text"]) as ReturnType<
				typeof getPerekByPerekId
			>,
		);

		const handler = createTanachPageRangesHandler();

		// Pass garbage page indices but correct semanticPages
		const result = await handler(
			[999, 1000],
			[{ pageIndex: 3, semanticName: "ב'", title: "" }],
			{ seferName: "בראשית" },
		);

		expect(result[0]).toBe("pdf");
		// Should resolve to perekId 2 (ב = 2nd perek)
		expect(mockGetPerekByPerekId).toHaveBeenCalledWith(2);
	});
});
