import {
	compareChildEdgesChronology,
	shouldApplyJacobChildChronology,
} from "@/lib/tanahpedia/person-family-chronology";
import type { PersonFamilyChildEdge } from "@/lib/tanahpedia/types";

function childEdge(displayName: string): PersonFamilyChildEdge {
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
		coParentEntityId: null,
		coParentDisplayName: null,
		coParentUnionOrder: null,
	};
}

describe("person-family-chronology", () => {
	it("orders Jacob children by narrative birth sequence", () => {
		const focal = "יעקב";
		const edges = [
			childEdge("בנימין"),
			childEdge("ראובן"),
			childEdge("דן"),
			childEdge("יוסף"),
		].sort((a, b) =>
			compareChildEdgesChronology(a, b, focal),
		);
		expect(edges.map((e) => e.related.displayName)).toEqual([
			"ראובן",
			"דן",
			"יוסף",
			"בנימין",
		]);
	});

	it("applies only when focal is יעקב and enough known children", () => {
		expect(
			shouldApplyJacobChildChronology("יעקב", [
				childEdge("ראובן"),
				childEdge("שמעון"),
				childEdge("לוי"),
				childEdge("יהודה"),
			]),
		).toBe(true);
		expect(shouldApplyJacobChildChronology("יעקב", [childEdge("ראובן")])).toBe(
			false,
		);
		expect(
			shouldApplyJacobChildChronology("שמשון", [
				childEdge("ראובן"),
				childEdge("שמעון"),
				childEdge("לוי"),
				childEdge("יהודה"),
			]),
		).toBe(false);
	});

	it("orders full Jacob swimlane timeline (interleaved mothers)", () => {
		const focal = "יעקב";
		const names = [
			"יוסף",
			"ראובן",
			"דן",
			"יהודה",
			"נפתלי",
			"יששכר",
			"גד",
		];
		const edges = names.map((n) => childEdge(n));
		const sorted = [...edges].sort((a, b) =>
			compareChildEdgesChronology(a, b, focal),
		);
		expect(sorted.map((e) => e.related.displayName)).toEqual([
			"ראובן",
			"יהודה",
			"דן",
			"נפתלי",
			"גד",
			"יששכר",
			"יוסף",
		]);
	});
});

describe("person-family-chronology fallback ordering", () => {
	it("falls back to alphabetic order when chronology keys tie", () => {
		const sorted = [childEdge("\u05d1\u05ea"), childEdge("\u05d0\u05d7")].sort(
			(a, b) =>
				compareChildEdgesChronology(a, b, "\u05e9\u05de\u05e9\u05d5\u05df"),
		);

		expect(sorted.map((e) => e.related.displayName)).toEqual([
			"\u05d0\u05d7",
			"\u05d1\u05ea",
		]);
	});

	it("uses zero fallback for unknown Jacob child with empty display name", () => {
		const edge = childEdge("   ");

		expect(
			compareChildEdgesChronology(
				edge,
				childEdge("\u05d6\u05e8"),
				"\u05d9\u05e2\u05e7\u05d1",
			),
		).toBeLessThan(0);
	});
});
