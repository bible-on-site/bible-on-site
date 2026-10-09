import {
	CATEGORY_HIERARCHY,
	labelForCategoryKey,
} from "../../../src/lib/tanahpedia/category-hierarchy";

describe("tanahpedia/category-hierarchy", () => {
	it("labelForCategoryKey resolves from labels map", () => {
		expect(labelForCategoryKey("PROPHET").length).toBeGreaterThan(0);
		expect(labelForCategoryKey("PERSON").length).toBeGreaterThan(0);
	});

	it("CATEGORY_HIERARCHY includes person and animal branches", () => {
		const person = CATEGORY_HIERARCHY.find((c) => c.type === "PERSON");
		expect(person?.children).toContain("PROPHET");
		const animal = CATEGORY_HIERARCHY.find((c) => c.type === "ANIMAL");
		expect(animal?.children?.length).toBeGreaterThan(3);
	});
});
