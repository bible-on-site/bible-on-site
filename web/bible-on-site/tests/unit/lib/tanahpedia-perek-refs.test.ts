/**
 * @jest-environment node
 *
 * The perek entity/mention reference loaders sit behind per-perek
 * indefinite caches. The degrade contract: a missing decoration schema
 * (deploy window) yields [], but any operational failure must reject so
 * an empty decoration set is never stored permanently.
 */
jest.mock("next/cache", () => ({
	unstable_cache: (fn: (...args: never[]) => unknown) => fn,
}));

jest.mock("../../../src/lib/tanahpedia/service", () => ({
	getEntityReferencesForPerek: jest.fn(),
	getMentionReferencesForPerek: jest.fn(),
}));

import { fetchAllEntityRefs } from "../../../src/lib/tanahpedia/perek-entity-refs";
import {
	getEntityReferencesForPerek,
	getMentionReferencesForPerek,
} from "../../../src/lib/tanahpedia/service";

const mockEntityRefs = getEntityReferencesForPerek as jest.MockedFunction<
	typeof getEntityReferencesForPerek
>;
const mockMentionRefs = getMentionReferencesForPerek as jest.MockedFunction<
	typeof getMentionReferencesForPerek
>;

describe("fetchAllEntityRefs", () => {
	beforeEach(() => jest.clearAllMocks());

	it("combines curated entity refs and mention decorations per perek", async () => {
		mockEntityRefs.mockResolvedValue([
			{
				entityId: "e1",
				entityName: "משה",
				entityType: "PERSON",
				entryUniqueName: "משה",
				pasukNumber: 1,
				segmentStart: 0,
				segmentEnd: 3,
			},
		]);
		mockMentionRefs.mockResolvedValue([
			{
				entityId: "e2",
				entityName: "אהרן",
				entityType: "PERSON",
				entryUniqueName: "אהרן",
				pasukNumber: 2,
				segmentStart: 0,
				segmentEnd: 4,
			},
		]);

		const out = await fetchAllEntityRefs([12]);

		expect(out[12]).toHaveLength(2);
		expect(out[12][0].entityId).toBe("e1");
		expect(out[12][1].entityId).toBe("e2");
	});

	it("degrades to empty while the decoration schema is missing", async () => {
		mockEntityRefs.mockRejectedValue({ code: "ER_NO_SUCH_TABLE" });
		mockMentionRefs.mockResolvedValue([]);

		await expect(fetchAllEntityRefs([12])).resolves.toEqual({});
	});

	it("degrades on a missing column too", async () => {
		mockEntityRefs.mockResolvedValue([]);
		mockMentionRefs.mockRejectedValue({ errno: 1054 });

		await expect(fetchAllEntityRefs([12])).resolves.toEqual({});
	});

	it("rethrows operational failures so nothing stale is cached", async () => {
		mockEntityRefs.mockRejectedValue(new Error("conn reset"));
		mockMentionRefs.mockResolvedValue([]);

		await expect(fetchAllEntityRefs([12])).rejects.toThrow("conn reset");
	});
});
