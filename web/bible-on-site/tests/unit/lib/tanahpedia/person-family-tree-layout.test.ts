import {
	buildPartnerChildColumns,
	buildSpouseUnits,
	canUseSpouseChildMatrix,
	childEdgeCoParentOutsideSpouses,
	citationLines,
	FAMILY_TREE_VERTICAL_MAX_WIDTH_PX,
	fuseMarriageAndForbiddenSpouseRows,
	groupByAltGroupId,
	parentSourceCitation,
	partitionChildrenByCoParent,
	sexMarkDataAttribute,
	shouldCollapseSpouseMatrix,
	shouldShowCoParentSubtitles,
	sortEdgesForOpinions,
	SPOUSE_MATRIX_COLLAPSE_HYSTERESIS_PX,
	spouseTimelinePlain,
	spouseTimelineSuffix,
	type SpouseUnit,
} from "../../../../src/lib/tanahpedia/person-family-tree-layout";
import type {
	PersonFamilyChildEdge,
	PersonFamilyParentEdge,
	PersonFamilySpouseEdge,
} from "../../../../src/lib/tanahpedia/types";

function related(id: string, name: string, sex: string | null = null) {
	return {
		personId: `pid-${id}`,
		entityId: id,
		displayName: name,
		entryUniqueName: `entry-${id}`,
		entryTitle: name,
		sex,
	};
}

function childEdge({
	id,
	name,
	coParentEntityId = null,
	coParentDisplayName = null,
	coParentUnionOrder = null,
	birthOrder = null,
	altGroupId = null,
	parentRole = "FATHER",
	relationshipType = "BIOLOGICAL",
}: {
	id: string;
	name: string;
	coParentEntityId?: string | null;
	coParentDisplayName?: string | null;
	coParentUnionOrder?: number | null;
	birthOrder?: number | null;
	altGroupId?: string | null;
	parentRole?: string;
	relationshipType?: string;
}): PersonFamilyChildEdge {
	return {
		related: related(id, name),
		parentRole,
		relationshipType,
		altGroupId,
		sourceCitation: null,
		birthOrder,
		coParentEntityId,
		coParentDisplayName,
		coParentUnionOrder,
	};
}

function spouseEdge({
	id,
	name,
	unionType = "MARRIAGE",
	unionOrder = 1,
	altGroupId = null,
	unionEndReason = null,
	unionStartDate = null,
	unionEndDate = null,
	sourceCitation = null,
	personSourceCitation = null,
}: {
	id: string;
	name: string;
	unionType?: string;
	unionOrder?: number | null;
	altGroupId?: string | null;
	unionEndReason?: string | null;
	unionStartDate?: number | string | null;
	unionEndDate?: number | string | null;
	sourceCitation?: string | null;
	personSourceCitation?: string | null;
}): PersonFamilySpouseEdge {
	return {
		related: related(id, name),
		unionType,
		unionOrder,
		altGroupId,
		sourceCitation,
		personSourceCitation,
		unionEndReason,
		unionStartDate,
		unionEndDate,
	};
}

function parentEdge({
	id,
	name,
	parentRole = "FATHER",
	relationshipType = "BIOLOGICAL",
	altGroupId = null,
	sourceCitation = null,
}: {
	id: string;
	name: string;
	parentRole?: string;
	relationshipType?: string;
	altGroupId?: string | null;
	sourceCitation?: string | null;
}): PersonFamilyParentEdge {
	return {
		related: related(id, name),
		parentRole,
		relationshipType,
		altGroupId,
		sourceCitation,
	};
}

