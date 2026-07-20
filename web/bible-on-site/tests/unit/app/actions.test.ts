jest.mock("../../../src/lib/articles", () => ({
	getArticleById: jest.fn(),
	getArticleSummariesByPerekId: jest.fn(),
}));
jest.mock("../../../src/lib/perushim", () => ({
	getPerushNotes: jest.fn(),
	getPerushimByPerekId: jest.fn(),
}));
jest.mock("../../../src/lib/download/handlers", () => ({
	getSeferDownloadHandler: jest.fn(),
	getPageRangesDownloadHandler: jest.fn(),
}));

import {
	downloadPageRanges,
	downloadSefer,
	getArticleForBook,
	getArticleSummariesForPerek,
	getPerekSummariesBatch,
	getPerushNotesForPage,
	getPerushimSummariesForPerek,
} from "../../../src/app/929/[number]/actions";
import { getArticleById, getArticleSummariesByPerekId } from "../../../src/lib/articles";
import {
	getPageRangesDownloadHandler,
	getSeferDownloadHandler,
} from "../../../src/lib/download/handlers";
import { getPerushNotes, getPerushimByPerekId } from "../../../src/lib/perushim";

const mockGetArticleById = getArticleById as jest.MockedFunction<
	typeof getArticleById
>;
const mockGetPerushNotes = getPerushNotes as jest.MockedFunction<
	typeof getPerushNotes
>;
const mockGetPerushimByPerekId = getPerushimByPerekId as jest.MockedFunction<
	typeof getPerushimByPerekId
>;
const mockGetArticleSummariesByPerekId = getArticleSummariesByPerekId as jest.MockedFunction<
	typeof getArticleSummariesByPerekId
>;
const mockGetSeferDownloadHandler =
	getSeferDownloadHandler as jest.MockedFunction<
		typeof getSeferDownloadHandler
	>;
const mockGetPageRangesDownloadHandler =
	getPageRangesDownloadHandler as jest.MockedFunction<
		typeof getPageRangesDownloadHandler
	>;

describe("getArticleForBook", () => {
	beforeEach(() => {
		jest.clearAllMocks();
	});

	it("returns article when found", async () => {
		const article = {
			id: 1,
			perekId: 1,
			authorId: 1,
			name: "מאמר",
			abstract: null,
			content: "<p>תוכן</p>",
			priority: 1,
			authorName: "הרב",
			authorImageUrl: "https://example.com/1.jpg",
		};
		mockGetArticleById.mockResolvedValue(article);

		const result = await getArticleForBook(1);

		expect(result).toEqual(article);
		expect(mockGetArticleById).toHaveBeenCalledWith(1);
	});

	it("returns null when article not found", async () => {
		mockGetArticleById.mockResolvedValue(null);

		const result = await getArticleForBook(999);

		expect(result).toBeNull();
	});
});

describe("getPerushNotesForPage", () => {
	beforeEach(() => {
		jest.clearAllMocks();
	});

	it("returns notes from getPerushNotes for given perush and perek", async () => {
		const notes = [{ pasuk: 1, noteIdx: 0, noteContent: "<p>פירוש</p>" }];
		mockGetPerushNotes.mockResolvedValue(notes);

		const result = await getPerushNotesForPage(14, 1);

		expect(mockGetPerushNotes).toHaveBeenCalledWith(14, 1);
		expect(result).toEqual(notes);
	});

	it("returns empty array when getPerushNotes returns empty", async () => {
		mockGetPerushNotes.mockResolvedValue([]);

		const result = await getPerushNotesForPage(1, 999);

		expect(result).toEqual([]);
	});
});

describe("getArticleSummariesForPerek", () => {
	beforeEach(() => {
		jest.clearAllMocks();
	});

	it("delegates to getArticleSummariesByPerekId", async () => {
		const summaries = [
			{ id: 1, perekId: 5, authorId: 1, abstract: "abs", name: "art", priority: 1, authorName: "rav", authorImageUrl: "url" },
		];
		mockGetArticleSummariesByPerekId.mockResolvedValue(summaries);

		const result = await getArticleSummariesForPerek(5);

		expect(mockGetArticleSummariesByPerekId).toHaveBeenCalledWith(5);
		expect(result).toEqual(summaries);
	});
});

describe("getPerushimSummariesForPerek", () => {
	beforeEach(() => {
		jest.clearAllMocks();
	});

	it("delegates to getPerushimByPerekId", async () => {
		const perushim = [
			{ id: 1, name: "רש\"י", parshanName: "רש\"י", noteCount: 10 },
		];
		mockGetPerushimByPerekId.mockResolvedValue(perushim);

		const result = await getPerushimSummariesForPerek(5);

		expect(mockGetPerushimByPerekId).toHaveBeenCalledWith(5);
		expect(result).toEqual(perushim);
	});
});

