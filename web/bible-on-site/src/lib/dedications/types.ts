/**
 * Shared dedication contract (#2731) — the TypeScript mirror of the API's
 * `dedications` resolver (web/api/src/services/dedications_service.rs).
 * Every surface (website, admin preview, native app) resolves a reading
 * context the same way: direct scopes plus perek -> sefer -> helek
 * ancestors, deduplicated by dedication id, expired rows excluded on
 * public reads.
 */

export type DedicationScopeKind =
	| "PEREK"
	| "SEFER"
	| "HELEK"
	| "PARASHA"
	| "ARTICLE"
	| "TANAHPEDIA_ENTRY"
	| "MASORA";

/**
 * One assignment of a dedication to a target, as matched by the
 * requesting reading context. `expiresAt` is the assignment-level expiry
 * (UTC; null = ongoing).
 */
export interface DedicationScope {
	kind: DedicationScopeKind;
	perekIdLow?: number;
	perekIdHigh?: number;
	seferId?: number;
	helekId?: number;
	parashaId?: number;
	articleId?: number;
	/** Canonical tanahpedia_entry id (not the mutable unique_name slug). */
	entryId?: string;
	expiresAt: Date | null;
}

/** A dedication honouring `subject` for `purposes`. */
export interface Dedication {
	id: number;
	subject: string;
	/** Purpose descriptions (לע"נ, רפואה שלימה, ...) — content, not markup. */
	purposes: string[];
	/** Whole-dedication expiry (UTC); null = ongoing. */
	expiresAt: Date | null;
	/** The assignments that matched the requested context. */
	scopes: DedicationScope[];
}

/**
 * Reading-context input: pass every identity the context carries and the
 * resolver returns the union of active dedications over direct targets
 * and ancestors (perek -> sefer -> helek).
 */
export interface DedicationContext {
	/** Canonical perek ids in the context. */
	perekIds?: number[];
	/** Canonical sefer ids. */
	seferIds?: number[];
	/** Canonical helek ids (1 תורה, 2 נביאים, 3 כתובים). */
	helekIds?: number[];
	/** Weekly parasha unit ids of the shared division. */
	parashaIds?: number[];
	/** Canonical Tanahpedia entry ids. */
	entryIds?: string[];
	/** Article ids. */
	articleIds?: number[];
	/** True when the context is a מסורה על הפרק reading unit. */
	masora?: boolean;
}

const HEALING_PURPOSES = new Set([
	"רפואה",
	"לרפואה",
	"לרפואת",
	"רפואה שלמה",
	"רפואה שלימה",
	"לרפואה שלמה",
	"לרפואה שלימה",
]);

/**
 * One stored purpose in its purpose-first display form: whitespace
 * collapsed, legacy gershayim/geresh/typographic quotes mapped to ASCII,
 * healing variants (לרפואה, רפואה שלימה, ...) folded to the construct form
 * לרפואת. Other purposes (לע"נ, custom wording) keep their meaning.
 */
export function displayPurpose(purpose: string): string {
	const clean = purpose
		.trim()
		.replace(/\s+/g, " ")
		.replace(/[״“”„]/g, '"')
		.replace(/[׳‘’]/g, "'");
	return HEALING_PURPOSES.has(clean) ? "לרפואת" : clean;
}

/**
 * The rendered Hebrew line for one dedication: the purposes directly
 * before the exact subject — `לרפואת מזל בת רחל`, `לע"נ יעל בת רחל` —
 * multiple purposes joined with ו, the subject alone when none is given.
 * Kept content-only (no markup) so admin previews, the bulletin and the
 * native app can share the same presentation string.
 */
export function formatDedication(dedication: {
	subject: string;
	purposes: string[];
}): string {
	const purposes = [
		...new Set(dedication.purposes.map(displayPurpose).filter(Boolean)),
	];
	return purposes.length === 0
		? dedication.subject
		: `${purposes.join(" ו")} ${dedication.subject}`;
}
