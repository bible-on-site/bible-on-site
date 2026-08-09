import { SITE_ORIGIN } from "../../../../src/lib/seo/jsonld";
import {
	buildCategoryGraph,
	buildEntryGraph,
	buildLandingGraph,
	categoryPath,
	entityRefId,
	entityTypeToSchemaType,
	entryPath,
	plainText,
	TANAHPEDIA_PATH,
	TANAHPEDIA_SET_ID,
} from "../../../../src/lib/seo/tanahpedia-jsonld";
import type {
	EntityType,
	EntryWithEntities,
	PersonFamilySummary,
	PlaceMapMarker,
} from "../../../../src/lib/tanahpedia/types";

function entry(over: Partial<EntryWithEntities> = {}): EntryWithEntities {
	return {
		id: "entry-1",
		uniqueName: "אברהם",
		title: "אברהם אבינו",
		content: "<p>אברהם היה הראשון שהכיר את בוראו.</p>",
		createdAt: "2026-01-01 10:00:00",
		updatedAt: "2026-02-02 12:00:00",
		entities: [
			{
				id: "ee-1",
				entryId: "entry-1",
				entityId: "ent-avraham",
				entityType: "PERSON",
				entityName: "אברהם",
			},
		],
		...over,
	};
}

type NodeMap = Record<string, unknown> & { "@type": string; "@id"?: string };

function nodesOf(graph: ReturnType<typeof buildEntryGraph>): NodeMap[] {
	return graph["@graph"] as unknown as NodeMap[];
}

function nodeByType(graph: ReturnType<typeof buildEntryGraph>, type: string) {
	return nodesOf(graph).find((n) => n["@type"] === type);
}

