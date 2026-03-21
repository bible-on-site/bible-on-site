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

jest.mock("../../../src/lib/tanahpedia/service", () => ({
	...jest.requireActual("../../../src/lib/tanahpedia/service"),
	getAllEntryUniqueNames: jest.fn(),
	getEntryByUniqueName: jest.fn(),
	getPersonFamilySummary: jest.fn().mockResolvedValue(null),
	ENTITY_TYPE_LABELS: {
		PERSON: "אישים",
		PLACE: "מקומות",
	},
}));

import {
	getAllEntryUniqueNames,
	getEntryByUniqueName,
} from "../../../src/lib/tanahpedia/service";
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
				{ uniqueName: encodeURIComponent("משה-רבנו") },
				{ uniqueName: encodeURIComponent("יהושע-בן-נון") },
				{ uniqueName: encodeURIComponent("דוד-המלך") },
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
		it("renders entry when found", async () => {
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
				params: Promise.resolve({ uniqueName: encodeURIComponent("משה-רבנו") }),
			});

			expect(result).toBeDefined();
		});
	});
});
