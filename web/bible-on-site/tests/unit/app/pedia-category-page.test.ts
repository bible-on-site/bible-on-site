/**
 * Tests for the merged `/pedia/[slug]` route acting as a category listing:
 * metadata, Hebrew-slug resolution, sub-filters and legacy redirects.
 */

// Bypass unstable_cache — just run the wrapped function directly
jest.mock("next/cache", () => ({
	unstable_cache: (fn: (...args: never[]) => unknown) => fn,
}));

jest.mock("next/navigation", () => ({
	notFound: jest.fn(() => {
		throw new Error("NEXT_NOT_FOUND");
	}),
	redirect: jest.fn((url: string) => {
		throw new Error(`NEXT_REDIRECT:${url}`);
	}),
}));

jest.mock("next/link", () => ({
	__esModule: true,
	default: ({ children }: { children: React.ReactNode }) => children,
}));

jest.mock("../../../src/lib/tanahpedia/service", () => ({
	...jest.requireActual("../../../src/lib/tanahpedia/service"),
	getAllEntryUniqueNames: jest.fn().mockResolvedValue([]),
	getEntryByUniqueName: jest.fn().mockResolvedValue(null),
	getEntitiesWithEntries: jest.fn(),
	getEntitiesWithEntriesByRole: jest.fn(),
	getAnimalsByClassification: jest.fn(),
	getCategoryHomepage: jest.fn(),
	getPlaceMapMarkers: jest.fn().mockResolvedValue([]),
}));

