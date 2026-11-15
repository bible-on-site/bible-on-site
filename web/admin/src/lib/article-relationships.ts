/**
 * The admin's typed accessor to the shared article-relationship contract
 * (#3102). `web/shared/article-relationships/registry.json` is the single
 * source of truth — the Rust API embeds the same JSON, so the panel and the
 * API can never disagree about which relationships exist, their cardinality
 * or their write contracts.
 */
export {
	ARTICLE_RELATIONSHIP_REGISTRY,
	type ArticleRelationshipCardinality,
	type ArticleRelationshipEntry,
	type ArticleRelationshipOperation,
	type ArticleRelationshipRegistry,
	type ArticleRelationshipStatus,
	type InternalDerivedTable,
	pendingRelationships,
	relationshipFor,
	supportedRelationships,
} from "../../../shared/article-relationships/index";