describe("getPerekSummariesBatch", () => {
	beforeEach(() => {
		jest.clearAllMocks();
	});

	it("returns article and perush summaries keyed by perek id", async () => {
		const articleSummaries = new Map([
			[
				5,
				[
					{
						id: 1,
						perekId: 5,
						authorId: 1,
						abstract: "abs 5",
						name: "article 5",
						priority: 1,
						authorName: "rav 5",
						authorImageUrl: "url-5",
					},
				],
			],
			[
				6,
				[
					{
						id: 2,
						perekId: 6,
						authorId: 2,
						abstract: "abs 6",
						name: "article 6",
						priority: 2,
						authorName: "rav 6",
						authorImageUrl: "url-6",
					},
				],
			],
		]);
		const perushSummaries = new Map([
			[5, [{ id: 10, name: "Rashi 5", parshanName: "Rashi", noteCount: 3 }]],
			[6, [{ id: 11, name: "Rashi 6", parshanName: "Rashi", noteCount: 4 }]],
		]);
		mockGetArticleSummariesByPerekId.mockImplementation(async (id) =>
			articleSummaries.get(id) ?? [],
		);
		mockGetPerushimByPerekId.mockImplementation(async (id) =>
			perushSummaries.get(id) ?? [],
		);

		const result = await getPerekSummariesBatch([5, 6]);

		expect(result).toEqual({
			"5": {
				articles: articleSummaries.get(5),
				perushim: perushSummaries.get(5),
			},
			"6": {
				articles: articleSummaries.get(6),
				perushim: perushSummaries.get(6),
			},
		});
		expect(mockGetArticleSummariesByPerekId).toHaveBeenCalledTimes(2);
		expect(mockGetPerushimByPerekId).toHaveBeenCalledTimes(2);
	});
});

describe("downloadSefer", () => {
	beforeEach(() => {
		jest.clearAllMocks();
	});

	it('returns { error: "not_implemented" } when no handler set', async () => {
		mockGetSeferDownloadHandler.mockReturnValue(null);

		const result = await downloadSefer({
			seferName: "בראשית",
			perekIds: [1],
		});

		expect(result).toEqual({ error: "not_implemented" });
	});

	it("returns { ext, data } with base64 data when handler returns [ext, Uint8Array]", async () => {
		const bin = new Uint8Array([1, 2, 3]);
		const ctx = { seferName: "בראשית", perekIds: [1, 2] };
		const handler = jest.fn(async () => ["pdf", bin] as const);
		mockGetSeferDownloadHandler.mockReturnValue(
			handler as ReturnType<typeof getSeferDownloadHandler>,
		);

		const result = await downloadSefer(ctx);

		expect(handler).toHaveBeenCalledWith(ctx);
		expect(result).toEqual({
			ext: "pdf",
			data: Buffer.from(bin).toString("base64"),
		});
	});

	it('returns { error: "service_unavailable" } when handler throws', async () => {
		const consoleSpy = jest
			.spyOn(console, "error")
			.mockImplementation(() => {});
		mockGetSeferDownloadHandler.mockReturnValue((() => {
			throw new Error("binary not found");
		}) as unknown as ReturnType<typeof getSeferDownloadHandler>);

		const result = await downloadSefer({
			seferName: "בראשית",
			perekIds: [1],
		});

		expect(result).toEqual({ error: "service_unavailable" });
		expect(consoleSpy).toHaveBeenCalledWith(
			"Sefer download failed:",
			expect.any(Error),
		);
		consoleSpy.mockRestore();
	});
});

describe("downloadPageRanges", () => {
	beforeEach(() => {
		jest.clearAllMocks();
	});

	it('returns { error: "not_implemented" } when no handler set', async () => {
		mockGetPageRangesDownloadHandler.mockReturnValue(null);

		const result = await downloadPageRanges(
			[1, 2],
			[{ pageIndex: 1, semanticName: "1", title: "test" }],
		);

		expect(result).toEqual({ error: "not_implemented" });
	});

	it("returns { ext, data } with base64 data when handler returns [ext, Uint8Array]", async () => {
		const bin = new Uint8Array([1, 2, 3]);
		mockGetPageRangesDownloadHandler.mockReturnValue((async () => [
			"pdf",
			bin,
		]) as ReturnType<typeof getPageRangesDownloadHandler>);

		const result = await downloadPageRanges(
			[1, 3],
			[{ pageIndex: 1, semanticName: "א", title: "פרק א" }],
			{ seferName: "בראשית" },
		);

		expect(result).toEqual({
			ext: "pdf",
			data: Buffer.from(bin).toString("base64"),
		});
	});

	it('returns { error: "service_unavailable" } when handler throws', async () => {
		const consoleSpy = jest
			.spyOn(console, "error")
			.mockImplementation(() => {});
		mockGetPageRangesDownloadHandler.mockReturnValue((() => {
			throw new Error("binary crashed");
		}) as unknown as ReturnType<typeof getPageRangesDownloadHandler>);

		const result = await downloadPageRanges(
			[1],
			[{ pageIndex: 0, semanticName: "א", title: "פרק א" }],
			{ seferName: "בראשית" },
		);

		expect(result).toEqual({ error: "service_unavailable" });
		expect(consoleSpy).toHaveBeenCalledWith(
			"Page-ranges download failed:",
			expect.any(Error),
		);
		consoleSpy.mockRestore();
	});
});
