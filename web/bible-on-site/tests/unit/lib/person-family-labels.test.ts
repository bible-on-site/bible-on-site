import {
	formatUnionYyyymmdd,
	parentRoleLabel,
	parentRoleSortKey,
	relationshipTypeLabel,
	spouseHalachicOpinionTitle,
	spousesSectionLabel,
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
	});

	describe("unionEndReasonLabel", () => {
		it("returns Hebrew for end reasons", () => {
			expect(unionEndReasonLabel("DEATH")).toBe("פטירה");
			expect(unionEndReasonLabel("DIVORCE")).toBe("גירושין");
		});
	});

	describe("formatUnionYyyymmdd", () => {
		it("formats 8-digit dates", () => {
			expect(formatUnionYyyymmdd(18500101)).toBe("1850-01-01");
		});

		it("returns null for null", () => {
			expect(formatUnionYyyymmdd(null)).toBeNull();
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
	});

	describe("parentRoleSortKey", () => {
		it("orders father before mother", () => {
			expect(parentRoleSortKey("FATHER")).toBeLessThan(
				parentRoleSortKey("MOTHER"),
			);
		});
	});
});
