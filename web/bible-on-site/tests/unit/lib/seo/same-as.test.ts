jest.mock("../../../../src/lib/api-client", () => ({
	query: jest.fn(),
}));

import { query } from "../../../../src/lib/api-client";
import { sameAsFor } from "../../../../src/lib/seo/same-as";

const mockQuery = query as jest.MockedFunction<typeof query>;

describe("sameAsFor", () => {
	beforeEach(() => mockQuery.mockReset());

	it("returns the subject urls queried by kind and text id", async () => {
		mockQuery.mockResolvedValueOnce([
			{ url: "https://www.wikidata.org/wiki/Q26456" },
			{ url: "https://en.wikipedia.org/wiki/Rashi" },
		]);

		await expect(sameAsFor("PARSHAN", 55)).resolves.toEqual([
			"https://www.wikidata.org/wiki/Q26456",
			"https://en.wikipedia.org/wiki/Rashi",
		]);
		expect(mockQuery).toHaveBeenCalledWith(
			expect.stringContaining("FROM external_reference"),
			["PARSHAN", "55"],
		);
	});

	describe("when the table is not deployed yet", () => {
		it("returns no references", async () => {
			mockQuery.mockRejectedValueOnce({ code: "ER_NO_SUCH_TABLE" });

			await expect(sameAsFor("TANAH_AUTHOR", 3)).resolves.toEqual([]);
		});
	});

	describe("with any other database error", () => {
		it("rethrows the error", async () => {
			const error = new Error("connection lost");
			mockQuery.mockRejectedValueOnce(error);

			await expect(
				sameAsFor("TANAHPEDIA_ENTITY", "e2000000-0000-4000-8000-000000000001"),
			).rejects.toBe(error);
		});
	});
});
