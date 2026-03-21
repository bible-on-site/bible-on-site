import {
	parentRoleLabel,
	parentRoleSortKey,
	relationshipTypeLabel,
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
