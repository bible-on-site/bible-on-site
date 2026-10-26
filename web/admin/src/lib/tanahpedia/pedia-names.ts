/**
 * Pure helpers for Tanahpedia public address names — shared by the admin
 * editor UI and the server functions (client-safe: no server imports).
 *
 * Mirrors two website contracts:
 * - `normalizedUniqueNameFromParam` (web/bible-on-site .../unique-name-param.ts):
 *   route segments are URL-decoded and NFC-normalized before DB lookup.
 * - `normalizeSlug` (web/bible-on-site .../category-slug.ts): category routes
 *   win over entry names, so an entry/alias name colliding with a category
 *   slug is unreachable and must be rejected.
 */

import { CATEGORY_LABELS, type CategoryKey } from "./labels";

/** Hebrew category slugs — mirror of CATEGORY_SLUGS in the website's category-slug.ts. */
const PEDIA_CATEGORY_SLUGS: Record<CategoryKey, string> = {
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

export const PEDIA_NAME_MAX_LEN = 255;

/** Mirrors `normalizeSlug` in the website's category-slug.ts. */
export function normalizeSlugLikeCategory(raw: string): string {
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

/**
 * Reserved `/pedia/<slug>` values: the Hebrew category slugs plus the legacy
 * English category keys (both resolve to a category route).
 */
const RESERVED_SLUGS: ReadonlyMap<string, string> = new Map(
	(Object.keys(PEDIA_CATEGORY_SLUGS) as CategoryKey[]).flatMap((key) => [
		[
			normalizeSlugLikeCategory(PEDIA_CATEGORY_SLUGS[key]),
			CATEGORY_LABELS[key],
		],
		[normalizeSlugLikeCategory(key), CATEGORY_LABELS[key]],
	]),
);

/**
 * The category label when the name collides with a category route (which wins
 * over any entry/alias of the same name), else null.
 */
export function reservedCategoryLabelFor(name: string): string | null {
	return RESERVED_SLUGS.get(normalizeSlugLikeCategory(name)) ?? null;
}

/**
 * Canonical stored form of an address name — what the public router looks up.
 * URL-decodes pasted input defensively, then NFC + trim — matching
 * `normalizedUniqueNameFromParam`, so existing names never double-encode.
 */
export function normalizePediaName(raw: string): string {
	let value = raw.trim();
	try {
		value = decodeURIComponent(value);
	} catch {
		// Malformed escapes — keep the raw segment
	}
	return value.normalize("NFC").trim();
}

/**
 * Accepts a bare name, a `/pedia/<name>` path or a full pasted URL and returns
 * the stored name form — editors never have to guess whether to paste a whole
 * URL or just its last segment. A plain name with no URL shape passes through
 * unchanged (a literal `/` in it is rejected later by validation).
 */
export function pediaNameFromInput(raw: string): string {
	let s = raw.trim();
	const looksLikeUrl =
		/^[a-z][a-z0-9+.-]*:\/\//i.test(s) ||
		s.startsWith("/") ||
		s.toLowerCase().startsWith("pedia/");
	if (looksLikeUrl) {
		s = s.replace(/^[a-z][a-z0-9+.-]*:\/\/[^/]+/i, "");
		s = s.split(/[?#]/)[0];
		s = s.replace(/^\/?pedia\//i, "");
		s = s.split("/").filter(Boolean).pop() ?? "";
	}
	return normalizePediaName(s);
}

/** Complete public URL for an entry page under the configured website origin. */
export function pediaPublicUrl(origin: string, name: string): string {
	return `${origin.replace(/\/+$/, "")}/pedia/${encodeURIComponent(normalizePediaName(name))}`;
}

/** A target entry of an alias name, with its distinguishing label. */
export interface AliasTargetInput {
	entryId: string;
	label: string;
}

/**
 * Dedupe by entryId — the first occurrence wins; a later non-empty label fills
 * an empty one so manually repeated picks never lose typed text.
 */
export function dedupeAliasTargets(
	targets: AliasTargetInput[],
): AliasTargetInput[] {
	const byId = new Map<string, AliasTargetInput>();
	for (const t of targets) {
		const prev = byId.get(t.entryId);
		if (!prev) {
			byId.set(t.entryId, { entryId: t.entryId, label: t.label.trim() });
		} else if (!prev.label && t.label.trim()) {
			prev.label = t.label.trim();
		}
	}
	return [...byId.values()];
}

/**
 * Order-insensitive multiset comparison of an alias name's target set — the
 * baseline an editor opened with vs the set the server holds at save time.
 * Labels compare after the same normalization saves apply (null → "", trim).
 */
export function sameAliasTargetSet(
	a: { entryId: string; label?: string | null }[],
	b: { entryId: string; label?: string | null }[],
): boolean {
	const key = (t: { entryId: string; label?: string | null }) =>
		`${t.entryId} ${(t.label ?? "").trim()}`;
	const ka = a.map(key).sort();
	const kb = b.map(key).sort();
	return ka.length === kb.length && ka.every((k, i) => k === kb[i]);
}

export type AliasKind = "alias" | "disambiguation";

/** Public behavior of a name with the given number of targets. */
export function aliasKindForTargetCount(count: number): AliasKind {
	return count > 1 ? "disambiguation" : "alias";
}

/**
 * Hebrew validation of an alias-name spec before save: non-empty legal name,
 * at least one distinct target, and a distinguishing label on every target
 * when the name is shared (that label is what the public disambiguation page
 * shows under each entry title).
 */
export function validateAliasSpec(
	name: string,
	targets: AliasTargetInput[],
): { ok: true } | { ok: false; error: string } {
	if (!name) return { ok: false, error: "שם הכתובת חייב להיות מלא" };
	if (name.includes("/")) {
		return { ok: false, error: "שם הכתובת אינו יכול להכיל '/'" };
	}
	if (name.length > PEDIA_NAME_MAX_LEN) {
		return { ok: false, error: "שם הכתובת ארוך מדי (עד 255 תווים)" };
	}
	const deduped = dedupeAliasTargets(targets);
	if (deduped.length === 0) {
		return { ok: false, error: "יש לצרף לפחות ערך יעד אחד" };
	}
	if (deduped.length > 1) {
		for (const t of deduped) {
			if (!t.label) {
				return {
					ok: false,
					error:
						"כשהשם משותף בין כמה ערכים, לכל ערך נדרשת תווית מבדנת שתופיע בדף הפירושונים",
				};
			}
		}
	}
	for (const t of deduped) {
		if (t.label.length > PEDIA_NAME_MAX_LEN) {
			return { ok: false, error: "תווית מבדנת ארוכה מדי (עד 255 תווים)" };
		}
	}
	return { ok: true };
}
