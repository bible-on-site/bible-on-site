import type { PerekEntityReference } from "../../../src/lib/tanahpedia/service";
import {
	buildEntityRefLookup,
	getSegmentRuns,
} from "../../../src/lib/tanahpedia/entity-ref-lookup";

function ref(
	over: Partial<PerekEntityReference> & Pick<PerekEntityReference, "pasukNumber">,
): PerekEntityReference {
	return {
		entityId: "e1",
		entityName: "X",
		entityType: "PERSON",
		entryUniqueName: "x",
		segmentStart: null,
		segmentEnd: null,
		...over,
	};
}

describe("entity-ref-lookup", () => {
	describe("buildEntityRefLookup", () => {
		it("groups refs by pasuk and skips null entryUniqueName", () => {
			const lookup = buildEntityRefLookup([
				ref({ pasukNumber: 1, entryUniqueName: "א" }),
				ref({
					pasukNumber: 1,
					entryUniqueName: null,
					entityId: "e2",
				}),
				ref({ pasukNumber: 2, entryUniqueName: "ב", entityId: "e3" }),
			]);
			expect(lookup.get(1)?.length).toBe(1);
			expect(lookup.get(2)?.length).toBe(1);
		});

		it("appends multiple refs on same pasuk", () => {
			const lookup = buildEntityRefLookup([
				ref({ pasukNumber: 3, entityId: "a" }),
				ref({ pasukNumber: 3, entityId: "b" }),
			]);
			expect(lookup.get(3)).toHaveLength(2);
		});
	});

	describe("getSegmentRuns", () => {
		it("returns single plain run when no refs for pasuk", () => {
			const lookup = new Map<number, PerekEntityReference[]>();
			expect(getSegmentRuns(lookup, 1, 5)).toEqual([
				{ startIdx: 0, endIdx: 4, ref: null },
			]);
		});

		it("uses whole-pasuk ref when segment bounds null", () => {
			const r = ref({ pasukNumber: 1, segmentStart: null, segmentEnd: null });
			const lookup = buildEntityRefLookup([r]);
			expect(getSegmentRuns(lookup, 1, 3)).toEqual([
				{ startIdx: 0, endIdx: 2, ref: r },
			]);
		});

		it("splits runs when segment ranges differ", () => {
			const a = ref({
				pasukNumber: 1,
				segmentStart: 0,
				segmentEnd: 1,
				entityId: "a",
			});
			const b = ref({
				pasukNumber: 1,
				segmentStart: 2,
				segmentEnd: 3,
				entityId: "b",
			});
			const lookup = buildEntityRefLookup([a, b]);
			const runs = getSegmentRuns(lookup, 1, 4);
			expect(runs).toHaveLength(2);
			expect(runs[0]).toMatchObject({ startIdx: 0, endIdx: 1, ref: a });
			expect(runs[1]).toMatchObject({ startIdx: 2, endIdx: 3, ref: b });
		});

		it("merges adjacent segments with same ref identity", () => {
			const r = ref({
				pasukNumber: 1,
				segmentStart: 0,
				segmentEnd: 2,
				entityId: "same",
			});
			const lookup = buildEntityRefLookup([r]);
			const runs = getSegmentRuns(lookup, 1, 3);
			expect(runs).toEqual([{ startIdx: 0, endIdx: 2, ref: r }]);
		});

		it("prefers segment-scoped ref over whole-pasuk when both match", () => {
			const whole = ref({
				pasukNumber: 1,
				segmentStart: null,
				segmentEnd: null,
				entityId: "w",
			});
			const narrow = ref({
				pasukNumber: 1,
				segmentStart: 1,
				segmentEnd: 1,
				entityId: "n",
			});
			const lookup = buildEntityRefLookup([whole, narrow]);
			const runs = getSegmentRuns(lookup, 1, 3);
			expect(runs[0].ref).toBe(whole);
			expect(runs[1].ref).toBe(narrow);
			expect(runs[2].ref).toBe(whole);
		});
	});
});
