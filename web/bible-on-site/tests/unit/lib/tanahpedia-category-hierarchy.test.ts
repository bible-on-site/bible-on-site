import { websiteSubcategoryPath } from "../../../../admin/src/lib/tanahpedia/category-hierarchy";
import {
	CATEGORY_HIERARCHY,
	labelForCategoryKey,
} from "../../../src/lib/tanahpedia/category-hierarchy";
import { pediaPathFromLegacy } from "../../../src/lib/tanahpedia/category-slug";
import type { CategoryKey } from "../../../src/lib/tanahpedia/types";

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

	it("every admin outbound subcategory link resolves to a canonical /pedia path", () => {
		// Cross-consumer regression (#3710): the admin builds public-site
		// links with the shared category keys; each must resolve through the
		// website's legacy-path mapping instead of falling back to /pedia.
		const keys = CATEGORY_HIERARCHY.flatMap((item) => [
			item.type,
			...(item.children ?? []),
		]);
		for (const key of keys as CategoryKey[]) {
			const adminPath = websiteSubcategoryPath(key);
			const [segment, query = ""] = adminPath
				.replace(/^\/tanahpedia\/?/, "")
				.split("?");
			const params = new URLSearchParams(query);
			expect(
				pediaPathFromLegacy(segment || null, {
					role: params.get("role") ?? undefined,
					kind: params.get("kind") ?? undefined,
					purity: params.get("purity") ?? undefined,
				}),
			).not.toBe("/pedia");
		}
	});
});
