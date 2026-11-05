/**
 * The typed article-relationship contract (#3102): every DB-supported
 * article content relationship, its cardinality, editable link metadata,
 * validation, ownership, permission and lifecycle. Shared verbatim by the
 * Rust API (`include_str!` → `articleRelationshipCapabilities`) and the
 * admin/TS side (this module) — `registry.json` is the single source of
 * truth; keep both consumers' type mirrors in sync with it.
 *
 * The LLM draft/approval pipeline (#3103) consumes this contract to know
 * which relationships exist, how to propose them, and which validated
 * mutation path applies them — never a direct-SQL path.
 */
import registry from "./registry.json";

export type ArticleRelationshipCardinality =
	| "exactly-one"
	| "zero-or-one"
	| "many";

export type ArticleRelationshipOperation =
	| "read"
	| "add"
	| "replace"
	| "remove"
	| "clear";

export type ArticleRelationshipStatus = "supported" | "pending-schema";

export interface ArticleRelationshipEntry {
	/** Stable machine key — proposals and mutations name this, never tables. */
	key: string;
	/** Hebrew UI label for grouped admin sections. */
	label: string;
	/** Human-readable meaning — what the link expresses semantically. */
	meaning: string;
	/** Semantic target kind (perek, author, dedication, moed, …), not a table. */
	targetKind: string;
	cardinality: ArticleRelationshipCardinality;
	/** Editable fields carried on the link itself (e.g. expiresAt). */
	linkMetadata: string[];
	/**
	 * The aggregate that owns the write path: `article` (article editor/
	 * mutation), `dedication` (dedication workflow), `annotation-pipeline`
	 * (import tooling — no API/admin write by design).
	 */
	ownership: string;
	/** The API shared-secret scope authorizing writes; `null` = no API write. */
	permission: string | null;
	operations: ArticleRelationshipOperation[];
	/** The validated write contract — mutation name + field semantics. */
	writeContract: string;
	/** Where the link is readable (public projection vs admin-only). */
	readContract: string;
	/** The invalidation entity-change the write enqueues. */
	invalidates: string;
	status: ArticleRelationshipStatus;
	/** Owning issue while `status` is `pending-schema`. */
	pendingIssue?: number;
}

export interface InternalDerivedTable {
	name: string;
	reason: string;
}

export interface ArticleRelationshipRegistry {
	contractVersion: number;
	articleKey: string;
	freshness: {
		expectedContentHash: string;
		expectedCoveringSources: string;
		expectedMoedIds: string;
	};
	relationships: ArticleRelationshipEntry[];
	/** Referencing tables that are NOT user-editable content relationships. */
	internalDerivedTables: InternalDerivedTable[];
}

/** The parsed contract — validated structurally by the parity tests. */
export const ARTICLE_RELATIONSHIP_REGISTRY =
	registry as ArticleRelationshipRegistry;

/** Lookup one entry by its stable key; `undefined` for unknown keys. */
export function relationshipFor(
	key: string,
): ArticleRelationshipEntry | undefined {
	return ARTICLE_RELATIONSHIP_REGISTRY.relationships.find((r) => r.key === key);
}

/** Entries whose write/read paths are live today (schema deployed). */
export function supportedRelationships(): ArticleRelationshipEntry[] {
	return ARTICLE_RELATIONSHIP_REGISTRY.relationships.filter(
		(r) => r.status === "supported",
	);
}

/** Entries gated on a not-yet-deployed schema — surfaced, never silently dropped. */
export function pendingRelationships(): ArticleRelationshipEntry[] {
	return ARTICLE_RELATIONSHIP_REGISTRY.relationships.filter(
		(r) => r.status === "pending-schema",
	);
}