describe("seo/tanahpedia-jsonld", () => {
	describe("entityTypeToSchemaType", () => {
		it("maps precise kinds and falls back to Thing", () => {
			expect(entityTypeToSchemaType("PERSON")).toBe("Person");
			expect(entityTypeToSchemaType("PLACE")).toBe("Place");
			expect(entityTypeToSchemaType("EVENT")).toBe("Event");
			expect(entityTypeToSchemaType("WAR")).toBe("Event");
			expect(entityTypeToSchemaType("SEFER")).toBe("Book");
			expect(entityTypeToSchemaType("TANAH_SEFER")).toBe("Book");
			expect(entityTypeToSchemaType("ANIMAL")).toBe("Thing");
			expect(entityTypeToSchemaType("NATION")).toBe("Thing");
		});

		it("falls back to Thing for an unmapped entity type", () => {
			expect(entityTypeToSchemaType("MYSTERY" as unknown as EntityType)).toBe(
				"Thing",
			);
		});
	});

	describe("entryPath / categoryPath", () => {
		it("URL-encodes the unique name and lowercases the category", () => {
			expect(entryPath("אברהם")).toBe(`/pedia/${encodeURIComponent("אברהם")}`);
			expect(categoryPath("PERSON")).toBe("/pedia/אישים");
		});
	});

	describe("entityRefId", () => {
		it("anchors to the entry page when an entry exists", () => {
			expect(entityRefId("ent-x", "יצחק")).toBe(
				`${SITE_ORIGIN}${entryPath("יצחק")}#entity`,
			);
		});

		it("uses a stable urn when there is no entry", () => {
			expect(entityRefId("ent-x", null)).toBe("urn:tanahpedia:entity:ent-x");
		});
	});

	describe("plainText", () => {
		it("strips tags, collapses whitespace, and truncates", () => {
			expect(plainText("<p>a   b</p>", 100)).toBe("a b");
			expect(plainText("<b>abcdef</b>", 3)).toBe("abc");
		});

		it("removes an unterminated tag with no closing bracket", () => {
			expect(plainText("safe<script", 100)).toBe("safe");
			expect(plainText("a<img src=x b", 100)).toBe("a");
		});
	});

	describe("buildEntryGraph", () => {
		const baseInput = () => ({
			entry: entry(),
			personFamily: null as PersonFamilySummary | null,
			placeMarkers: [] as PlaceMapMarker[],
			category: { label: "אישים", entityType: "PERSON" as const },
		});

		it("emits WebPage, BreadcrumbList, and DefinedTerm nodes", () => {
			const graph = buildEntryGraph(baseInput());
			expect(graph["@context"]).toBe("https://schema.org");
			expect(nodeByType(graph, "WebPage")).toBeDefined();
			expect(nodeByType(graph, "BreadcrumbList")).toBeDefined();
			const term = nodeByType(graph, "DefinedTerm");
			expect(term).toBeDefined();
			expect(term?.inDefinedTermSet).toEqual({ "@id": TANAHPEDIA_SET_ID });
		});

		it("links the WebPage to the entity and the term, with a modified date", () => {
			const graph = buildEntryGraph(baseInput());
			const page = nodeByType(graph, "WebPage");
			const entityId = `${SITE_ORIGIN}${entryPath("אברהם")}#entity`;
			expect(page?.about).toEqual({ "@id": entityId });
			expect(page?.mainEntity).toEqual({
				"@id": `${SITE_ORIGIN}${entryPath("אברהם")}#term`,
			});
			expect(page?.dateModified).toBe(
				new Date("2026-02-02 12:00:00").toISOString(),
			);
			expect(page?.inLanguage).toBe("he");
		});

		it("includes the category crumb between Tanahpedia and the entry", () => {
			const graph = buildEntryGraph(baseInput());
			const crumb = nodeByType(graph, "BreadcrumbList");
			const items = crumb?.itemListElement as Array<{
				position: number;
				name: string;
			}>;
			expect(items.map((i) => i.name)).toEqual([
				"בית",
				"תנכפדיה",
				"אישים",
				"אברהם אבינו",
			]);
		});

		it("gates the description on visible content", () => {
			const withContent = buildEntryGraph(baseInput());
			expect(nodeByType(withContent, "DefinedTerm")?.description).toContain(
				"אברהם",
			);
			const empty = buildEntryGraph({
				...baseInput(),
				entry: entry({ content: "<p></p>" }),
			});
			expect(nodeByType(empty, "DefinedTerm")?.description).toBeUndefined();
		});

		it("attaches family relations and gender to the focal person", () => {
			const family: PersonFamilySummary = {
				focalPersonId: "p-avraham",
				focalEntityId: "ent-avraham",
				focalDisplayName: "אברהם",
				focalSex: "MALE",
				focalBirthYyyymmdd: null,
				parents: [
					{
						related: {
							personId: "p-terach",
							entityId: "ent-terach",
							displayName: "תרח",
							entryUniqueName: null,
							entryTitle: null,
							sex: "MALE",
						},
						parentRole: "אב",
						relationshipType: "ביולוגי",
						altGroupId: null,
						sourceCitation: null,
					},
				],
				children: [
					{
						related: {
							personId: "p-yitzhak",
							entityId: "ent-yitzhak",
							displayName: "יצחק",
							entryUniqueName: "יצחק",
							entryTitle: "יצחק אבינו",
							sex: "MALE",
						},
						parentRole: "אב",
						relationshipType: "ביולוגי",
						altGroupId: null,
						sourceCitation: null,
						coParentEntityId: null,
						coParentDisplayName: null,
						coParentUnionOrder: null,
					},
				],
				spouses: [
					{
						related: {
							personId: "p-sara",
							entityId: "ent-sara",
							displayName: "שרה",
							entryUniqueName: "שרה",
							entryTitle: "שרה אמנו",
							sex: "FEMALE",
						},
						unionType: "MARRIAGE",
						unionOrder: 1,
						altGroupId: null,
						sourceCitation: null,
						personSourceCitation: null,
						unionEndReason: null,
						unionStartDate: null,
						unionEndDate: null,
					},
				],
				siblings: [],
			};
			const graph = buildEntryGraph({ ...baseInput(), personFamily: family });
			const person = nodesOf(graph).find(
				(n) =>
					n["@type"] === "Person" &&
					n["@id"] === `${SITE_ORIGIN}${entryPath("אברהם")}#entity`,
			);
			expect(person?.gender).toBe("Male");
			expect(person?.parent).toEqual([
				{ "@id": "urn:tanahpedia:entity:ent-terach" },
			]);
			expect(person?.children).toEqual([
				{ "@id": `${SITE_ORIGIN}${entryPath("יצחק")}#entity` },
			]);
			expect(person?.spouse).toEqual([
				{ "@id": `${SITE_ORIGIN}${entryPath("שרה")}#entity` },
			]);

			// A related person without an entry becomes a lightweight urn node.
			const terach = nodesOf(graph).find(
				(n) => n["@id"] === "urn:tanahpedia:entity:ent-terach",
			);
			expect(terach).toMatchObject({ "@type": "Person", name: "תרח" });
		});

		it("adds geo to a PLACE entity from matching markers", () => {
			const placeEntry = entry({
				uniqueName: "חברון",
				title: "חברון",
				content: "<p></p>",
				entities: [
					{
						id: "ee-p",
						entryId: "entry-1",
						entityId: "ent-hebron",
						entityType: "PLACE",
						entityName: "חברון",
					},
				],
			});
			const markers: PlaceMapMarker[] = [
				{
					placeId: "pl-1",
					placeName: "חברון",
					modernName: "Hebron",
					lat: 31.53,
					lng: 35.09,
					entryUniqueName: "חברון",
				},
			];
			const graph = buildEntryGraph({
				entry: placeEntry,
				personFamily: null,
				placeMarkers: markers,
				category: { label: "מקומות", entityType: "PLACE" },
			});
			const place = nodeByType(graph, "Place");
			expect(place?.geo).toEqual({
				"@type": "GeoCoordinates",
				latitude: 31.53,
				longitude: 35.09,
			});
			expect(place?.alternateName).toBe("Hebron");
		});

		it("applies verified sameAs from the external-reference map", () => {
			const graph = buildEntryGraph({
				...baseInput(),
				sameAsByEntityId: {
					"ent-avraham": ["https://www.wikidata.org/wiki/Q9181"],
				},
			});
			const person = nodeByType(graph, "Person");
			expect(person?.sameAs).toEqual(["https://www.wikidata.org/wiki/Q9181"]);
		});

		it("omits the category crumb and about when the entry has no entities", () => {
			const graph = buildEntryGraph({
				entry: entry({ entities: [] }),
				personFamily: null,
				placeMarkers: [],
				category: null,
			});
			const crumb = nodeByType(graph, "BreadcrumbList");
			const items = crumb?.itemListElement as Array<{ name: string }>;
			expect(items.map((i) => i.name)).toEqual([
				"בית",
				"תנכפדיה",
				"אברהם אבינו",
			]);
			expect(nodeByType(graph, "WebPage")?.about).toBeUndefined();
		});

		it("omits dateModified when updatedAt is null", () => {
			const graph = buildEntryGraph({
				...baseInput(),
				entry: entry({ updatedAt: null as unknown as string }),
			});
			expect(nodeByType(graph, "WebPage")?.dateModified).toBeUndefined();
		});

		it("omits dateModified when updatedAt is not a valid date", () => {
			const graph = buildEntryGraph({
				...baseInput(),
				entry: entry({ updatedAt: "not-a-real-date" }),
			});
			expect(nodeByType(graph, "WebPage")?.dateModified).toBeUndefined();
		});

		it("maps a female focal person and omits gender when sex is unknown", () => {
			const femaleFamily: PersonFamilySummary = {
				focalPersonId: "p-sara",
				focalEntityId: "ent-avraham",
				focalDisplayName: "שרה",
				focalSex: "FEMALE",
				focalBirthYyyymmdd: null,
				parents: [],
				children: [],
				spouses: [],
				siblings: [],
			};
			const female = buildEntryGraph({
				...baseInput(),
				personFamily: femaleFamily,
			});
			expect(nodeByType(female, "Person")?.gender).toBe("Female");

			const unknown = buildEntryGraph({
				...baseInput(),
				personFamily: { ...femaleFamily, focalSex: null },
			});
			expect(nodeByType(unknown, "Person")?.gender).toBeUndefined();
		});

		it("emits siblings and skips a related person already present as an entity", () => {
			const family: PersonFamilySummary = {
				focalPersonId: "p-avraham",
				focalEntityId: "ent-avraham",
				focalDisplayName: "אברהם",
				focalSex: "MALE",
				focalBirthYyyymmdd: null,
				parents: [],
				children: [],
				spouses: [],
				siblings: [
					{
						personId: "p-nahor",
						entityId: "ent-nahor",
						displayName: "נחור",
						entryUniqueName: "נחור",
						entryTitle: "נחור",
						sex: "MALE",
					},
					// entryUniqueName equals the entry's own → same @id as the focal
					// entity, so this related person is skipped (continue branch).
					{
						personId: "p-dup",
						entityId: "ent-dup",
						displayName: "כפול",
						entryUniqueName: "אברהם",
						entryTitle: "אברהם אבינו",
						sex: "MALE",
					},
				],
			};
			const graph = buildEntryGraph({ ...baseInput(), personFamily: family });
			const focal = nodeByType(graph, "Person");
			expect(focal?.sibling).toEqual([
				{ "@id": `${SITE_ORIGIN}${entryPath("נחור")}#entity` },
				{ "@id": `${SITE_ORIGIN}${entryPath("אברהם")}#entity` },
			]);
			const nahor = nodesOf(graph).find(
				(n) => n["@id"] === `${SITE_ORIGIN}${entryPath("נחור")}#entity`,
			);
			expect(nahor).toMatchObject({ "@type": "Person", name: "נחור" });
			expect(nahor?.url).toBe(`${SITE_ORIGIN}${entryPath("נחור")}`);
			// The duplicate shares the focal entity @id and is not added again.
			const focalId = `${SITE_ORIGIN}${entryPath("אברהם")}#entity`;
			expect(nodesOf(graph).filter((n) => n["@id"] === focalId)).toHaveLength(
				1,
			);
		});

		it("omits geo without a matching marker and alternateName without a modern name", () => {
			const placeEntry = entry({
				uniqueName: "העי",
				title: "העי",
				content: "<p></p>",
				entities: [
					{
						id: "ee-p",
						entryId: "entry-1",
						entityId: "ent-ai",
						entityType: "PLACE",
						entityName: "העי",
					},
				],
			});
			const noMatch = buildEntryGraph({
				entry: placeEntry,
				personFamily: null,
				placeMarkers: [
					{
						placeId: "x",
						placeName: "שכם",
						modernName: "Nablus",
						lat: 32.21,
						lng: 35.28,
						entryUniqueName: "שכם",
					},
				],
				category: { label: "מקומות", entityType: "PLACE" },
			});
			expect(nodeByType(noMatch, "Place")?.geo).toBeUndefined();

			const noModern = buildEntryGraph({
				entry: placeEntry,
				personFamily: null,
				placeMarkers: [
					{
						placeId: "y",
						placeName: "העי",
						modernName: null,
						lat: 31.92,
						lng: 35.26,
						entryUniqueName: "העי",
					},
				],
				category: { label: "מקומות", entityType: "PLACE" },
			});
			const place = nodeByType(noModern, "Place");
			expect(place?.geo).toBeDefined();
			expect(place?.alternateName).toBeUndefined();
		});

		it("ignores an empty sameAs list for an entity", () => {
			const graph = buildEntryGraph({
				...baseInput(),
				sameAsByEntityId: { "ent-avraham": [] },
			});
			expect(nodeByType(graph, "Person")?.sameAs).toBeUndefined();
		});
	});

	describe("buildLandingGraph", () => {
		it("emits CollectionPage + DefinedTermSet + breadcrumb", () => {
			const graph = buildLandingGraph();
			const page = nodeByType(graph, "CollectionPage");
			expect(page?.["@id"]).toBe(`${SITE_ORIGIN}${TANAHPEDIA_PATH}#webpage`);
			expect(page?.mainEntity).toEqual({ "@id": TANAHPEDIA_SET_ID });
			const set = nodeByType(graph, "DefinedTermSet");
			expect(set?.["@id"]).toBe(TANAHPEDIA_SET_ID);
			const crumb = nodeByType(graph, "BreadcrumbList");
			const items = crumb?.itemListElement as Array<{ name: string }>;
			expect(items.map((i) => i.name)).toEqual(["בית", "תנכפדיה"]);
		});
	});

	describe("buildCategoryGraph", () => {
		it("emits CollectionPage + ItemList of entries + breadcrumb", () => {
			const graph = buildCategoryGraph({
				entityType: "PERSON",
				label: "אישים",
				items: [
					{ uniqueName: "אברהם", title: "אברהם אבינו" },
					{ uniqueName: "יצחק", title: "יצחק אבינו" },
				],
			});
			const page = nodeByType(graph, "CollectionPage");
			expect(page?.name).toBe("אישים");
			expect(page?.about).toEqual({ "@id": TANAHPEDIA_SET_ID });
			const list = nodeByType(graph, "ItemList");
			expect(list?.numberOfItems).toBe(2);
			const items = list?.itemListElement as Array<{
				position: number;
				url: string;
				name: string;
			}>;
			expect(items[0]).toMatchObject({
				position: 1,
				url: `${SITE_ORIGIN}${entryPath("אברהם")}`,
				name: "אברהם אבינו",
			});
			const crumb = nodeByType(graph, "BreadcrumbList");
			const crumbs = crumb?.itemListElement as Array<{ name: string }>;
			expect(crumbs.map((i) => i.name)).toEqual(["בית", "תנכפדיה", "אישים"]);
		});

		it("produces an empty ItemList when there are no entries", () => {
			const graph = buildCategoryGraph({
				entityType: "WAR",
				label: "מלחמות",
				items: [],
			});
			const list = nodeByType(graph, "ItemList");
			expect(list?.numberOfItems).toBe(0);
			expect(list?.itemListElement).toEqual([]);
		});
	});
});
