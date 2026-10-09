import type {
	AnimalKind,
	AnimalPurity,
	CategoryKey,
	EntityType,
	PersonRole,
} from "./types";

/** Subcategories are always reached through a parent entity type listing. */
export type SubCategoryKey = PersonRole | AnimalKind | AnimalPurity;

export type SubCategoryParam = "role" | "kind" | "purity";

/** Hebrew URL slugs — the canonical public identity of every category. */
export const CATEGORY_SLUGS: Record<CategoryKey, string> = {
	PERSON: "אישים",
	PLACE: "מקומות",
	EVENT: "אירועים",
	WAR: "מלחמות",
	ANIMAL: "בעלי-חיים",
	OBJECT: "חפצים",
	TEMPLE_TOOL: "כלי-מקדש",
	PLANT: "צמחים",
	ASTRONOMICAL_OBJECT: "גרמי-שמיים",
	SAYING: "אמרות",
	SEFER: "ספרים",
	TANAH_SEFER: "ספרי-תנך",
	PROPHECY: "נבואות",
	NATION: "עמים",
	PROPHET: "נביאים",
	KING: "מלכים",
	BEHEMA: "בהמות",
	CHAYA: "חיות",
	OF: "עופות",
	SHERETZ: "שרצים",
	TAHOR: "טהורים",
	TAMEH: "טמאים",
};

export const SUB_CATEGORY_PARENTS: Record<
	SubCategoryKey,
	{ parent: EntityType; param: SubCategoryParam }
> = {
	PROPHET: { parent: "PERSON", param: "role" },
	KING: { parent: "PERSON", param: "role" },
	BEHEMA: { parent: "ANIMAL", param: "kind" },
	CHAYA: { parent: "ANIMAL", param: "kind" },
	OF: { parent: "ANIMAL", param: "kind" },
	SHERETZ: { parent: "ANIMAL", param: "kind" },
	TAHOR: { parent: "ANIMAL", param: "purity" },
	TAMEH: { parent: "ANIMAL", param: "purity" },
};

export function isSubCategoryKey(key: CategoryKey): key is SubCategoryKey {
	return key in SUB_CATEGORY_PARENTS;
}

export function slugForCategoryKey(key: CategoryKey): string {
	return CATEGORY_SLUGS[key];
}

/** Canonical public path for a category or subcategory. */
export function categoryHref(key: CategoryKey): string {
	if (isSubCategoryKey(key)) {
		return `/pedia/${CATEGORY_SLUGS[key]}`;
	}
	return `/pedia/${CATEGORY_SLUGS[key]}`;
}

/** Short alias path for a subcategory, e.g. `/pedia/נביאים`. */
export function categoryShortHref(key: CategoryKey): string {
	return `/pedia/${CATEGORY_SLUGS[key]}`;
}

/**
 * Normalize a URL segment or query value for slug lookup.
 * Next.js supplies decoded segments; percent-encoded input is decoded defensively.
 */
function normalizeSlug(raw: string): string {
	let value = raw.trim();
	try {
		value = decodeURIComponent(value);
	} catch {
		// Malformed escapes — match on the raw segment
	}
	return value
		.normalize("NFC")
		.toLowerCase()
		.replace(/[\s_]+/g, "-")
		.replace(/^-+|-+$/g, "");
}

const SLUG_TO_CATEGORY: Map<string, CategoryKey> = new Map(
	(Object.keys(CATEGORY_SLUGS) as CategoryKey[]).flatMap((key) => [
		[normalizeSlug(CATEGORY_SLUGS[key]), key] as const,
		// Legacy English identifiers stay resolvable so old links keep working.
		[normalizeSlug(key), key] as const,
	]),
);

export function categoryKeyFromSlug(slug: string): CategoryKey | null {
	return SLUG_TO_CATEGORY.get(normalizeSlug(slug)) ?? null;
}

export interface CategorySearchParams {
	role?: string;
	kind?: string;
	purity?: string;
}

export interface ResolvedCategoryRoute {
	entityType: EntityType;
	sub: SubCategoryKey | null;
	/** Hebrew slug that must occupy the URL segment for the requested URL shape. */
	slug: string;
	/** False only for legacy English segments, which the route redirects. */
	isCanonicalSlug: boolean;
	/** Canonical URL — parent listing plus the filter query. */
	canonicalPath: string;
}

function subFromSearchParams(
	entityType: EntityType,
	searchParams: CategorySearchParams,
): SubCategoryKey | null {
	for (const param of ["role", "kind", "purity"] as const) {
		const raw = searchParams[param];
		if (!raw) continue;
		const key = categoryKeyFromSlug(raw);
		if (!key || !isSubCategoryKey(key)) continue;
		const parent = SUB_CATEGORY_PARENTS[key];
		if (parent.parent === entityType && parent.param === param) return key;
	}
	return null;
}

/**
 * Resolve a `/pedia/[slug]` segment as a category listing.
 * Returns `null` when the segment is not a category (the route then treats it as an entry).
 */
export function resolveCategoryRoute(
	slug: string,
	searchParams: CategorySearchParams = {},
): ResolvedCategoryRoute | null {
	const key = categoryKeyFromSlug(slug);
	if (!key) return null;

	// Compare normalized forms: the segment may arrive percent-encoded.
	const isCanonicalSlug =
		normalizeSlug(slug) === normalizeSlug(CATEGORY_SLUGS[key]);

	if (isSubCategoryKey(key)) {
		return {
			entityType: SUB_CATEGORY_PARENTS[key].parent,
			sub: key,
			slug: slugForCategoryKey(key),
			isCanonicalSlug,
			canonicalPath: categoryHref(key),
		};
	}

	const entityType = key as EntityType;
	const sub = subFromSearchParams(entityType, searchParams);
	return {
		entityType,
		sub,
		slug: slugForCategoryKey(entityType),
		isCanonicalSlug,
		canonicalPath: categoryHref(sub ?? entityType),
	};
}

/** Legacy `/tanahpedia/...` URL → its canonical `/pedia/...` replacement. */
export function pediaPathFromLegacy(
	entityTypeSegment: string | null,
	searchParams: CategorySearchParams = {},
): string {
	if (!entityTypeSegment) return "/pedia";
	const resolved = resolveCategoryRoute(entityTypeSegment, searchParams);
	return resolved ? resolved.canonicalPath : "/pedia";
}
