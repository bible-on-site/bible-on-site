import divisionData from "./parasha-division.json";

/**
 * Canonical slugs, aliases, and route resolution for the פרשה
 * division (issue #2738).
 *
 * Public unit URLs are the canonical Hebrew-name slugs stored in
 * `parasha-division.json` (`/פרשה/לך-לך`), while the stable decimal
 * unitId stays the internal identity. The shared table also carries the
 * researched `aliases` (see its `nameAudit` block for provenance); the
 * `פרשת {name}` / `פרשת {alias}` prefixed forms register automatically
 * for every unit, so they never need to be stored.
 *
 * This module is client-safe: it consumes only the shared JSON and
 * never touches the canonical corpus, so the flipbook and the proxy
 * can resolve and emit canonical paths without server-only data.
 *
 * Everything — canonical names, aliases, prefixed forms — resolves
 * through one normalized map built at module load. Two different units
 * claiming the same normalized key (canonical vs alias, or alias vs
 * alias) fail the build immediately rather than silently shadowing a
 * route; an alias that normalizes to digits is rejected outright so it
 * can never shadow the numeric backward-compat resolution.
 */

const HEBREW_ROOT = divisionData.rootPath;
/** The division's ASCII route dir — public requests on it consolidate. */
export const PARASHA_ASCII_ROOT = "/parasha";

const PREFIX = "פרשת";

/**
 * One unit's route record: stable id, canonical slug, and the forms
 * (besides the numeric id) that resolve to it.
 */
export interface ParashaSlugRecord {
	unitId: number;
	/** Canonical path segment — plain unpointed Hebrew, ASCII hyphens. */
	slug: string;
	/** Display name with spaces (the unit's heading). */
	name: string;
	/** Researched lexical variants — long/short names and spellings. */
	aliases: string[];
}

/** How a path segment reached a unit. */
export type ParashaSegmentKind = "canonical" | "alias" | "numeric";

export interface ParashaSegmentResolution {
	unitId: number;
	/** The canonical slug the unit's public URL uses. */
	slug: string;
	kind: ParashaSegmentKind;
}

interface SourceUnitForSlugs {
	name: string;
	slug: string;
	aliases?: string[];
}

/**
 * Deliberate URL-segment normalization (issue #2738): NFC, strip
 * niqqud/teamim and geresh/gershayim marks, fold every separator —
 * whitespace, ASCII hyphen, Hebrew maqaf, and typographic dashes — into
 * a single ASCII hyphen. Meaningful Hebrew letters are never removed:
 * anything left that is not a Hebrew letter or hyphen makes the input
 * unknown (`null`).
 */
export function normalizeParashaSegment(input: string): string | null {
	const normalized = input
		.normalize("NFC")
		// Niqqud + teamim combining marks (U+0591–U+05C7 minus the maqaf
		// U+05BE, which is a separator, not a mark), geresh, gershayim,
		// and quotes.
		.replace(/[֑-ֽֿ-ׇ׳״'"]/g, "")
		// Hebrew maqaf, hyphen-minus, all Unicode dashes, and whitespace
		// (incl. NBSP) become the single ASCII separator.
		.replace(/[־‐-―\s]+/g, "-")
		.replace(/-{2,}/g, "-")
		.replace(/^-|-$/g, "");
	return /^[א-ת-]+$/.test(normalized) ? normalized : null;
}

/** Route-resolution map plus the ordered per-unit records. */
export interface ParashaSlugIndex {
	records: ParashaSlugRecord[];
	/** normalized segment → unitId (canonical + alias + prefixed forms). */
	normalizedToUnitId: ReadonlyMap<string, number>;
}

/**
 * Build (and validate) the resolution map for a unit list. Exported so
 * tests can exercise collision handling with synthetic units — the
 * module-level index below is built from the shared JSON the same way.
 */
export function buildParashaSlugIndex(
	units: readonly SourceUnitForSlugs[],
): ParashaSlugIndex {
	const normalizedToUnitId = new Map<string, number>();
	const records: ParashaSlugRecord[] = [];

	const claim = (key: string, unitId: number, form: string) => {
		const owner = normalizedToUnitId.get(key);
		if (owner !== undefined && owner !== unitId) {
			throw new Error(
				`parasha slugs: "${form}" collides between units ${owner} and ${unitId}`,
			);
		}
		normalizedToUnitId.set(key, unitId);
	};

	units.forEach((unit, index) => {
		const unitId = index + 1;
		const slug = normalizeParashaSegment(unit.name);
		if (slug === null) {
			throw new Error(`parasha slugs: unit ${unitId} name "${unit.name}" has no slug`);
		}
		if (unit.slug !== slug) {
			throw new Error(
				`parasha slugs: unit ${unitId} slug "${unit.slug}" ≠ normalized name "${slug}"`,
			);
		}
		claim(slug, unitId, unit.name);

		const aliases = unit.aliases ?? [];
		for (const alias of aliases) {
			if (/^\d+$/.test(alias.trim())) {
				throw new Error(
					`parasha slugs: unit ${unitId} alias "${alias}" is numeric — it would shadow a backward-compat id`,
				);
			}
			const key = normalizeParashaSegment(alias);
			if (key === null) {
				throw new Error(
					`parasha slugs: unit ${unitId} alias "${alias}" is not a Hebrew name`,
				);
			}
			claim(key, unitId, alias);
			claim(`${PREFIX}-${key}`, unitId, `${PREFIX} ${alias}`);
		}
		// The shared 'פרשת {name}' form resolves for every unit.
		claim(`${PREFIX}-${slug}`, unitId, `${PREFIX} ${unit.name}`);

		records.push({ unitId, slug, name: unit.name, aliases: [...aliases] });
	});

	return { records, normalizedToUnitId };
}

const index = buildParashaSlugIndex(
	divisionData.units as readonly SourceUnitForSlugs[],
);

/** Ordered slug records for every unit (1-based position = unitId). */
export const PARASHA_SLUG_RECORDS: readonly ParashaSlugRecord[] =
	index.records;

/** A unit's canonical slug by its stable unitId. */
export function parashaCanonicalSlug(unitId: number): string {
	const record = PARASHA_SLUG_RECORDS[unitId - 1];
	if (!record || record.unitId !== unitId) {
		throw new Error(`Invalid parasha unitId: ${unitId}`);
	}
	return record.slug;
}

/** A unit's canonical public path — the one URL builder for the division. */
export function parashaCanonicalPath(unitId: number): string {
	return `${HEBREW_ROOT}/${parashaCanonicalSlug(unitId)}`;
}

/**
 * Resolve one `/פרשה` (or `/parasha`) unit path segment — the already
 * URI-decoded form the route matcher hands the page — to its unit.
 * `null` for numeric ids outside 1–54, non-Hebrew input ("1garbage",
 * "abc"), and any normalized name no unit claims.
 */
export function resolveParashaSegment(
	segment: string,
): ParashaSegmentResolution | null {
	if (/^\d+$/.test(segment)) {
		const unitId = Number.parseInt(segment, 10);
		if (unitId < 1 || unitId > PARASHA_SLUG_RECORDS.length) return null;
		return {
			unitId,
			slug: parashaCanonicalSlug(unitId),
			kind: "numeric",
		};
	}
	const key = normalizeParashaSegment(segment);
	if (key === null) return null;
	const unitId = index.normalizedToUnitId.get(key);
	if (unitId === undefined) return null;
	const slug = parashaCanonicalSlug(unitId);
	return { unitId, slug, kind: segment === slug ? "canonical" : "alias" };
}
