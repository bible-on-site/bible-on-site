jest.mock("../../../src/lib/api-client", () => ({
	query: jest.fn(),
}));

import { query } from "../../../src/lib/api-client";
import {
	ENTITY_TYPES,
	get3DModels,
	getAllEntityTypeParams,
	getAllEntryUniqueNames,
	getAnimalsByClassification,
	getCategoryCounts,
	getCategoryHomepage,
	getEntitiesWithEntries,
	getEntitiesWithEntriesByRole,
	getEntries,
	getEntriesByEntityType,
	getEntryByUniqueName,
	getEntityReferencesForPerek,
	getPersonFamilySummary,
	getPlaceIdentifications,
	getPlaceMapMarkers,
	getPlaceMapMarkersForEntry,
	getRecentEntries,
	getTodayInTanahEvents,
} from "../../../src/lib/tanahpedia/service";

const mockQuery = query as jest.MockedFunction<typeof query>;

describe("tanahpedia service", () => {
	beforeEach(() => {
		jest.clearAllMocks();
	});

	it("queries entries with default and explicit pagination", async () => {
		mockQuery.mockResolvedValueOnce([{ id: "entry-1", title: "אברהם" }]);

		await expect(getEntries()).resolves.toEqual([
			{ id: "entry-1", title: "אברהם" },
		]);
		expect(mockQuery).toHaveBeenLastCalledWith(expect.any(String), ["50", "0"]);

		mockQuery.mockResolvedValueOnce([]);
		await expect(getEntries(5, 10)).resolves.toEqual([]);
		expect(mockQuery).toHaveBeenLastCalledWith(expect.any(String), ["5", "10"]);
	});

	it("returns an entry with linked entities by unique name", async () => {
		mockQuery
			.mockResolvedValueOnce([
				{
					id: "entry-abraham",
					uniqueName: "אברהם",
					title: "אברהם",
					content: "content",
					createdAt: "2026-01-01",
					updatedAt: "2026-01-02",
				},
			])
			.mockResolvedValueOnce([
				{
					id: "link-1",
					entryId: "entry-abraham",
					entityId: "entity-abraham",
					entityType: "PERSON",
					entityName: "אברהם",
				},
			]);

		await expect(getEntryByUniqueName("אברהם")).resolves.toMatchObject({
			id: "entry-abraham",
			entities: [
				{
					entryId: "entry-abraham",
					entityName: "אברהם",
					entityType: "PERSON",
				},
			],
		});
	});

	it("returns null when a unique entry name is not found", async () => {
		mockQuery.mockResolvedValueOnce([]);

		await expect(getEntryByUniqueName("missing")).resolves.toBeNull();
		expect(mockQuery).toHaveBeenCalledTimes(1);
	});

	it("queries entries by entity type", async () => {
		mockQuery.mockResolvedValueOnce([{ id: "entry-place", title: "ירושלים" }]);

		await expect(getEntriesByEntityType("PLACE")).resolves.toEqual([
			{ id: "entry-place", title: "ירושלים" },
		]);
		expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining("WHERE e.entity_type = ?"), [
			"PLACE",
		]);
	});

	it("returns null when an entity has no person row", async () => {
		mockQuery.mockResolvedValueOnce([]);

		await expect(getPersonFamilySummary("entity-x", "פלוני")).resolves.toBeNull();
		expect(mockQuery).toHaveBeenCalledTimes(1);
	});

	it("groups entities with their linked entries", async () => {
		mockQuery.mockResolvedValueOnce([
			{
				entityId: "entity-place-1",
				entityName: "ירושלים",
				entryId: "entry-jerusalem",
				entryUniqueName: "ירושלים",
				entryTitle: "ירושלים",
			},
			{
				entityId: "entity-place-1",
				entityName: "ירושלים",
				entryId: "entry-zion",
				entryUniqueName: "ציון",
				entryTitle: "ציון",
			},
			{
				entityId: "entity-place-2",
				entityName: "בית אל",
				entryId: null,
				entryUniqueName: null,
				entryTitle: null,
			},
		]);

		await expect(getEntitiesWithEntries("PLACE")).resolves.toEqual([
			{
				entityType: "PLACE",
				entityId: "entity-place-1",
				entityName: "ירושלים",
				linkedEntries: [
					{
						id: "entry-jerusalem",
						uniqueName: "ירושלים",
						title: "ירושלים",
					},
					{
						id: "entry-zion",
						uniqueName: "ציון",
						title: "ציון",
					},
				],
			},
			{
				entityType: "PLACE",
				entityId: "entity-place-2",
				entityName: "בית אל",
				linkedEntries: [],
			},
		]);
		expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining("WHERE e.entity_type = ?"), [
			"PLACE",
		]);
	});

	it.each([
		["PROPHET" as const, "tanahpedia_person_role_prophet"],
		["KING" as const, "tanahpedia_person_role_king"],
	])("groups person entities by %s role", async (role, roleTable) => {
		mockQuery.mockResolvedValueOnce([
			{
				entityId: "entity-person",
				entityName: "משה",
				entryId: "entry-moses",
				entryUniqueName: "משה",
				entryTitle: "משה",
			},
		]);

		await expect(getEntitiesWithEntriesByRole(role)).resolves.toEqual([
			{
				entityType: "PERSON",
				entityId: "entity-person",
				entityName: "משה",
				linkedEntries: [
					{
						id: "entry-moses",
						uniqueName: "משה",
						title: "משה",
					},
				],
			},
		]);
		expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining(roleTable));
	});

	it.each([
		["kind" as const, "BEHEMA", "tanahpedia_animal_kind", "kind"],
		["purity" as const, "TAHOR", "tanahpedia_animal_purity", "purity"],
	])(
		"groups animal entities by %s classification",
		async (classType, value, table, column) => {
			mockQuery.mockResolvedValueOnce([
				{
					entityId: "entity-animal",
					entityName: "שור",
					entryId: "entry-ox",
					entryUniqueName: "שור",
					entryTitle: "שור",
				},
				{
					entityId: "entity-animal-empty",
					entityName: "ראם",
					entryId: null,
					entryUniqueName: null,
					entryTitle: null,
				},
			]);

			await expect(getAnimalsByClassification(classType, value)).resolves.toEqual([
				{
					entityType: "ANIMAL",
					entityId: "entity-animal",
					entityName: "שור",
					linkedEntries: [{ id: "entry-ox", uniqueName: "שור", title: "שור" }],
				},
				{
					entityType: "ANIMAL",
					entityId: "entity-animal-empty",
					entityName: "ראם",
					linkedEntries: [],
				},
			]);
			expect(mockQuery).toHaveBeenCalledWith(
				expect.stringContaining(`FROM ${table} ac`),
				[value],
			);
			expect(mockQuery).toHaveBeenCalledWith(
				expect.stringContaining(`WHERE ac.${column} = ?`),
				[value],
			);
		},
	);

	it("parses category homepage JSON config and returns null for missing rows", async () => {
		mockQuery
			.mockResolvedValueOnce([
				{
					id: "homepage-place",
					entityType: "PLACE",
					layoutType: "featured",
					config: '{"featured":["ירושלים"]}',
					content: "content",
					updatedAt: "2026-01-01",
				},
			])
			.mockResolvedValueOnce([]);

		await expect(getCategoryHomepage("PLACE")).resolves.toMatchObject({
			id: "homepage-place",
			config: { featured: ["ירושלים"] },
		});
		await expect(getCategoryHomepage("EVENT")).resolves.toBeNull();
	});

	it("returns category homepage object config as-is", async () => {
		mockQuery.mockResolvedValueOnce([
			{
				id: "homepage-person",
				entityType: "PERSON",
				layoutType: "standard",
				config: { hero: "משה" },
				content: "content",
				updatedAt: "2026-01-01",
			},
		]);

		await expect(getCategoryHomepage("PERSON")).resolves.toMatchObject({
			config: { hero: "משה" },
		});
	});

	it("queries 3D models and place identifications", async () => {
		mockQuery
			.mockResolvedValueOnce([{ id: "model-1", entityId: "entity-tool" }])
			.mockResolvedValueOnce([{ id: "place-identification-1", placeName: "שילה" }]);

		await expect(get3DModels("entity-tool")).resolves.toEqual([
			{ id: "model-1", entityId: "entity-tool" },
		]);
		expect(mockQuery).toHaveBeenLastCalledWith(expect.any(String), [
			"entity-tool",
		]);

		await expect(getPlaceIdentifications()).resolves.toEqual([
			{ id: "place-identification-1", placeName: "שילה" },
		]);
	});

	it("maps valid place markers and skips invalid coordinates", async () => {
		mockQuery.mockResolvedValueOnce([
			{
				placeId: "place-1",
				placeName: "ירושלים",
				modernName: "Jerusalem",
				latitude: "31.778",
				longitude: 35.235,
				entryUniqueName: "ירושלים",
			},
			{
				placeId: "place-2",
				placeName: "לא תקין",
				modernName: null,
				latitude: "north",
				longitude: "35.0",
				entryUniqueName: null,
			},
		]);

		await expect(getPlaceMapMarkers()).resolves.toEqual([
			{
				placeId: "place-1",
				placeName: "ירושלים",
				modernName: "Jerusalem",
				lat: 31.778,
				lng: 35.235,
				entryUniqueName: "ירושלים",
			},
		]);
	});

	it("maps place markers linked to one entry", async () => {
		mockQuery.mockResolvedValueOnce([
			{
				placeId: "place-entry-1",
				placeName: "בית אל",
				modernName: null,
				latitude: "31.93",
				longitude: "35.22",
				entryUniqueName: "יעקב",
			},
			{
				placeId: "place-entry-2",
				placeName: "לא תקין",
				modernName: null,
				latitude: null,
				longitude: "35.22",
				entryUniqueName: "יעקב",
			},
		]);

		await expect(getPlaceMapMarkersForEntry("entry-jacob")).resolves.toEqual([
			{
				placeId: "place-entry-1",
				placeName: "בית אל",
				modernName: null,
				lat: 31.93,
				lng: 35.22,
				entryUniqueName: "יעקב",
			},
		]);
		expect(mockQuery).toHaveBeenCalledWith(expect.any(String), ["entry-jacob"]);
	});

	it("combines category counts and falls back to place row count", async () => {
		mockQuery
			.mockResolvedValueOnce([
				{ entityType: "PERSON", cnt: "7" },
				{ entityType: "PLACE", cnt: 0 },
			])
			.mockResolvedValueOnce([
				{ role: "PROPHET", cnt: "3" },
				{ role: "KING", cnt: 2 },
			])
			.mockResolvedValueOnce([
				{ cat: "BEHEMA", cnt: "4" },
				{ cat: "TAHOR", cnt: 5 },
			])
			.mockResolvedValueOnce([{ c: "6" }]);

		await expect(getCategoryCounts()).resolves.toMatchObject({
			PERSON: 7,
			PLACE: 6,
			PROPHET: 3,
			KING: 2,
			BEHEMA: 4,
			TAHOR: 5,
			EVENT: 0,
		});
	});

	it("keeps linked place counts when they already exist", async () => {
		mockQuery
			.mockResolvedValueOnce([{ entityType: "PLACE", cnt: "9" }])
			.mockResolvedValueOnce([])
			.mockResolvedValueOnce([])
			.mockResolvedValueOnce([{ c: "6" }]);

		await expect(getCategoryCounts()).resolves.toMatchObject({ PLACE: 9 });
	});

	it("queries recent entries and all unique names", async () => {
		mockQuery
			.mockResolvedValueOnce([{ id: "entry-recent", title: "recent" }])
			.mockResolvedValueOnce([])
			.mockResolvedValueOnce([
				{ uniqueName: "אברהם" },
				{ uniqueName: "שרה" },
			]);

		await expect(getRecentEntries(2)).resolves.toEqual([
			{ id: "entry-recent", title: "recent" },
		]);
		expect(mockQuery).toHaveBeenLastCalledWith(expect.any(String), ["2"]);
		await expect(getRecentEntries()).resolves.toEqual([]);
		expect(mockQuery).toHaveBeenLastCalledWith(expect.any(String), ["10"]);

		await expect(getAllEntryUniqueNames()).resolves.toEqual(["אברהם", "שרה"]);
	});

	it("normalizes invalid focal birth dates when family rows exist", async () => {
		mockQuery
			.mockResolvedValueOnce([{ personId: "person-focal" }])
			.mockResolvedValueOnce([])
			.mockResolvedValueOnce([
				{
					altGroupId: null,
					parentRole: "FATHER",
					relationshipType: "BIOLOGICAL",
					sourceCitation: null,
					relatedPersonId: "person-parent",
					relatedEntityId: "entity-parent",
					displayName: "אב",
					entryUniqueName: null,
					entryTitle: null,
					relatedSex: null,
				},
			])
			.mockResolvedValueOnce([])
			.mockResolvedValueOnce([])
			.mockResolvedValueOnce([])
			.mockResolvedValueOnce([{ focalBirthDate: "not-a-date" }]);

		await expect(getPersonFamilySummary("entity-focal", "מוקד")).resolves.toMatchObject({
			focalBirthYyyymmdd: null,
			parents: [
				expect.objectContaining({
					related: expect.objectContaining({ displayName: "אב" }),
				}),
			],
		});
	});

	it("returns lowercase entity type params", async () => {
		await expect(getAllEntityTypeParams()).resolves.toEqual(
			ENTITY_TYPES.map((entityType) => ({
				entityType: entityType.toLowerCase(),
			})),
		);
	});

	it("queries today's Tanah events by Hebrew month and day", async () => {
		mockQuery.mockResolvedValueOnce([{ entityId: "event-1", startDate: 701 }]);

		await expect(getTodayInTanahEvents(7, 1)).resolves.toEqual([
			{ entityId: "event-1", startDate: 701 },
		]);
		expect(mockQuery).toHaveBeenCalledWith(expect.any(String), ["701"]);
	});

	it("returns entity references for a perek", async () => {
		mockQuery.mockResolvedValueOnce([
			{
				entityId: "entity-1",
				entityName: "משה",
				entityType: "PERSON",
				entryUniqueName: "משה",
				pasukNumber: 1,
				segmentStart: 0,
				segmentEnd: 3,
			},
		]);

		await expect(getEntityReferencesForPerek(12)).resolves.toEqual([
			{
				entityId: "entity-1",
				entityName: "משה",
				entityType: "PERSON",
				entryUniqueName: "משה",
				pasukNumber: 1,
				segmentStart: 0,
				segmentEnd: 3,
			},
		]);
		expect(mockQuery).toHaveBeenCalledWith(expect.any(String), ["12"]);
	});

	it("logs and returns no entity references when the perek query fails", async () => {
		const consoleErrorSpy = jest
			.spyOn(console, "error")
			.mockImplementation(() => undefined);
		mockQuery.mockRejectedValueOnce(new Error("database unavailable"));

		await expect(getEntityReferencesForPerek(99)).resolves.toEqual([]);
		expect(consoleErrorSpy).toHaveBeenCalledWith(
			"Failed to fetch entity references for perek 99:",
			"database unavailable",
		);

		consoleErrorSpy.mockRestore();
	});

	it("returns null when a person has no family rows", async () => {
		mockQuery
			.mockResolvedValueOnce([{ personId: "person-lone" }])
			.mockResolvedValueOnce([])
			.mockResolvedValueOnce([])
			.mockResolvedValueOnce([])
			.mockResolvedValueOnce([])
			.mockResolvedValueOnce([])
			.mockResolvedValueOnce([{ focalBirthDate: "" }]);

		await expect(getPersonFamilySummary("entity-lone", "יחיד")).resolves.toBeNull();
	});

	it("maps family rows with sex, co-parent, sibling chronology, and focal birth", async () => {
		mockQuery
			.mockResolvedValueOnce([{ personId: "person-focal" }])
			.mockResolvedValueOnce([{ sex: "MALE" }])
			.mockResolvedValueOnce([
				{
					altGroupId: null,
					parentRole: "FATHER",
					relationshipType: "BIOLOGICAL",
					sourceCitation: "בראשית כח",
					relatedPersonId: "p-father",
					relatedEntityId: "e-father",
					displayName: "יצחק",
					entryUniqueName: "יצחק",
					entryTitle: "יצחק",
					relatedSex: "MALE",
				},
			])
			.mockResolvedValueOnce([
				{
					altGroupId: null,
					parentRole: "FATHER",
					relationshipType: "BIOLOGICAL",
					sourceCitation: "בראשית לה כב",
					relatedPersonId: "p-reuven",
					relatedEntityId: "e-reuven",
					displayName: "ראובן",
					entryUniqueName: "ראובן",
					entryTitle: "ראובן",
					relatedSex: "MALE",
					coParentEntityId: null,
					coParentDisplayName: null,
					coParentUnionOrder: null,
				},
				{
					altGroupId: null,
					parentRole: "FATHER",
					relationshipType: "BIOLOGICAL",
					sourceCitation: "duplicate without co-parent",
					relatedPersonId: "p-yosef",
					relatedEntityId: "e-yosef",
					displayName: "יוסף",
					entryUniqueName: "יוסף",
					entryTitle: "יוסף",
					relatedSex: "MALE",
					coParentEntityId: null,
					coParentDisplayName: null,
					coParentUnionOrder: null,
				},
				{
					altGroupId: null,
					parentRole: "FATHER",
					relationshipType: "BIOLOGICAL",
					sourceCitation: "בראשית לה כד",
					relatedPersonId: "p-yosef",
					relatedEntityId: "e-yosef",
					displayName: "יוסף",
					entryUniqueName: "יוסף",
					entryTitle: "יוסף",
					relatedSex: "MALE",
					coParentEntityId: "e-rachel",
					coParentDisplayName: "רחל",
					coParentUnionOrder: "2",
				},
			])
			.mockResolvedValueOnce([
				{
					altGroupId: null,
					unionType: "MARRIAGE",
					unionOrder: 2,
					sourceCitation: "בראשית כט",
					unionEndReason: null,
					unionStartDate: "19000101",
					unionEndDate: null,
					relatedPersonId: "p-rachel",
					relatedEntityId: "e-rachel",
					displayName: "רחל",
					entryUniqueName: "רחל",
					entryTitle: "רחל",
					relatedSex: "FEMALE",
				},
			])
			.mockResolvedValueOnce([
				{
					relatedPersonId: "p-esav",
					relatedEntityId: "e-esav",
					displayName: "עשו",
					entryUniqueName: "עשו",
					entryTitle: "עשו",
					relatedSex: "MALE",
					relatedBirthDate: "18000101",
					siblingSourceCitation: null,
				},
				{
					relatedPersonId: "p-esav",
					relatedEntityId: "e-esav",
					displayName: "עשו",
					entryUniqueName: "עשו",
					entryTitle: "עשו",
					relatedSex: "MALE",
					relatedBirthDate: "18000101",
					siblingSourceCitation: "בראשית כה",
				},
				{
					relatedPersonId: "p-binyamin",
					relatedEntityId: "e-binyamin",
					displayName: "בנימין",
					entryUniqueName: "בנימין",
					entryTitle: "בנימין",
					relatedSex: "MALE",
					relatedBirthDate: null,
					siblingSourceCitation: " ",
				},
			])
			.mockResolvedValueOnce([{ focalBirthDate: "18000102" }]);

		const result = await getPersonFamilySummary("entity-jacob", "יעקב");

		expect(result).toMatchObject({
			focalPersonId: "person-focal",
			focalEntityId: "entity-jacob",
			focalDisplayName: "יעקב",
			focalSex: "MALE",
			focalBirthYyyymmdd: 18000102,
		});
		expect(result?.parents[0]).toMatchObject({
			parentRole: "FATHER",
			related: { displayName: "יצחק", sex: "MALE" },
		});
		expect(result?.children).toHaveLength(2);
		expect(result?.children.find((c) => c.related.displayName === "יוסף")).toMatchObject({
			coParentEntityId: "e-rachel",
			coParentDisplayName: "רחל",
			coParentUnionOrder: 2,
		});
		expect(result?.spouses[0]).toMatchObject({
			unionOrder: 2,
			related: { displayName: "רחל", sex: "FEMALE" },
		});
		expect(result?.siblings).toHaveLength(2);
		expect(result?.siblings).toEqual(expect.arrayContaining([
			expect.objectContaining({
				displayName: "עשו",
				birthDateYyyymmdd: 18000101,
				sourceCitation: "בראשית כה",
			}),
			expect.objectContaining({
				displayName: "בנימין",
				birthDateYyyymmdd: null,
			}),
		]));
	});
});