describe("partitionChildrenByCoParent", () => {
	it("groups children by coParentEntityId and sorts buckets by union order", () => {
		const buckets = partitionChildrenByCoParent([
			childEdge({ id: "c1", name: "אלף", coParentEntityId: "w2", coParentDisplayName: "רחל", coParentUnionOrder: 2 }),
			childEdge({ id: "c2", name: "בית", coParentEntityId: "w1", coParentDisplayName: "לאה", coParentUnionOrder: 1 }),
			childEdge({ id: "c3", name: "גימל", coParentEntityId: "w1", coParentDisplayName: "לאה", coParentUnionOrder: 1 }),
		]);
		expect(buckets.map((b) => b.key)).toEqual(["w1", "w2"]);
		expect(buckets[0].edges.map((e) => e.related.entityId)).toEqual(["c2", "c3"]);
		expect(buckets[0].coParentDisplayName).toBe("לאה");
		expect(buckets[0].coParentUnionOrder).toBe(1);
	});

	it("places the no-co-parent bucket last", () => {
		const buckets = partitionChildrenByCoParent([
			childEdge({ id: "c0", name: "אלף" }),
			childEdge({ id: "c1", name: "בית", coParentEntityId: "w1", coParentDisplayName: "לאה", coParentUnionOrder: 1 }),
		]);
		expect(buckets.map((b) => b.key)).toEqual(["w1", "__none__"]);
		expect(buckets[1].coParentEntityId).toBeNull();
	});

	it("sorts each bucket by display name in Hebrew and honors a custom comparator", () => {
		const edges = [
			childEdge({ id: "c1", name: "זבולון", coParentEntityId: "w1" }),
			childEdge({ id: "c2", name: "בנימין", coParentEntityId: "w1" }),
			childEdge({ id: "c3", name: "גד", coParentEntityId: "w1" }),
		];
		const byName = partitionChildrenByCoParent(edges);
		expect(byName[0].edges.map((e) => e.related.displayName)).toEqual([
			"בנימין",
			"גד",
			"זבולון",
		]);
		const reversed = partitionChildrenByCoParent(
			edges,
			(a, b) => b.related.displayName.localeCompare(a.related.displayName, "he"),
		);
		expect(reversed[0].edges.map((e) => e.related.displayName)).toEqual([
			"זבולון",
			"גד",
			"בנימין",
		]);
	});

	it("returns an empty list for no edges", () => {
		expect(partitionChildrenByCoParent([])).toEqual([]);
	});
});

describe("shouldShowCoParentSubtitles", () => {
	const wifeUnit: SpouseUnit = {
		altGroupKey: null,
		edges: [spouseEdge({ id: "w1", name: "לאה" })],
	};

	it("shows subtitles when there is more than one co-parent bucket", () => {
		const buckets = partitionChildrenByCoParent([
			childEdge({ id: "c1", name: "א", coParentEntityId: "w1" }),
			childEdge({ id: "c2", name: "ב", coParentEntityId: "w2" }),
		]);
		expect(shouldShowCoParentSubtitles(buckets, [wifeUnit])).toBe(true);
	});

	it("hides subtitles for a single bucket matching the only spouse", () => {
		const buckets = partitionChildrenByCoParent([
			childEdge({ id: "c1", name: "א", coParentEntityId: "w1" }),
		]);
		expect(shouldShowCoParentSubtitles(buckets, [wifeUnit])).toBe(false);
	});

	it("shows subtitles for a single bucket that does not match the only spouse", () => {
		const buckets = partitionChildrenByCoParent([
			childEdge({ id: "c1", name: "א", coParentEntityId: "other" }),
		]);
		expect(shouldShowCoParentSubtitles(buckets, [wifeUnit])).toBe(true);
	});

	it("hides subtitles when the bucket has no co-parent", () => {
		const buckets = partitionChildrenByCoParent([
			childEdge({ id: "c1", name: "א" }),
		]);
		expect(shouldShowCoParentSubtitles(buckets, [wifeUnit])).toBe(false);
	});
});

describe("canUseSpouseChildMatrix", () => {
	it("allows units with one entity each even under an alt group", () => {
		const units: SpouseUnit[] = [
			{ altGroupKey: "g1", edges: [spouseEdge({ id: "w1", name: "א" })] },
			{ altGroupKey: "g1", edges: [spouseEdge({ id: "w2", name: "ב" })] },
		];
		expect(canUseSpouseChildMatrix(units)).toBe(true);
	});

	it("blocks a unit whose alt group holds several different entities", () => {
		const units: SpouseUnit[] = [
			{
				altGroupKey: "g1",
				edges: [spouseEdge({ id: "w1", name: "א" }), spouseEdge({ id: "w2", name: "ב" })],
			},
		];
		expect(canUseSpouseChildMatrix(units)).toBe(false);
	});
});

