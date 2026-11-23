import type { CategoryKey } from "./labels";

// The shared taxonomy (#3710); the admin keeps only its website-URL helper.
export {
	CATEGORY_HIERARCHY,
	type CategoryHierarchyItem,
	labelForCategoryKey,
} from "../../../../shared/tanahpedia/index";

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