import { render, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import { CategoryView } from "../../../src/app/pedia/[slug]/category-view";
import PediaSlugPage, {
	generateMetadata,
} from "../../../src/app/pedia/[slug]/page";
import { resolveCategoryRoute } from "../../../src/lib/tanahpedia/category-slug";
import {
	getAnimalsByClassification,
	getCategoryHomepage,
	getEntitiesWithEntries,
	getEntitiesWithEntriesByRole,
	getEntryByUniqueName,
	getPlaceMapMarkers,
} from "../../../src/lib/tanahpedia/service";

const mockGetEntitiesWithEntries =
	getEntitiesWithEntries as jest.MockedFunction<typeof getEntitiesWithEntries>;
const mockGetEntitiesWithEntriesByRole =
	getEntitiesWithEntriesByRole as jest.MockedFunction<
		typeof getEntitiesWithEntriesByRole
	>;
const mockGetAnimalsByClassification =
	getAnimalsByClassification as jest.MockedFunction<
		typeof getAnimalsByClassification
	>;
const mockGetCategoryHomepage = getCategoryHomepage as jest.MockedFunction<
	typeof getCategoryHomepage
>;
const mockGetPlaceMapMarkers = getPlaceMapMarkers as jest.MockedFunction<
	typeof getPlaceMapMarkers
>;
const mockGetEntryByUniqueName = getEntryByUniqueName as jest.MockedFunction<
	typeof getEntryByUniqueName
>;

describe("pedia/[slug] category route", () => {
	beforeEach(() => {
		jest.clearAllMocks();
		mockGetCategoryHomepage.mockResolvedValue(null);
		mockGetEntitiesWithEntries.mockResolvedValue([]);
	});

	describe("generateMetadata", () => {
		it("returns the category label for a Hebrew slug", async () => {
			const result = await generateMetadata({
				params: Promise.resolve({ slug: "אישים" }),
				searchParams: Promise.resolve({}),
			});

			expect(result.title).toBe("אישים | תנכפדיה");
			expect(result.alternates?.canonical).toBe("/pedia/אישים");
		});

		it("returns the subcategory label when a role filter is applied", async () => {
			const result = await generateMetadata({
				params: Promise.resolve({ slug: "אישים" }),
				searchParams: Promise.resolve({ role: "נביאים" }),
			});

			expect(result.title).toBe("נביאים | תנכפדיה");
			expect(result.alternates?.canonical).toBe("/pedia/אישים?role=נביאים");
		});

		it("returns the subcategory label for the short sugar slug", async () => {
			const result = await generateMetadata({
				params: Promise.resolve({ slug: "נביאים" }),
				searchParams: Promise.resolve({}),
			});

			expect(result.title).toBe("נביאים | תנכפדיה");
			expect(result.alternates?.canonical).toBe("/pedia/אישים?role=נביאים");
		});

		it("ignores filters that do not belong to the category", async () => {
			const personResult = await generateMetadata({
				params: Promise.resolve({ slug: "אישים" }),
				searchParams: Promise.resolve({ role: "שופטים" }),
			});
			const animalResult = await generateMetadata({
				params: Promise.resolve({ slug: "בעלי-חיים" }),
				searchParams: Promise.resolve({ kind: "דרקונים", purity: "לא-ידוע" }),
			});

			expect(personResult.title).toBe("אישים | תנכפדיה");
			expect(animalResult.title).toBe("בעלי חיים | תנכפדיה");
		});

		it("falls back to entry metadata for a non-category slug", async () => {
			mockGetEntryByUniqueName.mockResolvedValue(null);

			const result = await generateMetadata({
				params: Promise.resolve({ slug: "משה-רבנו" }),
				searchParams: Promise.resolve({}),
			});

			expect(result.title).toBe("לא נמצא");
		});
	});

	describe("category rendering", () => {
		/** The route returns `<CategoryView>` unawaited, so render the view itself. */
		async function renderCategory(
			slug: string,
			searchParams: Record<string, string> = {},
		) {
			const resolved = resolveCategoryRoute(slug, searchParams);
			if (!resolved) throw new Error(`not a category slug: ${slug}`);
			return await CategoryView({ resolved });
		}

		it("renders the listing for a Hebrew category slug", async () => {
			mockGetEntitiesWithEntries.mockResolvedValue([
				{
					entityType: "PERSON",
					entityId: "entity-1",
					entityName: "משה רבנו",
					linkedEntries: [
						{ id: "entry-1", uniqueName: "moshe", title: "משה רבנו" },
					],
				},
			]);
			mockGetCategoryHomepage.mockResolvedValue({
				id: "homepage-person",
				entityType: "PERSON",
				layoutType: "LIST",
				config: null,
				content: "<p>Intro content</p>",
				updatedAt: "2026-01-01",
			});

			const result = await renderCategory("אישים");

			render(result as ReactElement);
			expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
				"אישים",
			);
			expect(screen.getByText("Intro content")).toBeInTheDocument();
		});

		it.each([
			["query filter", "אישים", { role: "נביאים" }],
			["sugar slug", "נביאים", {}],
		])("loads persons by role via %s", async (_label, slug, searchParams) => {
			mockGetEntitiesWithEntriesByRole.mockResolvedValue([
				{
					entityType: "PERSON",
					entityId: "prophet-1",
					entityName: "Prophet one",
					linkedEntries: [],
				},
			]);

			const result = await renderCategory(slug, searchParams);

			expect(result).toBeDefined();
			expect(mockGetEntitiesWithEntriesByRole).toHaveBeenCalledWith("PROPHET");
			expect(mockGetEntitiesWithEntries).not.toHaveBeenCalled();
		});

		it.each([
			["kind", { kind: "חיות" }, "kind", "CHAYA"],
			["purity", { purity: "טהורים" }, "purity", "TAHOR"],
		] as const)("uses animal %s classification loading when requested", async (_label, searchParams, classificationType, classificationValue) => {
			mockGetAnimalsByClassification.mockResolvedValue([
				{
					entityType: "ANIMAL",
					entityId: "animal-1",
					entityName: "Animal one",
					linkedEntries: [],
				},
			]);

			const result = await renderCategory("בעלי-חיים", searchParams);

			expect(result).toBeDefined();
			expect(mockGetAnimalsByClassification).toHaveBeenCalledWith(
				classificationType,
				classificationValue,
			);
		});

		it("loads place map markers when the place homepage uses map layout", async () => {
			mockGetCategoryHomepage.mockResolvedValue({
				id: "homepage-place",
				entityType: "PLACE",
				layoutType: "MAP",
				config: null,
				content: null,
				updatedAt: "2026-01-01",
			});
			mockGetPlaceMapMarkers.mockResolvedValue([
				{
					placeId: "place-1",
					placeName: "Jerusalem",
					modernName: null,
					lat: 31.778,
					lng: 35.235,
					entryUniqueName: "jerusalem",
				},
			]);

			const result = await renderCategory("מקומות");

			expect(result).toBeDefined();
			expect(mockGetPlaceMapMarkers).toHaveBeenCalledTimes(1);
		});

		it("renders a database warning when category loading fails", async () => {
			const oldNodeEnv = process.env.NODE_ENV;
			Object.defineProperty(process.env, "NODE_ENV", {
				value: "development",
				configurable: true,
			});
			mockGetEntitiesWithEntries.mockRejectedValue(
				new Error("connection down"),
			);

			const result = await renderCategory("אישים");

			render(result as ReactElement);
			expect(screen.getByRole("alert")).toBeInTheDocument();
			Object.defineProperty(process.env, "NODE_ENV", {
				value: oldNodeEnv,
				configurable: true,
			});
		});
	});

	describe("legacy and unknown slugs", () => {
		it("still renders a legacy English slug when the proxy is bypassed", async () => {
			const result = await PediaSlugPage({
				params: Promise.resolve({ slug: "person" }),
				searchParams: Promise.resolve({ role: "prophet" }),
			});

			expect(
				(result as ReactElement<{ resolved: { sub: string | null } }>).props
					.resolved.sub,
			).toBe("PROPHET");
		});

		it("treats an unknown slug as an entry lookup", async () => {
			const result = await PediaSlugPage({
				params: Promise.resolve({ slug: "לא-קיים" }),
				searchParams: Promise.resolve({}),
			});

			expect((result as ReactElement<{ slug: string }>).props.slug).toBe(
				"לא-קיים",
			);
			expect(mockGetEntitiesWithEntries).not.toHaveBeenCalled();
		});
	});
});
