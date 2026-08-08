import type { Graph, Thing } from "schema-dts";
import type {
	EntityType,
	EntryWithEntities,
	PersonFamilyRelatedPerson,
	PersonFamilySummary,
	PlaceMapMarker,
} from "@/lib/tanahpedia/types";
import {
	absUrl,
	breadcrumbNode,
	buildGraph,
	hasContent,
	nodeId,
	SITE_ORIGIN,
	WEBSITE_ID,
} from "./jsonld";

export const TANAHPEDIA_PATH = "/tanahpedia";
/** Stable `@id` of the Tanahpedia dictionary (the DefinedTermSet). */
export const TANAHPEDIA_SET_ID = `${SITE_ORIGIN}${TANAHPEDIA_PATH}#definedtermset`;
export const TANAHPEDIA_LABEL = "תנכפדיה";

/** EntityType → schema.org `@type`. Ambiguous kinds fall back to `Thing`
 * (the DefinedTerm still carries the encyclopedic classification). */
const ENTITY_TYPE_TO_SCHEMA: Record<EntityType, string> = {
	PERSON: "Person",
	PLACE: "Place",
	EVENT: "Event",
	WAR: "Event",
	SEFER: "Book",
	TANAH_SEFER: "Book",
	ANIMAL: "Thing",
	OBJECT: "Thing",
	TEMPLE_TOOL: "Thing",
	PLANT: "Thing",
	ASTRONOMICAL_OBJECT: "Thing",
	SAYING: "Thing",
	PROPHECY: "Thing",
	NATION: "Thing",
};

export function entityTypeToSchemaType(entityType: EntityType): string {
	return ENTITY_TYPE_TO_SCHEMA[entityType] ?? "Thing";
}

/** Canonical site path for an entry. */
export function entryPath(uniqueName: string): string {
	return `/pedia/${encodeURIComponent(uniqueName)}`;
}

/** Category listing path for an entity type. */
export function categoryPath(entityType: EntityType): string {
	return `${TANAHPEDIA_PATH}/${entityType.toLowerCase()}`;
}

/**
 * Stable `@id` for an entity: anchored to its own entry page when it has one
 * (so cross-page references resolve), else a stable URN.
 */
export function entityRefId(
	entityId: string,
	entryUniqueName: string | null,
): string {
	return entryUniqueName
		? `${absUrl(entryPath(entryUniqueName))}#entity`
		: `urn:tanahpedia:entity:${entityId}`;
}

/** Plain-text snippet from entry HTML, for a definition/description. */
export function plainText(html: string, maxLen: number): string {
	return html
		.replace(/<[^>]*>/g, " ")
		.replace(/\s+/g, " ")
		.trim()
		.slice(0, maxLen);
}

