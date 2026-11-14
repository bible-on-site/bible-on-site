import assert from "node:assert/strict";
import { describe, it } from "node:test";
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
