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
	ENTITY_TYPES: ["PERSON", "PLACE", "EVENT", "ANIMAL"],
	ENTITY_TYPE_LABELS: {
		PERSON: "אישים",
		PLACE: "מקומות",
		EVENT: "אירועים",
		ANIMAL: "בעלי חיים",
	},
	CATEGORY_LABELS: {
		PERSON: "אישים",
		PLACE: "מקומות",
		EVENT: "אירועים",
		PROPHET: "נביאים",
		KING: "מלכים",
		ANIMAL: "בעלי חיים",
		BEHEMA: "בהמה",
		CHAYA: "חיה",
		OF: "עוף",
		SHERETZ: "שרץ",
		TAHOR: "טהור",
		TAMEH: "טמא",
	},
}));

import {
	getAllEntityTypeParams,
	getAnimalsByClassification,
	getEntitiesWithEntries,
	getEntitiesWithEntriesByRole,
	getCategoryHomepage,
	getPlaceMapMarkers,
} from "../../../src/lib/tanahpedia/service";
import { render, screen } from "@testing-library/react";
import type { ReactElement } from "react";
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
				{ entityType: "animal" },
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

		it("uses role-specific entity loading when a valid person role is requested", async () => {
			mockGetEntitiesWithEntriesByRole.mockResolvedValue([
				{
					entityType: "PERSON",
					entityId: "prophet-1",
					entityName: "Prophet one",
					linkedEntries: [],
				},
			]);
			mockGetCategoryHomepage.mockResolvedValue(null);

			const result = await EntityTypePage({
				params: Promise.resolve({ entityType: "person" }),
				searchParams: Promise.resolve({ role: "prophet" }),
			});

			expect(result).toBeDefined();
			expect(mockGetEntitiesWithEntriesByRole).toHaveBeenCalledWith("PROPHET");
			expect(mockGetEntitiesWithEntries).not.toHaveBeenCalled();
		});

		it.each([
			["kind", { kind: "chaya" }, "kind", "CHAYA"],
			["purity", { purity: "tahor" }, "purity", "TAHOR"],
		] as const)(
			"uses animal %s classification loading when requested",
			async (_label, searchParams, classificationType, classificationValue) => {
				mockGetAnimalsByClassification.mockResolvedValue([
					{
						entityType: "ANIMAL",
						entityId: "animal-1",
						entityName: "Animal one",
						linkedEntries: [],
					},
				]);
				mockGetCategoryHomepage.mockResolvedValue(null);

				const result = await EntityTypePage({
					params: Promise.resolve({ entityType: "animal" }),
					searchParams: Promise.resolve(searchParams),
				});

				expect(result).toBeDefined();
				expect(mockGetAnimalsByClassification).toHaveBeenCalledWith(
					classificationType,
					classificationValue,
				);
			},
		);

		it("loads place map markers when the place homepage uses map layout", async () => {
			mockGetEntitiesWithEntries.mockResolvedValue([]);
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

			const result = await EntityTypePage({
				params: Promise.resolve({ entityType: "place" }),
				searchParams: Promise.resolve({}),
			});

			expect(result).toBeDefined();
			expect(mockGetPlaceMapMarkers).toHaveBeenCalledTimes(1);
		});

		it("renders a database warning when category loading fails", async () => {
			const oldNodeEnv = process.env.NODE_ENV;
			Object.defineProperty(process.env, "NODE_ENV", {
				value: "development",
				configurable: true,
			});
			mockGetEntitiesWithEntries.mockRejectedValue(new Error("connection down"));

			const result = await EntityTypePage({
				params: Promise.resolve({ entityType: "person" }),
				searchParams: Promise.resolve({}),
			});

			render(result as ReactElement);
			expect(screen.getByRole("alert")).toBeInTheDocument();
			Object.defineProperty(process.env, "NODE_ENV", {
				value: oldNodeEnv,
				configurable: true,
			});
		});

		it("throws notFound for invalid entity type params", async () => {
			await expect(
				EntityTypePage({
					params: Promise.resolve({ entityType: "invalid" }),
					searchParams: Promise.resolve({}),
				}),
			).rejects.toThrow("NEXT_NOT_FOUND");
		});
	});
});