function toIsoDate(value: string | null | undefined): string | undefined {
	if (!value) {
		return undefined;
	}
	const date = new Date(value);
	return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function schemaGender(sex: string | null): string | undefined {
	if (sex === "MALE") {
		return "Male";
	}
	if (sex === "FEMALE") {
		return "Female";
	}
	return undefined;
}

function relatedRef(person: PersonFamilyRelatedPerson): { "@id": string } {
	return { "@id": entityRefId(person.entityId, person.entryUniqueName) };
}

export interface EntryGraphInput {
	entry: EntryWithEntities;
	personFamily: PersonFamilySummary | null;
	placeMarkers: PlaceMapMarker[];
	/** Primary category for the breadcrumb; null when the entry has no entity. */
	category: { label: string; entityType: EntityType } | null;
	/** Verified external references keyed by entityId (Phase 4 `sameAs`). */
	sameAsByEntityId?: Record<string, string[]>;
}

/** Build the `@graph` for a Tanahpedia entry page (`/pedia/[uniqueName]`). */
export function buildEntryGraph(input: EntryGraphInput): Graph {
	const { entry, personFamily, placeMarkers, category, sameAsByEntityId } =
		input;
	const path = entryPath(entry.uniqueName);
	const pageUrl = absUrl(path);
	const termId = `${pageUrl}#term`;
	const modified = toIsoDate(entry.updatedAt);

	// Focal entity: prefer a PERSON, else the first entity.
	const focal =
		entry.entities.find((e) => e.entityType === "PERSON") ??
		entry.entities[0] ??
		null;

	const byId = new Map<string, Thing>();

	for (const ee of entry.entities) {
		const id = entityRefId(ee.entityId, entry.uniqueName);
		const node: Record<string, unknown> = {
			"@type": entityTypeToSchemaType(ee.entityType),
			"@id": id,
			name: ee.entityName,
			url: pageUrl,
		};
		const sameAs = sameAsByEntityId?.[ee.entityId];
		if (sameAs && sameAs.length > 0) {
			node.sameAs = sameAs;
		}

		if (ee.entityType === "PLACE") {
			const marker = placeMarkers.find((m) => m.placeName === ee.entityName);
			if (marker) {
				node.geo = {
					"@type": "GeoCoordinates",
					latitude: marker.lat,
					longitude: marker.lng,
				};
				if (marker.modernName) {
					node.alternateName = marker.modernName;
				}
			}
		}

		if (personFamily && ee.entityId === personFamily.focalEntityId) {
			const gender = schemaGender(personFamily.focalSex);
			if (gender) {
				node.gender = gender;
			}
			if (personFamily.parents.length > 0) {
				node.parent = personFamily.parents.map((p) => relatedRef(p.related));
			}
			if (personFamily.children.length > 0) {
				node.children = personFamily.children.map((c) => relatedRef(c.related));
			}
			if (personFamily.spouses.length > 0) {
				node.spouse = personFamily.spouses.map((s) => relatedRef(s.related));
			}
			if (personFamily.siblings.length > 0) {
				node.sibling = personFamily.siblings.map((s) => relatedRef(s));
			}
		}

		byId.set(id, node as unknown as Thing);
	}

	// Lightweight nodes for related persons not already present as entities.
	if (personFamily) {
		const related: PersonFamilyRelatedPerson[] = [
			...personFamily.parents.map((p) => p.related),
			...personFamily.children.map((c) => c.related),
			...personFamily.spouses.map((s) => s.related),
			...personFamily.siblings,
		];
		for (const rp of related) {
			const id = entityRefId(rp.entityId, rp.entryUniqueName);
			if (byId.has(id)) {
				continue;
			}
			const node: Record<string, unknown> = {
				"@type": "Person",
				"@id": id,
				name: rp.displayName,
			};
			if (rp.entryUniqueName) {
				node.url = absUrl(entryPath(rp.entryUniqueName));
			}
			byId.set(id, node as unknown as Thing);
		}
	}

	const definedTerm: Record<string, unknown> = {
		"@type": "DefinedTerm",
		"@id": termId,
		name: entry.title,
		url: pageUrl,
		inDefinedTermSet: { "@id": TANAHPEDIA_SET_ID },
	};
	if (hasContent(entry.content)) {
		definedTerm.description = plainText(entry.content as string, 300);
	}

	const breadcrumbItems = [
		{ name: "בית", path: "/" },
		{ name: TANAHPEDIA_LABEL, path: TANAHPEDIA_PATH },
	];
	if (category) {
		breadcrumbItems.push({
			name: category.label,
			path: categoryPath(category.entityType),
		});
	}
	breadcrumbItems.push({ name: entry.title, path });
	const breadcrumb = breadcrumbNode(breadcrumbItems, path);

	const webPage: Record<string, unknown> = {
		"@type": "WebPage",
		"@id": nodeId(path, "webpage"),
		url: pageUrl,
		name: entry.title,
		inLanguage: "he",
		isPartOf: { "@id": WEBSITE_ID },
		breadcrumb: { "@id": breadcrumb["@id"] },
		mainEntity: { "@id": termId },
	};
	if (focal) {
		webPage.about = {
			"@id": entityRefId(focal.entityId, entry.uniqueName),
		};
	}
	if (modified) {
		webPage.dateModified = modified;
	}

	const nodes: Thing[] = [
		webPage as unknown as Thing,
		breadcrumb,
		definedTerm as unknown as Thing,
		...byId.values(),
	];

	return buildGraph(nodes);
}
