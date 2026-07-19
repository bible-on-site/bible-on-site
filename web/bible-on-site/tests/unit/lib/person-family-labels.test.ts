import {
	childGroupByCoParentLabel,
	focalChildCardMetaLine,
	formatUnionYyyymmdd,
	parentRoleLabel,
	parentRoleSortKey,
	partitionSiblingsForFamilyTree,
	personSexCornerMark,
	relationshipTypeLabel,
	spouseHalachicOpinionTitle,
	spousesSectionLabel,
	siblingSectionLabelGeneric,
	siblingSectionLabelOlder,
	siblingSectionLabelYounger,
	unionEndReasonLabel,
	unionTypeLabel,
} from "../../../src/lib/tanahpedia/person-family-labels";

describe("person-family-labels", () => {
	describe("parentRoleLabel", () => {
		it("returns Hebrew for known roles", () => {
			expect(parentRoleLabel("FATHER")).toBe("אב");
			expect(parentRoleLabel("MOTHER")).toBe("אם");
		});

		it("returns raw code for unknown role", () => {
			expect(parentRoleLabel("GUARDIAN")).toBe("GUARDIAN");
		});
	});

	describe("relationshipTypeLabel", () => {
		it("returns Hebrew for known types", () => {
			expect(relationshipTypeLabel("BIOLOGICAL")).toBe("ביולוגי");
			expect(relationshipTypeLabel("ADOPTIVE")).toBe("אימוץ");
			expect(relationshipTypeLabel("STEP")).toBe("חורג");
		});

		it("returns raw code for unknown type", () => {
			expect(relationshipTypeLabel("MENTOR")).toBe("MENTOR");
		});
	});

	describe("unionTypeLabel", () => {
		it("returns Hebrew for known union types", () => {
			expect(unionTypeLabel("MARRIAGE")).toBe("נישואין");
			expect(unionTypeLabel("PILEGESH")).toBe("פילגש");
			expect(unionTypeLabel("FORBIDDEN_WITH_GENTILE")).toBe(
				"קשר פסול עם גויה",
			);
			expect(unionTypeLabel("BANNED_INCEST")).toBe("קשר אסור (ערוה)");
			expect(unionTypeLabel("BETROTHAL")).toBe("אירוסין");
		});

		it("returns raw code for unknown union type", () => {
			expect(unionTypeLabel("UNKNOWN_UNION")).toBe("UNKNOWN_UNION");
		});
	});

	describe("unionEndReasonLabel", () => {
		it("returns Hebrew for end reasons", () => {
			expect(unionEndReasonLabel("DEATH")).toBe("פטירה");
			expect(unionEndReasonLabel("DIVORCE")).toBe("גירושין");
		});

		it("returns raw code for unknown end reasons", () => {
			expect(unionEndReasonLabel("UNKNOWN")).toBe("UNKNOWN");
		});
	});

	describe("formatUnionYyyymmdd", () => {
		it("formats 8-digit dates", () => {
			expect(formatUnionYyyymmdd(18500101)).toBe("1850-01-01");
			expect(formatUnionYyyymmdd("18000102")).toBe("1800-01-02");
		});

		it("returns null for null", () => {
			expect(formatUnionYyyymmdd(null)).toBeNull();
			expect(formatUnionYyyymmdd("")).toBeNull();
			expect(formatUnionYyyymmdd("not-a-date")).toBeNull();
		});

		it("returns non-8-digit numeric values as-is", () => {
			expect(formatUnionYyyymmdd(1850)).toBe("1850");
		});
	});

	describe("spousesSectionLabel", () => {
		it("uses בנות זוג for a male focal person", () => {
			expect(spousesSectionLabel("MALE")).toBe("בנות זוג");
		});

		it("uses בני זוג for a female focal person", () => {
			expect(spousesSectionLabel("FEMALE")).toBe("בני זוג");
		});

		it("uses neutral זיווגים when sex is unknown", () => {
			expect(spousesSectionLabel(null)).toBe("זיווגים");
		});
	});

	describe("spouseHalachicOpinionTitle", () => {
		it("states Rambam marriage view explicitly", () => {
			expect(spouseHalachicOpinionTitle("MARRIAGE")).toBe(
				'הרמב"ם: נישואין תקפים',
			);
		});

		it("names Rishonim and forbidden bond for the alternative view", () => {
			expect(spouseHalachicOpinionTitle("FORBIDDEN_WITH_GENTILE")).toContain(
				"רש\"י",
			);
			expect(spouseHalachicOpinionTitle("FORBIDDEN_WITH_GENTILE")).toContain(
				"קשר פסול עם גויה",
			);
		});

		it("describes banned incest and betrothal demo opinions", () => {
			expect(spouseHalachicOpinionTitle("BANNED_INCEST")).toContain("ערוה");
			expect(spouseHalachicOpinionTitle("BETROTHAL")).toContain("אירוסין");
		});

		it("falls back to the union label", () => {
			expect(spouseHalachicOpinionTitle("PILEGESH")).toBe("פילגש");
		});
	});

	describe("parentRoleSortKey", () => {
		it("orders father before mother", () => {
			expect(parentRoleSortKey("FATHER")).toBeLessThan(
				parentRoleSortKey("MOTHER"),
			);
			expect(parentRoleSortKey("OTHER")).toBe(2);
		});
	});

	describe("personSexCornerMark", () => {
		it("maps known sex codes and ignores unknown values", () => {
			expect(personSexCornerMark("MALE")).toBe("ז");
			expect(personSexCornerMark("FEMALE")).toBe("נ");
			expect(personSexCornerMark("UNKNOWN")).toBeNull();
			expect(personSexCornerMark(null)).toBeNull();
		});
	});

	describe("focalChildCardMetaLine", () => {
		it("omits biological child metadata and labels non-biological relationships", () => {
			expect(
				focalChildCardMetaLine({
					parentRole: "FATHER",
					relationshipType: "BIOLOGICAL",
					related: { sex: "MALE" },
				}),
			).toBeNull();
			expect(
				focalChildCardMetaLine({
					parentRole: "MOTHER",
					relationshipType: "ADOPTIVE",
					related: { sex: "FEMALE" },
				}),
			).toBe("אם · אימוץ");
		});
	});

	describe("partitionSiblingsForFamilyTree", () => {
		const sibling = (entityId: string, displayName: string, birthDateYyyymmdd?: number | null) => ({
			personId: `p-${entityId}`,
			entityId,
			displayName,
			entryUniqueName: null,
			entryTitle: null,
			sex: null,
			birthDateYyyymmdd,
		});

		it("splits siblings alphabetically when focal birth is unavailable", () => {
			const result = partitionSiblingsForFamilyTree(
				[sibling("b", "ב"), sibling("a", "א"), sibling("c", "ג")],
				null,
			);
			expect(result.preLabel).toBe(siblingSectionLabelGeneric);
			expect(result.postLabel).toBe(siblingSectionLabelGeneric);
			expect(result.preCluster.map((s) => s.displayName)).toEqual(["א", "ב"]);
			expect(result.postCluster.map((s) => s.displayName)).toEqual(["ג"]);
		});

		it("labels older and younger siblings when both sides are known", () => {
			const result = partitionSiblingsForFamilyTree(
				[
					sibling("old", "מבוגר", 10000101),
					sibling("young", "צעיר", 10000103),
					sibling("unknown", "לא ידוע", null),
				],
				10000102,
			);
			expect(result.preLabel).toBe(siblingSectionLabelOlder);
			expect(result.postLabel).toBe(siblingSectionLabelYounger);
			expect(result.preCluster.map((s) => s.displayName)).toEqual(["מבוגר"]);
			expect(result.postCluster.map((s) => s.displayName)).toEqual([
				"לא ידוע",
				"צעיר",
			]);
		});

		it("handles empty and single sibling lists", () => {
			expect(partitionSiblingsForFamilyTree([], 10000102)).toMatchObject({
				preCluster: [],
				postCluster: [],
				preLabel: null,
				postLabel: null,
			});
			expect(
				partitionSiblingsForFamilyTree([sibling("only", "יחיד")], Number.NaN),
			).toMatchObject({
				preLabel: siblingSectionLabelGeneric,
				postLabel: null,
			});
		});
	});

	describe("childGroupByCoParentLabel", () => {
		it("labels child groups by co-parent when available", () => {
			expect(childGroupByCoParentLabel("רחל", true)).toBe("ילדים מ־רחל");
			expect(childGroupByCoParentLabel(null, false)).toBe(
				"ילדים (בת זוג לא מזוהה בנתונים)",
			);
		});
	});
});
