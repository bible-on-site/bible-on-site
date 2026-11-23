/**
 * The Tanahpedia category taxonomy contract (#3710) — entity types, their
 * subcategory keys, the Hebrew category labels and the top-level category
 * hierarchy shared by the website's `/pedia` pages and the admin
 * Tanahpedia editor.
 *
 * Local helpers stay on each side: the admin's `websiteSubcategoryPath`
 * (links out to the public site) and the website's `/pedia` slug routing
 * (`category-slug.ts`) keep their own URL logic.
 */
export type EntityType =
	| "PERSON"
	| "PLACE"
	| "EVENT"
	| "WAR"
	| "ANIMAL"
	| "OBJECT"
	| "TEMPLE_TOOL"
	| "PLANT"
	| "ASTRONOMICAL_OBJECT"
	| "SAYING"
	| "SEFER"
	| "TANAH_SEFER"
	| "PROPHECY"
	| "NATION";

export type PersonRole = "PROPHET" | "KING";
export type AnimalKind = "BEHEMA" | "CHAYA" | "OF" | "SHERETZ";
export type AnimalPurity = "TAHOR" | "TAMEH";
export type CategoryKey = EntityType | PersonRole | AnimalKind | AnimalPurity;

export const ENTITY_TYPE_LABELS: Record<EntityType, string> = {
	PERSON: "אישים",
	PLACE: "מקומות",
	EVENT: "אירועים",
	WAR: "מלחמות",
	ANIMAL: "בעלי חיים",
	OBJECT: "חפצים",
	TEMPLE_TOOL: "כלי מקדש",
	PLANT: "צמחים",
	ASTRONOMICAL_OBJECT: "גרמי שמיים",
	SAYING: "אמרות",
	SEFER: "ספרים",
	TANAH_SEFER: 'ספרי תנ"ך',
	PROPHECY: "נבואות",
	NATION: "עמים",
};

export const CATEGORY_LABELS: Record<CategoryKey, string> = {
	...ENTITY_TYPE_LABELS,
	PROPHET: "נביאים",
	KING: "מלכים",
	BEHEMA: "בהמות",
	CHAYA: "חיות",
	OF: "עופות",
	SHERETZ: "שרצים",
	TAHOR: "טהורים",
	TAMEH: "טמאים",
};

export const ENTITY_TYPES = Object.keys(ENTITY_TYPE_LABELS) as EntityType[];

export interface CategoryHierarchyItem {
	type: EntityType;
	children?: CategoryKey[];
}

/** Top-level tanahpedia categories with optional sub-links (matches landing page). */
export const CATEGORY_HIERARCHY: CategoryHierarchyItem[] = [
	{ type: "PERSON", children: ["PROPHET", "KING"] },
	{ type: "PLACE" },
	{ type: "EVENT", children: ["WAR"] },
	{ type: "SAYING", children: ["PROPHECY"] },
	{ type: "OBJECT", children: ["TEMPLE_TOOL", "ASTRONOMICAL_OBJECT"] },
	{
		type: "ANIMAL",
		children: ["BEHEMA", "CHAYA", "OF", "SHERETZ", "TAHOR", "TAMEH"],
	},
	{ type: "PLANT" },
	{ type: "SEFER", children: ["TANAH_SEFER"] },
	{ type: "NATION" },
];

export function labelForCategoryKey(key: CategoryKey): string {
	return CATEGORY_LABELS[key] ?? ENTITY_TYPE_LABELS[key as EntityType] ?? key;
}
