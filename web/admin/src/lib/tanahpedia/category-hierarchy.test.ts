import { describe, expect, it } from "vitest";
import {
	CATEGORY_HIERARCHY,
	labelForCategoryKey,
	websiteSubcategoryPath,
} from "./category-hierarchy";
import { CATEGORY_LABELS, ENTITY_TYPE_LABELS, ENTITY_TYPES } from "./labels";

describe("tanahpedia category hierarchy", () => {
	it("lists every base entity type exactly once", () => {
		expect(CATEGORY_HIERARCHY.map((item) => item.type)).toEqual([
			"PERSON",
			"PLACE",
			"EVENT",
			"SAYING",
			"OBJECT",
			"ANIMAL",
			"PLANT",
			"SEFER",
			"NATION",
		]);
		expect(new Set(ENTITY_TYPES)).toEqual(new Set(Object.keys(ENTITY_TYPE_LABELS)));
	});

	it("builds website paths for roles, animal kinds, purities, and base categories", () => {
		expect(websiteSubcategoryPath("PROPHET")).toBe("/tanahpedia/person?role=prophet");
		expect(websiteSubcategoryPath("KING")).toBe("/tanahpedia/person?role=king");
		expect(websiteSubcategoryPath("BEHEMA")).toBe("/tanahpedia/animal?kind=behema");
		expect(websiteSubcategoryPath("CHAYA")).toBe("/tanahpedia/animal?kind=chaya");
		expect(websiteSubcategoryPath("OF")).toBe("/tanahpedia/animal?kind=of");
		expect(websiteSubcategoryPath("SHERETZ")).toBe("/tanahpedia/animal?kind=sheretz");
		expect(websiteSubcategoryPath("TAHOR")).toBe("/tanahpedia/animal?purity=tahor");
		expect(websiteSubcategoryPath("TAMEH")).toBe("/tanahpedia/animal?purity=tameh");
		expect(websiteSubcategoryPath("PLACE")).toBe("/tanahpedia/place");
	});

	it("returns Hebrew labels for category keys", () => {
		expect(labelForCategoryKey("PERSON")).toBe(ENTITY_TYPE_LABELS.PERSON);
		expect(labelForCategoryKey("PROPHET")).toBe(CATEGORY_LABELS.PROPHET);
		expect(labelForCategoryKey("BEHEMA")).toBe(CATEGORY_LABELS.BEHEMA);
	});
});