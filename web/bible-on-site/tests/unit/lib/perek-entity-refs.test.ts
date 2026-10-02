import { fetchAllEntityRefs } from "@/lib/tanahpedia/perek-entity-refs";
import {
	getEntityReferencesForPerek,
	type PerekEntityReference,
} from "@/lib/tanahpedia/service";

jest.mock("next/cache", () => ({
	unstable_cache: (loader: (...args: never[]) => unknown) => loader,
}));

jest.mock("@/lib/tanahpedia/service", () => ({
	getEntityReferencesForPerek: jest.fn(),
}));

const loadRefs = jest.mocked(getEntityReferencesForPerek);

beforeEach(() => loadRefs.mockReset());

test("an empty book view needs no entity-reference queries", async () => {
	expect(await fetchAllEntityRefs([])).toEqual({});
	expect(loadRefs).not.toHaveBeenCalled();
});

test("groups references under the requested chapters and omits empty chapters", async () => {
	const reference: PerekEntityReference = {
		entityId: "test-person",
		entityName: "Test person",
		entityType: "person",
		entryUniqueName: "test_person",
		pasukNumber: 2,
		segmentStart: 0,
		segmentEnd: 1,
	};
	loadRefs.mockImplementation(async (id) => (id === 3 ? [reference] : []));
	expect(await fetchAllEntityRefs([3, 1, 2])).toEqual({ 3: [reference] });
	expect(loadRefs).toHaveBeenCalledTimes(3);
	expect(loadRefs).toHaveBeenCalledWith(1);
	expect(loadRefs).toHaveBeenCalledWith(2);
	expect(loadRefs).toHaveBeenCalledWith(3);
});
