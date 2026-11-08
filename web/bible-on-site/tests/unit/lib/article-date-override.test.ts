/**
 * Unit tests for the recurring Hebrew-date article override lookup (#3098).
 */

jest.mock("../../../src/lib/api-client", () => ({
	query: jest.fn(),
}));

import { query } from "../../../src/lib/api-client";
import { getArticleHebrewDateOverride } from "../../../src/lib/articles/service";

const mockQuery = query as jest.MockedFunction<typeof query>;

const assignedRow = {
	id: 2199,
	perek_id: 535,
	author_id: 7,
	abstract: "<p>תקציר</p>",
	name: "לימוד לתשעה באב",
	priority: 1,
	author_name: "הרב לדוגמא",
};

describe("getArticleHebrewDateOverride", () => {
	beforeEach(() => {
		jest.clearAllMocks();
		jest.spyOn(console, "warn").mockImplementation(() => {});
	});
	afterEach(() => {
		(console.warn as jest.Mock).mockRestore();
	});

	it("returns the single assigned article for a matching month/day", async () => {
		mockQuery.mockResolvedValueOnce([assignedRow]).mockResolvedValueOnce([]);

		const result = await getArticleHebrewDateOverride(11, 9);

		expect(mockQuery).toHaveBeenNthCalledWith(
			1,
			expect.stringContaining("tanah_article_hebrew_date"),
			[11, 9],
		);
		expect(result).toMatchObject({
			id: 2199,
			perekId: 535,
			name: "לימוד לתשעה באב",
			authorName: "הרב לדוגמא",
		});
	});

	it("returns null for a date with no assignment", async () => {
		mockQuery.mockResolvedValueOnce([]);

		const result = await getArticleHebrewDateOverride(11, 10);

		expect(result).toBeNull();
		expect(mockQuery).toHaveBeenCalledTimes(1);
	});

	it("rejects while the Hebrew-date schema is not deployed so nothing caches the miss", async () => {
		// The caller wraps this lookup in an unbounded cache: a resolved null
		// would keep hiding overrides after the migration lands, so the
		// rollout state must reject — thrown loader errors are never cached.
		const missing = Object.assign(new Error("no such table"), {
			code: "ER_NO_SUCH_TABLE",
		});
		mockQuery.mockRejectedValueOnce(missing);

		await expect(getArticleHebrewDateOverride(8, 5)).rejects.toThrow(
			"no such table",
		);
		expect(console.warn).toHaveBeenCalled();
	});

	it("rethrows real database failures so a bad read cannot silently hide an override", async () => {
		mockQuery.mockRejectedValueOnce(new Error("connection lost"));

		await expect(getArticleHebrewDateOverride(11, 9)).rejects.toThrow(
			"connection lost",
		);
	});
});
