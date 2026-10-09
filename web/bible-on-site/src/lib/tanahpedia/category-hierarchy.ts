import { CATEGORY_LABELS, ENTITY_TYPE_LABELS } from "./service";
import type { CategoryKey, EntityType } from "./types";

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
