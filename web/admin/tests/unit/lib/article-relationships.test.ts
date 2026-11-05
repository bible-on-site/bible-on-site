import { describe, expect, it } from "vitest";
import {
	ARTICLE_RELATIONSHIP_REGISTRY,
	pendingRelationships,
	relationshipFor,
	supportedRelationships,
} from "~/lib/article-relationships";

/**
 * Parity checks on the shared contract (#3102): the admin renders its panel
 * straight from `registry.json`, so these tests pin the catalogue's shape,
 * ordering and semantics — the same fields the API's
 * `articleRelationshipCapabilities` exposes verbatim.
 */
describe("article relationship registry", () => {
	it("declares the contract version and article key", () => {
		expect(ARTICLE_RELATIONSHIP_REGISTRY.contractVersion).toBe(1);
		expect(ARTICLE_RELATIONSHIP_REGISTRY.articleKey).toBe("articleId");
	});

	it("lists every DB-supported relationship in stable order", () => {
		expect(
			ARTICLE_RELATIONSHIP_REGISTRY.relationships.map((r) => r.key),
		).toEqual([
			"primaryPerek",
			"author",
			"coveringSources",
			"dedicationAssignments",
			"mentionAnnotations",
			"recurringHebrewDate",
			"moadim",
		]);
	});

	it("keeps the freshness contract fields documented", () => {
		expect(
			ARTICLE_RELATIONSHIP_REGISTRY.freshness.expectedContentHash,
		).toContain("content_hash");
		expect(
			ARTICLE_RELATIONSHIP_REGISTRY.freshness.expectedCoveringSources,
		).toContain("perekId");
		expect(ARTICLE_RELATIONSHIP_REGISTRY.freshness.expectedMoedIds).toContain(
			"moed",
		);
	});

	it("marks #3098 as pending-schema without operations", () => {
		const pending = pendingRelationships();
		expect(pending.map((r) => [r.key, r.pendingIssue])).toEqual([
			["recurringHebrewDate", 3098],
		]);
		for (const entry of pending) {
			expect(entry.operations).toEqual([]);
			expect(entry.writeContract).toContain("Pending");
		}
	});

	it("gives every supported relationship a live read and write contract", () => {
		const supported = supportedRelationships();
		expect(supported.map((r) => r.key)).toEqual([
			"primaryPerek",
			"author",
			"coveringSources",
			"dedicationAssignments",
			"mentionAnnotations",
			"moadim",
		]);
		for (const entry of supported) {
			expect(entry.operations).toContain("read");
			expect(entry.writeContract.length).toBeGreaterThan(0);
			expect(entry.readContract.length).toBeGreaterThan(0);
		}
	});

	it("preserves required single-valued semantics", () => {
		for (const key of ["primaryPerek", "author"]) {
			const entry = relationshipFor(key);
			expect(entry?.cardinality).toBe("exactly-one");
			expect(entry?.operations).not.toContain("clear");
			expect(entry?.writeContract).toContain("cannot be cleared");
		}
	});

	it("keeps dedication assignments owned by the dedication workflow", () => {
		const entry = relationshipFor("dedicationAssignments");
		expect(entry?.ownership).toBe("dedication");
		expect(entry?.permission).toBe("DEDICATION_API_KEY");
		expect(entry?.linkMetadata).toContain("expiresAt");
	});

	it("exposes mention annotations read-only and pipeline-owned", () => {
		const entry = relationshipFor("mentionAnnotations");
		expect(entry?.operations).toEqual(["read"]);
		expect(entry?.permission).toBeNull();
		expect(entry?.ownership).toBe("annotation-pipeline");
	});

	it("excludes derived and internal tables from editable relationships", () => {
		const names = ARTICLE_RELATIONSHIP_REGISTRY.internalDerivedTables.map(
			(t) => t.name,
		);
		expect(names.join(" ")).toContain("tanah_article_metric");
		expect(names.join(" ")).toContain("article_search_queue");
		for (const table of ARTICLE_RELATIONSHIP_REGISTRY.internalDerivedTables) {
			expect(table.reason.length).toBeGreaterThan(0);
		}
	});

	it("returns undefined for unknown keys", () => {
		expect(relationshipFor("nonexistent")).toBeUndefined();
	});
});
