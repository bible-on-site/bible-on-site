/** Mirrors web/bible-on-site tanahpedia service labels (admin-local). */

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
