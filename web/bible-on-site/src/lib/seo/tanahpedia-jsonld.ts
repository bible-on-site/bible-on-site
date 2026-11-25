import type { Graph, Thing } from "schema-dts";
import { isoDurationSeconds } from "@/lib/reading-metrics";
import { categoryHref } from "@/lib/tanahpedia/category-slug";
import { normalizeFootnoteHtml } from "@/lib/tanahpedia/normalize-footnotes";
import type {
	EntityType,
	EntryWithEntities,
	PediaImage,
	PediaImageLink,
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
	plainText,
	SITE_ORIGIN,
	WEBSITE_ID,
} from "./jsonld";

export { plainText };

export const TANAHPEDIA_PATH = "/pedia";
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
	return categoryHref(entityType);
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

/**
 * The `ImageObject` node for a public pedia image (#3769), carrying the
 * Google-recognized attribution metadata: `contentUrl`, `creator`,
 * `creditText`, `copyrightNotice` and `license`/`acquireLicensePage` where
 * applicable. A public-domain statement stays distinct from a license —
 * `copyrightNotice` records it and no `license` is emitted.
 */
export function pediaImageObject(image: PediaImage): Record<string, unknown> {
	const node: Record<string, unknown> = {
		"@type": "ImageObject",
		contentUrl: absUrl(image.url),
		url: absUrl(image.url),
		name: image.altText,
	};
	if (image.width != null) node.width = image.width;
	if (image.height != null) node.height = image.height;
	if (image.caption) node.caption = image.caption;
	if (image.creator) {
		node.creator = { "@type": "Person", name: image.creator };
	}
	if (image.creditLine) node.creditText = image.creditLine;
	if (image.isPublicDomain) {
		node.copyrightNotice = "Public domain";
	} else if (image.licenseName) {
		node.copyrightNotice = image.licenseName;
		if (image.licenseUrl) node.license = absUrl(image.licenseUrl);
		if (image.sourceUrl) node.acquireLicensePage = absUrl(image.sourceUrl);
	}
	if (image.sourceName) {
		node.provider = { "@type": "Organization", name: image.sourceName };
	}
	return node;
}

/** The "selected" link of a scope — its `is_primary` row, else the first
 * image the gallery displays. */
function selectedLink(
	links: PediaImageLink[],
	ownerId?: string,
): PediaImageLink | null {
	const scoped =
		ownerId === undefined
			? links
			: links.filter((link) => link.ownerId === ownerId);
	return scoped.find((link) => link.isPrimary) ?? scoped[0] ?? null;
}

export interface EntryGraphInput {
	entry: EntryWithEntities;
	personFamily: PersonFamilySummary | null;
	placeMarkers: PlaceMapMarker[];
	/** Primary category for the breadcrumb; null when the entry has no entity. */
	category: { label: string; entityType: EntityType } | null;
	/** Verified external references keyed by entityId (Phase 4 `sameAs`). */
	sameAsByEntityId?: Record<string, string[]>;
	/** Entry-scope public image links (#3769). */
	entryImages?: PediaImageLink[];
	/** Entity-scope public image links for the entry's entities. */
	entityImages?: PediaImageLink[];
}

