jest.mock("../../../src/lib/articles", () => ({
	getArticleById: jest.fn(),
}));
jest.mock("../../../src/lib/perushim", () => ({
	getPerushNotes: jest.fn(),
}));
jest.mock("../../../src/lib/download/handlers", () => ({
	getSeferDownloadHandler: jest.fn(),
	getPageRangesDownloadHandler: jest.fn(),
}));

import {
	downloadPageRanges,
	downloadSefer,
	getArticleForBook,
	getPerushNotesForPage,
} from "../../../src/app/929/[number]/actions";
import { getArticleById } from "../../../src/lib/articles";
import {
	getPageRangesDownloadHandler,
	getSeferDownloadHandler,
} from "../../../src/lib/download/handlers";
import { getPerushNotes } from "../../../src/lib/perushim";

const mockGetArticleById = getArticleById as jest.MockedFunction<
	typeof getArticleById
>;
const mockGetPerushNotes = getPerushNotes as jest.MockedFunction<
	typeof getPerushNotes
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

describe("downloadSefer", () => {
	beforeEach(() => {
		jest.clearAllMocks();
	});

	it('returns { error: "not_implemented" } when no handler set', async () => {
		mockGetSeferDownloadHandler.mockReturnValue(null);

		const result = await downloadSefer();

		expect(result).toEqual({ error: "not_implemented" });
	});

	it("returns { ext, data } with base64 data when handler returns [ext, Uint8Array]", async () => {
		const bin = new Uint8Array([1, 2, 3]);
		mockGetSeferDownloadHandler.mockReturnValue((async () => [
			"pdf",
			bin,
		]) as ReturnType<typeof getSeferDownloadHandler>);

		const result = await downloadSefer();

		expect(result).toEqual({
			ext: "pdf",
			data: Buffer.from(bin).toString("base64"),
		});
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
});
