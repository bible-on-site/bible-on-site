/**
 * Tests for the tanahpedia [entityType] page's exported functions:
 * generateStaticParams and generateMetadata.
 */

// Bypass unstable_cache — just run the wrapped function directly
jest.mock("next/cache", () => ({
	unstable_cache: (fn: (...args: never[]) => unknown) => fn,
}));

jest.mock("next/navigation", () => ({
	notFound: jest.fn(() => {
		throw new Error("NEXT_NOT_FOUND");
	}),
}));

jest.mock("next/link", () => ({
	__esModule: true,
	default: ({ children }: { children: React.ReactNode }) => children,
}));

jest.mock("../../../src/lib/tanahpedia/service", () => ({
	...jest.requireActual("../../../src/lib/tanahpedia/service"),
	getAllEntityTypeParams: jest.fn(),
	getEntitiesWithEntries: jest.fn(),
	getEntitiesWithEntriesByRole: jest.fn(),
	getAnimalsByClassification: jest.fn(),
	getCategoryHomepage: jest.fn(),
	getPlaceMapMarkers: jest.fn().mockResolvedValue([]),
	ENTITY_TYPES: ["PERSON", "PLACE", "EVENT"],
	ENTITY_TYPE_LABELS: {
		PERSON: "אישים",
		PLACE: "מקומות",
		EVENT: "אירועים",
	},
	CATEGORY_LABELS: {
		PERSON: "אישים",
		PLACE: "מקומות",
		EVENT: "אירועים",
		PROPHET: "נביאים",
		KING: "מלכים",
	},
}));

import {
	getAllEntityTypeParams,
	getEntitiesWithEntries,
	getCategoryHomepage,
} from "../../../src/lib/tanahpedia/service";
import EntityTypePage, {
	generateMetadata,
	generateStaticParams,
} from "../../../src/app/tanahpedia/[entityType]/page";

const mockGetAllEntityTypeParams = getAllEntityTypeParams as jest.MockedFunction<
	typeof getAllEntityTypeParams
>;
const mockGetEntitiesWithEntries = getEntitiesWithEntries as jest.MockedFunction<
	typeof getEntitiesWithEntries
>;
const mockGetCategoryHomepage = getCategoryHomepage as jest.MockedFunction<
	typeof getCategoryHomepage
>;

describe("tanahpedia/[entityType] page", () => {
	beforeEach(() => {
		jest.clearAllMocks();
	});

	describe("generateStaticParams", () => {
		it("returns all entity types as params", async () => {
			mockGetAllEntityTypeParams.mockResolvedValue([
				{ entityType: "person" },
				{ entityType: "place" },
				{ entityType: "event" },
			]);

			const result = await generateStaticParams();

			expect(result).toEqual([
				{ entityType: "person" },
				{ entityType: "place" },
				{ entityType: "event" },
			]);
		});

		it("returns base entity types when database is unavailable", async () => {
			mockGetAllEntityTypeParams.mockRejectedValue(
				new Error("Database connection failed"),
			);

			const result = await generateStaticParams();

			expect(result).toEqual([
				{ entityType: "person" },
				{ entityType: "place" },
				{ entityType: "event" },
			]);
		});
	});

	describe("generateMetadata", () => {
		it("returns entity type label in title for base entity type", async () => {
			const result = await generateMetadata({
				params: Promise.resolve({ entityType: "person" }),
				searchParams: Promise.resolve({}),
			});

			expect(result).toEqual({
				title: "אישים | תנכפדיה",
				description: 'רשימת אישים בתנ"ך',
			});
		});

		it("returns subcategory label in title for person role", async () => {
			const result = await generateMetadata({
				params: Promise.resolve({ entityType: "person" }),
				searchParams: Promise.resolve({ role: "prophet" }),
			});

			expect(result).toEqual({
				title: "נביאים | תנכפדיה",
				description: 'רשימת נביאים בתנ"ך',
			});
		});

		it("returns not found for invalid entity type", async () => {
			const result = await generateMetadata({
				params: Promise.resolve({ entityType: "invalid" }),
				searchParams: Promise.resolve({}),
			});

			expect(result).toEqual({
				title: "לא נמצא",
			});
		});
	});

	describe("EntityTypePage", () => {
		it("renders page for valid entity type", async () => {
			mockGetEntitiesWithEntries.mockResolvedValue([
				{
					entityType: "PERSON",
					entityId: "entity-1",
					entityName: "משה רבנו",
					linkedEntries: [],
				},
			]);
			mockGetCategoryHomepage.mockResolvedValue(null);

			const result = await EntityTypePage({
				params: Promise.resolve({ entityType: "person" }),
				searchParams: Promise.resolve({}),
			});

			expect(result).toBeDefined();
		});
	});
});
