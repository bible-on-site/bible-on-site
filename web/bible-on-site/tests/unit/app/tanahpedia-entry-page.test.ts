/**
 * Tests for the tanahpedia entry page's exported functions:
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

jest.mock("next/dynamic", () => ({
	__esModule: true,
	default:
		(
			_loader: () => Promise<unknown>,
			options?: { loading?: () => React.ReactNode },
		) =>
		() =>
			options?.loading ? options.loading() : null,
}));

jest.mock("../../../src/lib/tanahpedia/service", () => ({
	...jest.requireActual("../../../src/lib/tanahpedia/service"),
	getAllEntryUniqueNames: jest.fn(),
	getEntries: jest.fn(),
	getEntriesByEntityType: jest.fn(),
	getEntryByUniqueName: jest.fn(),
	getPersonFamilySummary: jest.fn().mockResolvedValue(null),
	getPlaceMapMarkersForEntry: jest.fn().mockResolvedValue([]),
	ENTITY_TYPE_LABELS: {
		PERSON: "אישים",
		PLACE: "מקומות",
	},
}));

import {
	getAllEntryUniqueNames,
	getEntries,
	getEntriesByEntityType,
	getEntryByUniqueName,
	getPersonFamilySummary,
	getPlaceMapMarkersForEntry,
} from "../../../src/lib/tanahpedia/service";
import { render, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import EntryPage, {
	generateMetadata,
	generateStaticParams,
} from "../../../src/app/tanahpedia/entry/[uniqueName]/page";

const mockGetAllEntryUniqueNames = getAllEntryUniqueNames as jest.MockedFunction<
	typeof getAllEntryUniqueNames
>;
const mockGetEntryByUniqueName = getEntryByUniqueName as jest.MockedFunction<
	typeof getEntryByUniqueName
>;
const mockGetEntries = getEntries as jest.MockedFunction<typeof getEntries>;
const mockGetEntriesByEntityType =
	getEntriesByEntityType as jest.MockedFunction<typeof getEntriesByEntityType>;
const mockGetPersonFamilySummary =
	getPersonFamilySummary as jest.MockedFunction<typeof getPersonFamilySummary>;
const mockGetPlaceMapMarkersForEntry =
	getPlaceMapMarkersForEntry as jest.MockedFunction<
		typeof getPlaceMapMarkersForEntry
	>;

describe("tanahpedia/entry/[uniqueName] page", () => {
	beforeEach(() => {
		jest.clearAllMocks();
	});

	describe("generateStaticParams", () => {
		it("returns all entry unique names as params", async () => {
			mockGetAllEntryUniqueNames.mockResolvedValue([
				"משה-רבנו",
				"יהושע-בן-נון",
				"דוד-המלך",
			]);

			const result = await generateStaticParams();

			expect(result).toEqual([
				{ uniqueName: "משה-רבנו" },
				{ uniqueName: "יהושע-בן-נון" },
				{ uniqueName: "דוד-המלך" },
			]);
		});

		it("returns empty array when database is unavailable", async () => {
			mockGetAllEntryUniqueNames.mockRejectedValue(
				new Error("Database connection failed"),
			);

			const result = await generateStaticParams();

			expect(result).toEqual([]);
		});

		it("returns empty array when no entries exist", async () => {
			mockGetAllEntryUniqueNames.mockResolvedValue([]);

			const result = await generateStaticParams();

			expect(result).toEqual([]);
		});
	});

	describe("generateMetadata", () => {
		it("returns entry title and description when found", async () => {
			mockGetEntryByUniqueName.mockResolvedValue({
				id: "entry-1",
				uniqueName: "משה-רבנו",
				title: "משה רבנו",
				content: "<p>תוכן הערך על משה רבנו</p>",
				createdAt: "2024-01-01T00:00:00Z",
				updatedAt: "2024-01-01T00:00:00Z",
				entities: [],
			});

			const result = await generateMetadata({
				params: Promise.resolve({ uniqueName: encodeURIComponent("משה-רבנו") }),
			});

			expect(result).toEqual({
				title: "משה רבנו | תנכפדיה",
				description: "תוכן הערך על משה רבנו",
			});
		});

		it("returns title only when content is empty", async () => {
			mockGetEntryByUniqueName.mockResolvedValue({
				id: "entry-1",
				uniqueName: "משה-רבנו",
				title: "משה רבנו",
				content: null,
				createdAt: "2024-01-01T00:00:00Z",
				updatedAt: "2024-01-01T00:00:00Z",
				entities: [],
			});

			const result = await generateMetadata({
				params: Promise.resolve({ uniqueName: encodeURIComponent("משה-רבנו") }),
			});

			expect(result).toEqual({
				title: "משה רבנו | תנכפדיה",
				description: "משה רבנו",
			});
		});

		it("returns not found when entry does not exist", async () => {
			mockGetEntryByUniqueName.mockResolvedValue(null);

			const result = await generateMetadata({
				params: Promise.resolve({ uniqueName: "nonexistent" }),
			});

			expect(result).toEqual({
				title: "לא נמצא",
			});
		});

		it("resolves percent-encoded uniqueName param like the browser sends", async () => {
			mockGetEntryByUniqueName.mockResolvedValue({
				id: "entry-s",
				uniqueName: "שמשון",
				title: "שמשון",
				content: "<p>נזיר</p>",
				createdAt: "2024-01-01T00:00:00Z",
				updatedAt: "2024-01-01T00:00:00Z",
				entities: [],
			});

			const encoded = encodeURIComponent("שמשון");
			const result = await generateMetadata({
				params: Promise.resolve({ uniqueName: encoded }),
			});

			expect(mockGetEntryByUniqueName).toHaveBeenCalledWith("שמשון");
			expect(result).toEqual({
				title: "שמשון | תנכפדיה",
				description: "נזיר",
			});
		});

		it("returns not found when database query fails", async () => {
			mockGetEntryByUniqueName.mockRejectedValue(
				new Error("Database error"),
			);

			const result = await generateMetadata({
				params: Promise.resolve({ uniqueName: "test" }),
			});

			expect(result).toEqual({
				title: "לא נמצא",
			});
		});
	});

	describe("EntryPage", () => {
		afterEach(() => {
			jest.restoreAllMocks();
		});

		it("renders entry when found", async () => {
			const consoleError = jest.spyOn(console, "error").mockImplementation();
			mockGetEntriesByEntityType.mockResolvedValue([
				{
					id: "entry-1",
					uniqueName: "\u05de\u05e9\u05d4-\u05e8\u05d1\u05e0\u05d5",
					title: "\u05de\u05e9\u05d4 \u05e8\u05d1\u05e0\u05d5",
					content: null,
					createdAt: "2024-01-01T00:00:00Z",
					updatedAt: "2024-01-01T00:00:00Z",
				},
			]);
			mockGetPersonFamilySummary.mockRejectedValue(new Error("family down"));
			mockGetPlaceMapMarkersForEntry.mockResolvedValue([]);
			mockGetEntryByUniqueName.mockResolvedValue({
				id: "entry-1",
				uniqueName: "משה-רבנו",
				title: "משה רבנו",
				content: "<p>תוכן הערך</p>",
				createdAt: "2024-01-01T00:00:00Z",
				updatedAt: "2024-01-01T00:00:00Z",
				entities: [
					{
						id: "ee-1",
						entryId: "entry-1",
						entityId: "entity-1",
						entityType: "PERSON",
						entityName: "משה רבנו",
					},
				],
			});

			const result = await EntryPage({
				params: Promise.resolve({ uniqueName: "משה-רבנו" }),
			});

			render(result as ReactElement);
			expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
				"\u05de\u05e9\u05d4 \u05e8\u05d1\u05e0\u05d5",
			);
			expect(
				screen.getByText("\u05ea\u05d5\u05db\u05df \u05d4\u05e2\u05e8\u05da"),
			).toBeInTheDocument();
			expect(mockGetEntriesByEntityType).toHaveBeenCalledWith("PERSON");
			expect(mockGetPersonFamilySummary).toHaveBeenCalledWith(
				"entity-1",
				"\u05de\u05e9\u05d4 \u05e8\u05d1\u05e0\u05d5",
			);
			expect(consoleError).toHaveBeenCalledWith(
				"[tanahpedia] person family load failed",
				{
					uniqueName: "משה-רבנו",
					entityId: "entity-1",
				},
				expect.any(Error),
			);
			expect((consoleError.mock.calls[0][2] as Error).message).toBe(
				"family down",
			);
		});

		it("renders empty content and sibling fallback when entry has no entities", async () => {
			mockGetEntries.mockResolvedValue([
				{
					id: "entry-sibling",
					uniqueName: "sibling",
					title: "Sibling",
					content: null,
					createdAt: "2024-01-01T00:00:00Z",
					updatedAt: "2024-01-01T00:00:00Z",
				},
			]);
			mockGetEntryByUniqueName.mockResolvedValue({
				id: "entry-2",
				uniqueName: "empty",
				title: "Empty Entry",
				content: null,
				createdAt: "2024-01-01T00:00:00Z",
				updatedAt: "2024-01-01T00:00:00Z",
				entities: [],
			});

			const result = await EntryPage({
				params: Promise.resolve({ uniqueName: "empty" }),
			});

			render(result as ReactElement);
			expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
				"Empty Entry",
			);
			expect(
				screen.getByText(/\u05d0\u05d9\u05df \u05ea\u05d5\u05db\u05df \u05e2\u05d3\u05d9\u05d9\u05df/),
			).toBeInTheDocument();
			expect(mockGetEntries).toHaveBeenCalledWith(500, 0);
		});

		it("continues rendering when fallback sibling loading fails", async () => {
			mockGetEntries.mockRejectedValue(new Error("siblings down"));
			mockGetPlaceMapMarkersForEntry.mockResolvedValue([]);
			mockGetEntryByUniqueName.mockResolvedValue({
				id: "entry-no-siblings",
				uniqueName: "no-siblings",
				title: "No Siblings",
				content: null,
				createdAt: "2024-01-01T00:00:00Z",
				updatedAt: "2024-01-01T00:00:00Z",
				entities: [],
			});

			const result = await EntryPage({
				params: Promise.resolve({ uniqueName: "no-siblings" }),
			});

			render(result as ReactElement);
			expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
				"No Siblings",
			);
			expect(mockGetEntries).toHaveBeenCalledWith(500, 0);
		});

		it("renders place maps and person family sections when available", async () => {
			mockGetEntriesByEntityType.mockResolvedValue([]);
			mockGetPersonFamilySummary.mockResolvedValue({
				focalPersonId: "person-1",
				focalEntityId: "person-entity",
				focalDisplayName: "\u05d3\u05de\u05d5\u05ea",
				focalSex: "MALE",
				focalBirthYyyymmdd: null,
				parents: [],
				children: [
					{
						related: {
							personId: "child-person",
							entityId: "child-entity",
							displayName: "\u05d9\u05dc\u05d3",
							entryUniqueName: null,
							entryTitle: null,
							sex: "MALE",
						},
						parentRole: "FATHER",
						relationshipType: "BIOLOGICAL",
						altGroupId: null,
						sourceCitation: null,
						coParentEntityId: null,
						coParentDisplayName: null,
						coParentUnionOrder: null,
					},
				],
				spouses: [],
				siblings: [],
			});
			mockGetPlaceMapMarkersForEntry.mockResolvedValue([
				{
					placeId: "place-1",
					placeName: "Jerusalem",
					modernName: null,
					lat: 31.778,
					lng: 35.235,
					entryUniqueName: "jerusalem",
				},
			]);
			mockGetEntryByUniqueName.mockResolvedValue({
				id: "entry-map-family",
				uniqueName: "map-family",
				title: "Map Family",
				content: "<p>Body</p>",
				createdAt: "2024-01-01T00:00:00Z",
				updatedAt: "2024-01-01T00:00:00Z",
				entities: [
					{
						id: "ee-place",
						entryId: "entry-map-family",
						entityId: "place-1",
						entityType: "PLACE",
						entityName: "Jerusalem",
					},
					{
						id: "ee-person",
						entryId: "entry-map-family",
						entityId: "person-entity",
						entityType: "PERSON",
						entityName: "\u05d3\u05de\u05d5\u05ea",
					},
				],
			});

			const result = await EntryPage({
				params: Promise.resolve({ uniqueName: "map-family" }),
			});

			render(result as ReactElement);
			expect(screen.getByRole("heading", { level: 2, name: "\u05de\u05e4\u05d4" })).toBeInTheDocument();
			expect(screen.getByText(/docs\/tanahpedia\/places-map-plan\.md/)).toBeInTheDocument();
			expect(screen.getByText("\u05de\u05e9\u05e4\u05d7\u05d4")).toBeInTheDocument();
			expect(mockGetEntriesByEntityType).toHaveBeenCalledWith("PLACE");
			expect(mockGetPersonFamilySummary).toHaveBeenCalledWith(
				"person-entity",
				"\u05d3\u05de\u05d5\u05ea",
			);
			expect(mockGetPlaceMapMarkersForEntry).toHaveBeenCalledWith(
				"entry-map-family",
			);
		});
	});
});