describe("buildPartnerChildColumns", () => {
	const units: SpouseUnit[] = [
		{ altGroupKey: null, edges: [spouseEdge({ id: "w1", name: "לאה" })] },
		{ altGroupKey: null, edges: [spouseEdge({ id: "w2", name: "רחל", unionOrder: 2 })] },
	];

	it("assigns each child to its co-parent column and collects loose children", () => {
		const { columnChildren, looseChildren } = buildPartnerChildColumns(
			[
				childEdge({ id: "c1", name: "ראובן", coParentEntityId: "w1" }),
				childEdge({ id: "c2", name: "יוסף", coParentEntityId: "w2" }),
				childEdge({ id: "c3", name: "דן", coParentEntityId: "w9" }),
				childEdge({ id: "c4", name: "גד" }),
			],
			units,
		);
		expect(columnChildren.get("w1")?.map((e) => e.related.entityId)).toEqual(["c1"]);
		expect(columnChildren.get("w2")?.map((e) => e.related.entityId)).toEqual(["c2"]);
		expect(looseChildren.map((e) => e.related.entityId)).toEqual(["c4", "c3"]);
	});

	it("returns an empty column for a spouse with no children", () => {
		const { columnChildren } = buildPartnerChildColumns([], units);
		expect(columnChildren.get("w1")).toEqual([]);
		expect(columnChildren.get("w2")).toEqual([]);
	});

	it("orders column children by birth order when chronology applies", () => {
		const { columnChildren } = buildPartnerChildColumns(
			[
				childEdge({ id: "c2", name: "שמעון", coParentEntityId: "w1", birthOrder: 2 }),
				childEdge({ id: "c1", name: "ראובן", coParentEntityId: "w1", birthOrder: 1 }),
			],
			units,
		);
		expect(columnChildren.get("w1")?.map((e) => e.related.entityId)).toEqual(["c1", "c2"]);
	});
});

describe("childEdgeCoParentOutsideSpouses", () => {
	it("treats a child without a co-parent as outside", () => {
		expect(
			childEdgeCoParentOutsideSpouses(childEdge({ id: "c1", name: "א" }), new Set(["w1"])),
		).toBe(true);
	});

	it("treats a child whose co-parent is a spouse as inside", () => {
		expect(
			childEdgeCoParentOutsideSpouses(
				childEdge({ id: "c1", name: "א", coParentEntityId: "w1" }),
				new Set(["w1"]),
			),
		).toBe(false);
	});

	it("treats a child whose co-parent is not a spouse as outside", () => {
		expect(
			childEdgeCoParentOutsideSpouses(
				childEdge({ id: "c1", name: "א", coParentEntityId: "w9" }),
				new Set(["w1"]),
			),
		).toBe(true);
	});
});

describe("groupByAltGroupId", () => {
	it("groups rows under their altGroupId including the null key", () => {
		const grouped = groupByAltGroupId([
			{ altGroupId: null, v: 1 },
			{ altGroupId: "g1", v: 2 },
			{ altGroupId: "g1", v: 3 },
		]);
		expect(grouped.get(null)?.map((r) => r.v)).toEqual([1]);
		expect(grouped.get("g1")?.map((r) => r.v)).toEqual([2, 3]);
	});
});

describe("buildSpouseUnits", () => {
	it("builds one unit per edge without alt group, sorted by union order", () => {
		const units = buildSpouseUnits([
			spouseEdge({ id: "w2", name: "רחל", unionOrder: 2 }),
			spouseEdge({ id: "w1", name: "לאה", unionOrder: 1 }),
		]);
		expect(units.map((u) => u.edges[0].related.entityId)).toEqual(["w1", "w2"]);
		expect(units.every((u) => u.altGroupKey === null && u.edges.length === 1)).toBe(true);
	});

	it("clusters alt-group rows by partner entity", () => {
		const units = buildSpouseUnits([
			spouseEdge({ id: "w1", name: "לאה א", unionType: "MARRIAGE", altGroupId: "g1" }),
			spouseEdge({ id: "w1", name: "לאה א", unionType: "BETROTHAL", unionOrder: 2, altGroupId: "g1" }),
			spouseEdge({ id: "w2", name: "רחל", unionOrder: 3, altGroupId: "g1" }),
		]);
		expect(units).toHaveLength(2);
		const w1Unit = units.find((u) => u.edges[0].related.entityId === "w1");
		expect(w1Unit?.altGroupKey).toBe("g1");
		expect(w1Unit?.edges.map((e) => e.unionType).sort()).toEqual(["BETROTHAL", "MARRIAGE"]);
	});

	it("fuses a marriage row and a forbidden row for the same partner and order", () => {
		const units = buildSpouseUnits([
			spouseEdge({ id: "w1", name: "דינה", unionType: "MARRIAGE", unionOrder: 1 }),
			spouseEdge({ id: "w1", name: "דינה", unionType: "FORBIDDEN_WITH_GENTILE", unionOrder: 1 }),
		]);
		expect(units).toHaveLength(1);
		expect(units[0].edges.map((e) => e.unionType)).toEqual([
			"MARRIAGE",
			"FORBIDDEN_WITH_GENTILE",
		]);
	});
});

