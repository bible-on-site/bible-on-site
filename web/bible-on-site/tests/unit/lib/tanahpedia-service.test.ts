jest.mock("../../../src/lib/api-client", () => ({
	query: jest.fn(),
}));

import { query } from "../../../src/lib/api-client";
import { getPersonFamilySummary } from "../../../src/lib/tanahpedia/service";

const mockQuery = query as jest.MockedFunction<typeof query>;

describe("tanahpedia service", () => {
	beforeEach(() => {
		jest.clearAllMocks();
	});

	it("returns null when an entity has no person row", async () => {
		mockQuery.mockResolvedValueOnce([]);

		await expect(getPersonFamilySummary("entity-x", "פלוני")).resolves.toBeNull();
		expect(mockQuery).toHaveBeenCalledTimes(1);
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
					siblingSourceCitation: "בראשית כה",
				},
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
		expect(result?.siblings).toEqual([
			expect.objectContaining({
				displayName: "עשו",
				birthDateYyyymmdd: 18000101,
				sourceCitation: "בראשית כה",
			}),
		]);
	});
});