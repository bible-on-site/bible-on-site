import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { prepareCanonicalReferenceSQL } from "./canonical-reference.mts";
import { buildDeployPayload } from "./deploy-payload.mts";
import sqlFiles from "./sql-files.json" with { type: "json" };

describe("buildDeployPayload", () => {
	it("can select only the additive mention migration for schema recovery", () => {
		const migration = "tanahpedia_alter_mention_decoration.sql";
		assert.ok(sqlFiles.includes(migration));
		const payload = buildDeployPayload(
			[migration],
			"sql/schema-recovery/",
			"mysql://u:p@h:3306/db",
		);
		assert.deepEqual(payload.sql_files, [migration]);
	});

	it("carries db_url under the key the Lambda handler reads", () => {
		const payload = buildDeployPayload(
			["a.sql", "b.sql"],
			"sql/2026-10-23/",
			"mysql://u:p@h:3306/db",
		);

		assert.deepEqual(payload, {
			sql_files: ["a.sql", "b.sql"],
			s3_prefix: "sql/2026-10-23/",
			db_url: "mysql://u:p@h:3306/db",
		});
	});
});

const structure = "tanah_static_structure.sql";
const references = "tanah_sefarim_and_perakim_data.sql";
const counts = "tanah_perek_pasuk_count_data.sql";
const readSQL = (name: string) =>
	readFileSync(new URL(`../../../data/mysql/${name}`, import.meta.url));

describe("prepareCanonicalReferenceSQL", () => {
	it("keeps the output additive and checks chapter coverage before publishing it", () => {
		const schema = prepareCanonicalReferenceSQL(structure, readSQL(structure)).toString();
		assert.match(schema, /CREATE TABLE IF NOT EXISTS `tanah_perek`/);
		assert.doesNotMatch(schema, /(?:DROP|CREATE VIEW)/);
		const stage = prepareCanonicalReferenceSQL(references, readSQL(references)).toString();
		assert.match(stage, /INSERT INTO canonical_stage_tanah_perek /);
		assert.doesNotMatch(stage, /INSERT INTO tanah_perek /);
		const merge = prepareCanonicalReferenceSQL(counts, readSQL(counts)).toString();
		assert.match(merge, /START TRANSACTION;[\s\S]*FROM tanah_perek_view;\nCOMMIT;/);
		const unrelated = Buffer.from("CREATE TABLE imported_fixture (id INT);");
		assert.equal(prepareCanonicalReferenceSQL("other.sql", unrelated), unrelated);
	});

	it("rejects an unrecognized shape, missing table, or incomplete count input", () => {
		assert.throws(() => prepareCanonicalReferenceSQL(structure, Buffer.from("")));
		for (const input of [
			Buffer.from("INSERT INTO other (id) VALUES (1);"),
			Buffer.from("INSERT INTO tanah_perek (id, wrong) VALUES (1, 1);"),
			Buffer.from("INSERT INTO tanah_perek (id, perek, header, pasuk_count) VALUES (1, 1, N'opaque;quoted', 5);"),
		]) {
			assert.throws(() => prepareCanonicalReferenceSQL(references, input));
		}
		assert.throws(() => prepareCanonicalReferenceSQL(counts, Buffer.from("")), /Missing canonical pasuk counts/);
		assert.throws(() => prepareCanonicalReferenceSQL(counts, Buffer.from("UPDATE tanah_perek SET pasuk_count = 31 WHERE id = 930;")), /pasuk count identity/);
	});
});