describe("fuseMarriageAndForbiddenSpouseRows", () => {
	it("fuses matching singles into one unit", () => {
		const units = fuseMarriageAndForbiddenSpouseRows([
			{ altGroupKey: null, edges: [spouseEdge({ id: "w1", name: "א", unionType: "MARRIAGE" })] },
			{ altGroupKey: null, edges: [spouseEdge({ id: "w1", name: "א", unionType: "FORBIDDEN_WITH_GENTILE" })] },
		]);
		expect(units).toHaveLength(1);
		expect(units[0].edges).toHaveLength(2);
	});

	it("keeps singles apart when union order differs", () => {
		const units = fuseMarriageAndForbiddenSpouseRows([
			{ altGroupKey: null, edges: [spouseEdge({ id: "w1", name: "א", unionType: "MARRIAGE", unionOrder: 1 })] },
			{ altGroupKey: null, edges: [spouseEdge({ id: "w1", name: "א", unionType: "FORBIDDEN_WITH_GENTILE", unionOrder: 2 })] },
		]);
		expect(units).toHaveLength(2);
	});

	it("keeps singles apart for different partners", () => {
		const units = fuseMarriageAndForbiddenSpouseRows([
			{ altGroupKey: null, edges: [spouseEdge({ id: "w1", name: "א", unionType: "MARRIAGE" })] },
			{ altGroupKey: null, edges: [spouseEdge({ id: "w2", name: "ב", unionType: "FORBIDDEN_WITH_GENTILE" })] },
		]);
		expect(units).toHaveLength(2);
	});

	it("keeps multi-edge units untouched and re-sorts by union order", () => {
		const multi: SpouseUnit = {
			altGroupKey: "g1",
			edges: [
				spouseEdge({ id: "w1", name: "א", unionType: "MARRIAGE", unionOrder: 3 }),
				spouseEdge({ id: "w1", name: "א", unionType: "BETROTHAL", unionOrder: 3 }),
			],
		};
		const units = fuseMarriageAndForbiddenSpouseRows([
			multi,
			{ altGroupKey: null, edges: [spouseEdge({ id: "w2", name: "ב", unionOrder: 1 })] },
		]);
		expect(units[0].edges[0].related.entityId).toBe("w2");
		expect(units[1]).toBe(multi);
	});
});

describe("sortEdgesForOpinions", () => {
	it("ranks union types marriage, forbidden, banned incest, betrothal, then others", () => {
		const sorted = sortEdgesForOpinions([
			spouseEdge({ id: "e", name: "ה", unionType: "BETROTHAL" }),
			spouseEdge({ id: "a", name: "א", unionType: "MARRIAGE" }),
			spouseEdge({ id: "d", name: "ד", unionType: "BANNED_INCEST" }),
			spouseEdge({ id: "b", name: "ב", unionType: "FORBIDDEN_WITH_GENTILE" }),
			spouseEdge({ id: "c", name: "ג", unionType: "OTHER" }),
		]);
		expect(sorted.map((e) => e.unionType)).toEqual([
			"MARRIAGE",
			"FORBIDDEN_WITH_GENTILE",
			"BANNED_INCEST",
			"BETROTHAL",
			"OTHER",
		]);
	});

	it("orders equal ranks by union order then union type name", () => {
		const sorted = sortEdgesForOpinions([
			spouseEdge({ id: "a", name: "א", unionType: "MARRIAGE", unionOrder: 2 }),
			spouseEdge({ id: "b", name: "ב", unionType: "MARRIAGE", unionOrder: 1 }),
		]);
		expect(sorted.map((e) => e.related.entityId)).toEqual(["b", "a"]);
	});

	it("does not mutate the input array", () => {
		const input = [
			spouseEdge({ id: "a", name: "א", unionType: "BETROTHAL" }),
			spouseEdge({ id: "b", name: "ב", unionType: "MARRIAGE" }),
		];
		const snapshot = [...input];
		sortEdgesForOpinions(input);
		expect(input).toEqual(snapshot);
	});
});

describe("citationLines", () => {
	it("returns an empty list for null or blank text", () => {
		expect(citationLines(null)).toEqual([]);
		expect(citationLines("   \n  ")).toEqual([]);
	});

	it("trims lines, drops empty ones, and disambiguates duplicate keys", () => {
		const lines = citationLines("בראשית א א\n\n ויקרא ב ב\nבראשית א א\n");
		expect(lines.map((l) => l.line)).toEqual(["בראשית א א", "ויקרא ב ב", "בראשית א א"]);
		expect(lines.map((l) => l.key)).toEqual([
			"בראשית א א:1",
			"ויקרא ב ב:1",
			"בראשית א א:2",
		]);
	});
});

