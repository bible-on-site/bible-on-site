/**
 * Tanahpedia category labels — the single taxonomy definition lives in
 * `web/shared/tanahpedia/` (#3710); this module re-exports it so existing
 * admin imports keep working.
 */
export {
	type AnimalKind,
	type AnimalPurity,
	CATEGORY_LABELS,
	type CategoryKey,
	ENTITY_TYPE_LABELS,
	ENTITY_TYPES,
	type EntityType,
	type PersonRole,
} from "../../../../shared/tanahpedia/index";
