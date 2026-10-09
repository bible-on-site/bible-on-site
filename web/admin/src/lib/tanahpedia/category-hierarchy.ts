import { CATEGORY_LABELS, ENTITY_TYPE_LABELS } from "./labels";
import type { CategoryKey, EntityType } from "./labels";

export interface CategoryHierarchyItem {
	type: EntityType;
	children?: CategoryKey[];
}

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

const ANIMAL_KINDS: CategoryKey[] = ["BEHEMA", "CHAYA", "OF", "SHERETZ"];
const ANIMAL_PURITIES: CategoryKey[] = ["TAHOR", "TAMEH"];

/** Website URL for subcategory (opens public site). */
export function websiteSubcategoryPath(key: CategoryKey): string {
	if (key === "PROPHET" || key === "KING") {
		return `/tanahpedia/person?role=${key.toLowerCase()}`;
	}
	if (ANIMAL_KINDS.includes(key)) {
		return `/tanahpedia/animal?kind=${key.toLowerCase()}`;
	}
	if (ANIMAL_PURITIES.includes(key)) {
		return `/tanahpedia/animal?purity=${key.toLowerCase()}`;
	}
	return `/tanahpedia/${key.toLowerCase()}`;
}

export function labelForCategoryKey(key: CategoryKey): string {
	return CATEGORY_LABELS[key] ?? ENTITY_TYPE_LABELS[key as EntityType] ?? key;
}
