jest.mock("../../../src/lib/articles", () => ({
	getArticleById: jest.fn(),
}));
jest.mock("../../../src/lib/perushim", () => ({
	getPerushNotes: jest.fn(),
}));

import {
	getArticleForBook,
	getPerushNotesForPage,
} from "../../../src/app/929/[number]/actions";
import { getArticleById } from "../../../src/lib/articles";
import { getPerushNotes } from "../../../src/lib/perushim";

const mockGetArticleById = getArticleById as jest.MockedFunction<
	typeof getArticleById
>;
const mockGetPerushNotes = getPerushNotes as jest.MockedFunction<
	typeof getPerushNotes
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
