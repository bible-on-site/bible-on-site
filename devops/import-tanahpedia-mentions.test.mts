import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
	copyFileSync,
	mkdirSync,
	mkdtempSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { describe, it } from "node:test";
import {
	dedupeKey,
	rowId,
	supersedeStatement,
} from "./import-tanahpedia-mentions.mts";

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

describe("supersedeStatement", () => {
	it("deletes only pipeline-emitted states of the superseded revision", () => {
		const { sql } = supersedeStatement("old-rev@1", [pasukRow]);
		assert.match(sql, /model_revision = \?/);
		assert.match(sql, /acceptance IN \('auto','held'\)/);
	});
	it("scopes the delete to the file's source kinds, deduped", () => {
		const { sql, params } = supersedeStatement("old-rev@1", [
			pasukRow,
			articleRow,
			pasukRow,
		]);
		assert.match(sql, /source_kind IN \(\?, \?\)/);
		assert.deepEqual(params, ["old-rev@1", "pasuk", "article"]);
	});
	it("refuses to supersede the revision being imported", () => {
		assert.throws(
			() => supersedeStatement("test-model@1", [pasukRow]),
			/matches the file's own revision/,
		);
	});
});

describe("rowId", () => {
	it("produces a uuid-shaped deterministic id", () => {
		const id = rowId(dedupeKey(pasukRow));
		assert.match(
			id,
			/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-a[0-9a-f]{3}-[0-9a-f]{12}$/,
		);
		assert.equal(id, rowId(dedupeKey(pasukRow)));
	});
});

describe("annotation CLI database driver ownership", () => {
	for (const script of [
		"import-tanahpedia-mentions.mts",
		"export-tanahpedia-articles.mts",
	]) {
		for (const caller of ["repository root", "nested caller"]) {
			it(
				"loads the website driver for " +
					script +
					" from " +
					caller +
					" before validating DB_URL",
				(t) => {
					const root = mkdtempSync(join(tmpdir(), "annotation cli "));
					t.after(() => {
						assert.equal(dirname(resolve(root)), resolve(tmpdir()));
						rmSync(root, { recursive: true, force: true });
					});
					const devops = join(root, "devops");
					const website = join(root, "web", "bible-on-site");
					const nested = join(root, "nested");
					for (const directory of [devops, website, nested])
						mkdirSync(directory, { recursive: true });
					writeFileSync(join(root, "package.json"), "{}");
					writeFileSync(join(website, "package.json"), "{}");
					for (const name of [script, "website-mysql.mts"]) {
						copyFileSync(new URL(name, import.meta.url), join(devops, name));
					}
					for (const [directory, source] of [
						[root, 'throw new Error("wrong root driver");'],
						[
							website,
							'console.log("website-driver-loaded"); exports.createConnection = () => { throw new Error("must not connect"); };',
						],
					]) {
						const mysql = join(directory, "node_modules", "mysql2");
						mkdirSync(mysql, { recursive: true });
						writeFileSync(join(mysql, "promise.js"), source);
					}
					const data = join(root, "decorations.json");
					writeFileSync(data, "[]");
					const option = script.startsWith("import-")
						? "--decorations"
						: "--out";
					const result = spawnSync(
						process.execPath,
						[
							"--",
							join(devops, script),
							option,
							data,
							"--env-file",
							join(root, "missing.env"),
						],
						{
							cwd: caller === "repository root" ? root : nested,
							env: { ...process.env, DB_URL: "" },
							encoding: "utf8",
						},
					);
					assert.equal(result.status, 1, result.stderr);
					assert.equal(result.error, undefined);
					assert.match(result.stdout, /website-driver-loaded/, result.stderr);
					assert.match(result.stderr, /DB_URL not set/);
					assert.doesNotMatch(
						result.stderr,
						/wrong root driver|must not connect/,
					);
				},
			);
		}
	}
});
