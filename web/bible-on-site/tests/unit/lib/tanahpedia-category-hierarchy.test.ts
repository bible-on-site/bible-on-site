import {
	CATEGORY_HIERARCHY,
	labelForCategoryKey,
	subcategoryHref,
} from "../../../src/lib/tanahpedia/category-hierarchy";

describe("tanahpedia/category-hierarchy", () => {
	it("subcategoryHref uses query for prophet king and animal kinds", () => {
		expect(subcategoryHref("PROPHET")).toBe("/tanahpedia/person?role=prophet");
		expect(subcategoryHref("KING")).toBe("/tanahpedia/person?role=king");
		expect(subcategoryHref("BEHEMA")).toBe("/tanahpedia/animal?kind=behema");
		expect(subcategoryHref("TAHOR")).toBe("/tanahpedia/animal?purity=tahor");
	});

	it("subcategoryHref falls back to path segment", () => {
		expect(subcategoryHref("WAR")).toBe("/tanahpedia/war");
		expect(subcategoryHref("PROPHECY")).toBe("/tanahpedia/prophecy");
	});

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
