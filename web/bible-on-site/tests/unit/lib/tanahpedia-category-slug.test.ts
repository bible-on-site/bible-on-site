import {
	CATEGORY_SLUGS,
	categoryHref,
	categoryKeyFromSlug,
	categoryShortHref,
	isSubCategoryKey,
	pediaPathFromLegacy,
	resolveCategoryRoute,
	slugForCategoryKey,
} from "../../../src/lib/tanahpedia/category-slug";
import type { CategoryKey } from "../../../src/lib/tanahpedia/types";

describe("tanahpedia/category-slug", () => {
	describe("slug maps", () => {
		it("assigns a unique Hebrew slug to every category key", () => {
			const slugs = Object.values(CATEGORY_SLUGS);
			expect(new Set(slugs).size).toBe(slugs.length);
			for (const slug of slugs) {
				expect(slug).toMatch(/^[\u0590-\u05FF-]+$/);
			}
		});

		it("round-trips every key through its slug", () => {
			for (const key of Object.keys(CATEGORY_SLUGS) as CategoryKey[]) {
				expect(categoryKeyFromSlug(slugForCategoryKey(key))).toBe(key);
			}
		});
	});

	describe("categoryKeyFromSlug", () => {
		it("resolves Hebrew slugs", () => {
			expect(categoryKeyFromSlug("אישים")).toBe("PERSON");
			expect(categoryKeyFromSlug("נביאים")).toBe("PROPHET");
		});

		it("resolves legacy English identifiers", () => {
			expect(categoryKeyFromSlug("person")).toBe("PERSON");
			expect(categoryKeyFromSlug("PERSON")).toBe("PERSON");
			expect(categoryKeyFromSlug("temple_tool")).toBe("TEMPLE_TOOL");
			expect(categoryKeyFromSlug("temple tool")).toBe("TEMPLE_TOOL");
		});

		it("resolves percent-encoded and padded input", () => {
			expect(categoryKeyFromSlug(encodeURIComponent("אישים"))).toBe("PERSON");
			expect(categoryKeyFromSlug("  אישים  ")).toBe("PERSON");
		});

		it("returns null for unknown slugs and malformed escapes", () => {
			expect(categoryKeyFromSlug("משה-רבנו")).toBeNull();
			expect(categoryKeyFromSlug("%E0%A4%A")).toBeNull();
		});
	});

	describe("hrefs", () => {
		it("uses the plain path for entity types", () => {
			expect(categoryHref("PERSON")).toBe("/pedia/אישים");
			expect(categoryShortHref("PERSON")).toBe("/pedia/אישים");
		});

		it("uses the parent listing plus a filter query for subcategories", () => {
			expect(categoryHref("PROPHET")).toBe("/pedia/אישים?role=נביאים");
			expect(categoryHref("CHAYA")).toBe("/pedia/בעלי-חיים?kind=חיות");
			expect(categoryHref("TAHOR")).toBe("/pedia/בעלי-חיים?purity=טהורים");
		});

		it("exposes the short sugar path for subcategories", () => {
			expect(categoryShortHref("PROPHET")).toBe("/pedia/נביאים");
		});
	});

	describe("isSubCategoryKey", () => {
		it("distinguishes subcategories from entity types", () => {
			expect(isSubCategoryKey("PROPHET")).toBe(true);
			expect(isSubCategoryKey("TAMEH")).toBe(true);
			expect(isSubCategoryKey("PERSON")).toBe(false);
		});
	});

	describe("resolveCategoryRoute", () => {
		it("resolves a plain category slug", () => {
			expect(resolveCategoryRoute("אישים")).toEqual({
				entityType: "PERSON",
				sub: null,
				slug: "אישים",
				isCanonicalSlug: true,
				canonicalPath: "/pedia/אישים",
			});
		});

		it("treats a percent-encoded Hebrew slug as canonical", () => {
			expect(
				resolveCategoryRoute(encodeURIComponent("אישים"))?.isCanonicalSlug,
			).toBe(true);
		});

		it("applies a matching filter query", () => {
			expect(resolveCategoryRoute("אישים", { role: "נביאים" })).toEqual({
				entityType: "PERSON",
				sub: "PROPHET",
				slug: "אישים",
				isCanonicalSlug: true,
				canonicalPath: "/pedia/אישים?role=נביאים",
			});
		});

		it("resolves the short sugar slug to the same canonical URL", () => {
			expect(resolveCategoryRoute("נביאים")).toEqual({
				entityType: "PERSON",
				sub: "PROPHET",
				slug: "נביאים",
				isCanonicalSlug: true,
				canonicalPath: "/pedia/אישים?role=נביאים",
			});
		});

		it("keeps the legacy English slug so the route can redirect", () => {
			expect(resolveCategoryRoute("person", { role: "prophet" })).toEqual({
				entityType: "PERSON",
				sub: "PROPHET",
				slug: "אישים",
				isCanonicalSlug: false,
				canonicalPath: "/pedia/אישים?role=נביאים",
			});
		});

		it("ignores filters that belong to another category or parameter", () => {
			expect(resolveCategoryRoute("אישים", { kind: "חיות" })?.sub).toBeNull();
			expect(resolveCategoryRoute("אישים", { role: "חיות" })?.sub).toBeNull();
			expect(
				resolveCategoryRoute("בעלי-חיים", { purity: "חיות" })?.sub,
			).toBeNull();
			expect(resolveCategoryRoute("אישים", { role: "" })?.sub).toBeNull();
			expect(resolveCategoryRoute("אישים", { role: "שופטים" })?.sub).toBeNull();
		});

		it("prefers the first valid filter when several are supplied", () => {
			expect(
				resolveCategoryRoute("בעלי-חיים", { kind: "חיות", purity: "טהורים" })
					?.sub,
			).toBe("CHAYA");
		});

		it("returns null for a non-category slug", () => {
			expect(resolveCategoryRoute("משה-רבנו")).toBeNull();
		});
	});

	describe("pediaPathFromLegacy", () => {
		it("maps the legacy landing page", () => {
			expect(pediaPathFromLegacy(null)).toBe("/pedia");
		});

		it("maps legacy category and filter URLs", () => {
			expect(pediaPathFromLegacy("person")).toBe("/pedia/אישים");
			expect(pediaPathFromLegacy("person", { role: "prophet" })).toBe(
				"/pedia/אישים?role=נביאים",
			);
			expect(pediaPathFromLegacy("animal", { purity: "tahor" })).toBe(
				"/pedia/בעלי-חיים?purity=טהורים",
			);
		});

		it("falls back to the landing page for unknown segments", () => {
			expect(pediaPathFromLegacy("nonsense")).toBe("/pedia");
		});
	});
});