describe("sexMarkDataAttribute", () => {
	it("returns an empty attribute value for marked sexes and undefined otherwise", () => {
		expect(sexMarkDataAttribute("MALE")).toBe("");
		expect(sexMarkDataAttribute("FEMALE")).toBe("");
		expect(sexMarkDataAttribute(null)).toBeUndefined();
		expect(sexMarkDataAttribute("UNKNOWN")).toBeUndefined();
	});
});

describe("spouseTimelineSuffix", () => {
	it("joins start and end pieces with a leading separator", () => {
		expect(
			spouseTimelineSuffix(
				spouseEdge({ id: "w1", name: "א", unionStartDate: 18000101, unionEndDate: 19000101 }),
			),
		).toBe(" · התחלה 1800-01-01 · סיום 1900-01-01");
	});

	it("uses the end reason label instead of a plain end date", () => {
		expect(
			spouseTimelineSuffix(
				spouseEdge({ id: "w1", name: "א", unionEndReason: "DEATH", unionEndDate: 18500505 }),
			),
		).toBe(" · פטירה 1850-05-05");
	});

	it("returns an empty string when no timeline data exists", () => {
		expect(spouseTimelineSuffix(spouseEdge({ id: "w1", name: "א" }))).toBe("");
	});
});

describe("spouseTimelinePlain", () => {
	it("strips the leading separator from the suffix", () => {
		expect(
			spouseTimelinePlain(
				spouseEdge({ id: "w1", name: "א", unionStartDate: 18000101 }),
			),
		).toBe("התחלה 1800-01-01");
	});

	it("returns an empty string when the suffix is empty", () => {
		expect(spouseTimelinePlain(spouseEdge({ id: "w1", name: "א" }))).toBe("");
	});
});

describe("parentSourceCitation", () => {
	it("prefers a citation shared by one father and one mother", () => {
		expect(
			parentSourceCitation([
				parentEdge({ id: "f", name: "אב", parentRole: "FATHER", sourceCitation: "בראשית כט יט\nשמות א א" }),
				parentEdge({ id: "m", name: "אם", parentRole: "MOTHER", sourceCitation: "שמות ב ב\nבראשית כט יט" }),
			]),
		).toBe("בראשית כט יט");
	});

	it("joins distinct citations when nothing is shared", () => {
		expect(
			parentSourceCitation([
				parentEdge({ id: "f", name: "אב", parentRole: "FATHER", sourceCitation: "בראשית א א" }),
				parentEdge({ id: "m", name: "אם", parentRole: "MOTHER", sourceCitation: "שמות ב ב" }),
			]),
		).toBe("בראשית א א\nשמות ב ב");
	});

	it("returns null when no parent carries a citation", () => {
		expect(parentSourceCitation([parentEdge({ id: "f", name: "אב" })])).toBeNull();
	});
});

describe("shouldCollapseSpouseMatrix", () => {
	it("collapses when the natural width exceeds the available width", () => {
		expect(
			shouldCollapseSpouseMatrix({ previous: false, availableWidth: 800, naturalWidth: 900 }),
		).toBe(true);
	});

	it("expands once the available width clears natural width plus hysteresis", () => {
		expect(
			shouldCollapseSpouseMatrix({
				previous: true,
				availableWidth: 900 + SPOUSE_MATRIX_COLLAPSE_HYSTERESIS_PX,
				naturalWidth: 900,
			}),
		).toBe(false);
	});

	it("keeps the previous state inside the hysteresis band", () => {
		expect(
			shouldCollapseSpouseMatrix({ previous: true, availableWidth: 910, naturalWidth: 900 }),
		).toBe(true);
		expect(
			shouldCollapseSpouseMatrix({ previous: false, availableWidth: 910, naturalWidth: 900 }),
		).toBe(false);
	});

	it("keeps the previous state for non-positive measurements", () => {
		expect(
			shouldCollapseSpouseMatrix({ previous: true, availableWidth: 0, naturalWidth: 900 }),
		).toBe(true);
		expect(
			shouldCollapseSpouseMatrix({ previous: false, availableWidth: 800, naturalWidth: 0 }),
		).toBe(false);
	});
});

describe("layout constants", () => {
	it("exposes the hysteresis and vertical max width values used by the component", () => {
		expect(SPOUSE_MATRIX_COLLAPSE_HYSTERESIS_PX).toBe(24);
		expect(FAMILY_TREE_VERTICAL_MAX_WIDTH_PX).toBe(767);
	});
});
