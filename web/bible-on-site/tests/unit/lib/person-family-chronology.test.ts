import {
	compareChildEdgesChronology,
	shouldApplyChildBirthChronology,
} from "@/lib/tanahpedia/person-family-chronology";
import type { PersonFamilyChildEdge } from "@/lib/tanahpedia/types";

function childEdge(
	displayName: string,
	birthOrder: number | null,
): PersonFamilyChildEdge {
	return {
		related: {
			personId: `p-${displayName}`,
			entityId: `e-${displayName}`,
			displayName,
			entryUniqueName: null,
			entryTitle: displayName,
			sex: null,
		},
		parentRole: "FATHER",
		relationshipType: "BIOLOGICAL",
		altGroupId: null,
		sourceCitation: null,
		birthOrder,
		coParentEntityId: null,
		coParentDisplayName: null,
		coParentUnionOrder: null,
	};
}

describe("person-family chronology from relationship data", () => {
	it("orders Adam's children by stored birth order", () => {
		const edges = [
			childEdge("שת", 3),
			childEdge("הבל", 2),
			childEdge("קין", 1),
		].sort(compareChildEdgesChronology);
		expect(edges.map((edge) => edge.related.displayName)).toEqual([
			"קין",
			"הבל",
			"שת",
		]);
	});

	it("does not infer order from names and places unknown children last", () => {
		const edges = [
			childEdge("אב", null),
			childEdge("ג", 2),
			childEdge("ד", 1),
			childEdge("בת", null),
		].sort(compareChildEdgesChronology);
		expect(edges.map((edge) => edge.related.displayName)).toEqual([
			"ד",
			"ג",
			"אב",
			"בת",
		]);
	});

	it("uses the timeline only when relationship data supplies an order", () => {
		expect(
			shouldApplyChildBirthChronology([
				childEdge("קין", null),
				childEdge("הבל", null),
			]),
		).toBe(false);
		expect(
			shouldApplyChildBirthChronology([
				childEdge("קין", 1),
				childEdge("הבל", null),
			]),
		).toBe(true);
	});
});
