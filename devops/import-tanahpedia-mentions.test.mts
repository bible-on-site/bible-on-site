import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { dedupeKey, rowId } from "./import-tanahpedia-mentions.mts";

const pasukRow = {
	source_kind: "pasuk" as const,
	perek_id: 12,
	pasuk_number: 1,
	segment_start: 3,
	segment_end: 3,
	surface: "אַבְרָ֔ם",
	intended_name: "אברם",
	entity_type: "PERSON",
	model_revision: "test-model@1",
	source_hash: "x".repeat(64),
};

const articleRow = {
	source_kind: "article" as const,
	article_id: 42,
	content_hash: "y".repeat(64),
	span_start: 10,
	span_end: 15,
	surface: "אברם",
	intended_name: "אברם",
	entity_type: "PERSON",
	model_revision: "test-model@1",
	source_hash: "z".repeat(64),
};

describe("dedupeKey", () => {
	it("is stable across repeat generation for identical rows", () => {
		assert.equal(dedupeKey(pasukRow), dedupeKey({ ...pasukRow }));
	});
	it("differs across model revisions", () => {
		assert.notEqual(
			dedupeKey(pasukRow),
			dedupeKey({ ...pasukRow, model_revision: "test-model@2" }),
		);
	});
	it("differs across coordinates", () => {
		assert.notEqual(
			dedupeKey(pasukRow),
			dedupeKey({ ...pasukRow, segment_start: 4 }),
		);
	});
	it("does not depend on surface or intended_name", () => {
		assert.equal(
			dedupeKey(pasukRow),
			dedupeKey({ ...pasukRow, surface: "אַבְרָם", intended_name: "אחר" }),
		);
	});
	it("separates pasuk and article source identities", () => {
		assert.notEqual(dedupeKey(pasukRow), dedupeKey(articleRow));
	});
});

describe("rowId", () => {
	it("produces a uuid-shaped deterministic id", () => {
		const id = rowId(dedupeKey(pasukRow));
		assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-a[0-9a-f]{3}-[0-9a-f]{12}$/);
		assert.equal(id, rowId(dedupeKey(pasukRow)));
	});
});
