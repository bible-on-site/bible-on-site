jest.mock("../../../src/lib/articles", () => ({
	getArticleById: jest.fn(),
}));

import { getArticleById } from "../../../src/lib/articles";
import { getArticleForBook } from "../../../src/app/929/[number]/actions";

const mockGetArticleById = getArticleById as jest.MockedFunction<
	typeof getArticleById
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