/** Build the `@graph` for a Tanahpedia entry page (`/pedia/[uniqueName]`). */
export function buildEntryGraph(input: EntryGraphInput): Graph {
	const {
		entry,
		personFamily,
		placeMarkers,
		category,
		sameAsByEntityId,
		entryImages = [],
		entityImages = [],
	} = input;
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

		// The entity's selected public image (#3769) — the same primary the
		// rendered gallery surfaces.
		const entityImage = selectedLink(entityImages, ee.entityId);
		if (entityImage) {
			node.image = pediaImageObject(entityImage.image);
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
		/* Normalized HTML keeps generated footnote markers (data-marker
		   attributes, empty anchors) out of the extracted description (#2615). */
		definedTerm.description = plainText(
			normalizeFootnoteHtml(entry.content as string),
			300,
		);
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
		// Stored complete-text baseline (#2607) — on the WebPage
		// (CreativeWork) node describing the entry's prose. The DefinedTerm
		// and Person/Place/Thing entity nodes stay metric-free: reading
		// time never hangs on the catalogued entity as if it were prose.
		...(entry.metric?.wordCount != null
			? { wordCount: entry.metric.wordCount }
			: {}),
		...(entry.metric?.estimatedSeconds != null
			? { timeRequired: isoDurationSeconds(entry.metric.estimatedSeconds) }
			: {}),
	};
	if (focal) {
		webPage.about = {
			"@id": entityRefId(focal.entityId, entry.uniqueName),
		};
	}
	// The page's representative image: the selected entry-scope image, else —
	// only when the entry has an unambiguous single subject — that entity's
	// selected image (#3769). Every emitted image is one the page renders.
	const pageLink =
		selectedLink(entryImages) ??
		(entry.entities.length === 1
			? selectedLink(entityImages, entry.entities[0].entityId)
			: null);
	if (pageLink) {
		webPage.image = pediaImageObject(pageLink.image);
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

export const TANAHPEDIA_DESCRIPTION =
	'אנציקלופדיה לתנ"ך - אישים, מקומות, אירועים, חפצים ועוד';

/** Build the `@graph` for the Tanahpedia landing page (`/pedia`). */
export function buildLandingGraph(): Graph {
	const url = absUrl(TANAHPEDIA_PATH);
	const breadcrumb = breadcrumbNode(
		[
			{ name: "בית", path: "/" },
			{ name: TANAHPEDIA_LABEL, path: TANAHPEDIA_PATH },
		],
		TANAHPEDIA_PATH,
	);
	const termSet: Record<string, unknown> = {
		"@type": "DefinedTermSet",
		"@id": TANAHPEDIA_SET_ID,
		name: TANAHPEDIA_LABEL,
		url,
		inLanguage: "he",
		description: TANAHPEDIA_DESCRIPTION,
	};
	const page: Record<string, unknown> = {
		"@type": "CollectionPage",
		"@id": nodeId(TANAHPEDIA_PATH, "webpage"),
		url,
		name: TANAHPEDIA_LABEL,
		inLanguage: "he",
		isPartOf: { "@id": WEBSITE_ID },
		breadcrumb: { "@id": breadcrumb["@id"] },
		mainEntity: { "@id": TANAHPEDIA_SET_ID },
	};
	return buildGraph([
		page as unknown as Thing,
		breadcrumb,
		termSet as unknown as Thing,
	]);
}

export interface CategoryGraphInput {
	entityType: EntityType;
	label: string;
	items: { uniqueName: string; title: string }[];
}

/** Build the `@graph` for a category listing (`/pedia/[slug]`). */
export function buildCategoryGraph(input: CategoryGraphInput): Graph {
	const { entityType, label, items } = input;
	const path = categoryPath(entityType);
	const url = absUrl(path);
	const listId = nodeId(path, "itemlist");
	const breadcrumb = breadcrumbNode(
		[
			{ name: "בית", path: "/" },
			{ name: TANAHPEDIA_LABEL, path: TANAHPEDIA_PATH },
			{ name: label, path },
		],
		path,
	);
	const itemList: Record<string, unknown> = {
		"@type": "ItemList",
		"@id": listId,
		numberOfItems: items.length,
		itemListElement: items.map((item, index) => ({
			"@type": "ListItem",
			position: index + 1,
			url: absUrl(entryPath(item.uniqueName)),
			name: item.title,
		})),
	};
	const page: Record<string, unknown> = {
		"@type": "CollectionPage",
		"@id": nodeId(path, "webpage"),
		url,
		name: label,
		inLanguage: "he",
		isPartOf: { "@id": WEBSITE_ID },
		about: { "@id": TANAHPEDIA_SET_ID },
		breadcrumb: { "@id": breadcrumb["@id"] },
		mainEntity: { "@id": listId },
	};
	return buildGraph([
		page as unknown as Thing,
		breadcrumb,
		itemList as unknown as Thing,
	]);
}
