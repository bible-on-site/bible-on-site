import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const tables = {
	tanah_helek: { keys: ["id"], columns: ["name", "sefer_id_from", "sefer_id_to"] },
	tanah_sefer: {
		keys: ["id"],
		columns: ["name", "tanach_us_name", "perek_id_from", "perek_id_to"],
	},
	tanah_perek: { keys: ["id"], columns: ["perek", "header", "pasuk_count"] },
	tanah_additional: {
		keys: ["id"],
		columns: ["sefer_id", "letter", "tanach_us_name", "perek_from", "perek_to"],
	},
	tanah_perek_date: {
		keys: ["perek_id", "cycle"],
		columns: ["date", "hebdate", "star_rise"],
	},
};
type Table = keyof typeof tables;
const names = Object.keys(tables) as Table[];
const stage = (table: Table) => `canonical_stage_${table}`;
const generatedInsert =
	/^INSERT INTO ([a-z_]+)\s*\(([a-z_,\s]+)\)\s*VALUES\s*\(\s*((?:-?[0-9]+|NULL|N?'(?:[^'\\\r\n]|\\[^\r\n]|'')*')(?:\s*,\s*(?:-?[0-9]+|NULL|N?'(?:[^'\\\r\n]|\\[^\r\n]|'')*'))*)\s*\)$/;

function generatedStatements(sql: string) {
	return sql
		.replace(/^--[^\r\n]*\r?\n/gm, "")
		.split(/;\r?\n|;$/)
		.map((line) => line.trim())
		.filter(Boolean)
		.filter((line) => !/^SET FOREIGN_KEY_CHECKS = [01]$/.test(line));
}

// The original structure also serves the disposable database bootstrap. Use
// its table definitions without its resets or the view that assumes the later
// pasuk-count migration has already run.
function prepareStructure(sql: string) {
	const definitions = [...sql.matchAll(/^CREATE TABLE `([a-z_]+)` \([\s\S]*?^\) ENGINE = InnoDB[^;]*;/gm)];
	assert.deepEqual(definitions.map((match) => match[1]), names);
	return definitions
		.map(([definition]) =>
			definition.replace("CREATE TABLE ", "CREATE TABLE IF NOT EXISTS "),
		)
		.join("\n");
}

function stageReferenceRows(sql: string) {
	const loaded = new Set<Table>();
	let nextAdditionalId = 1;
	const inserts = generatedStatements(sql).map((line) => {
		const match = generatedInsert.exec(line);
		assert.ok(match && Object.hasOwn(tables, match[1]), "Unexpected canonical insert");
		const [, rawTable, columns, values] = match;
		const table = rawTable as Table;
		const { keys, columns: fields } = tables[table];
		const generated = columns.split(",").map((field) => field.trim());
		const expected = [...keys, ...fields];
		// Older generated chapter rows omit pasuk_count. The separate count file
		// fills the stage before any live records are written.
		if (table === "tanah_perek" && generated.length === expected.length - 1) {
			expected.pop();
		}
		if (table === "tanah_additional") expected.shift();
		assert.deepEqual(generated, expected, `Unexpected ${table} insert columns`);
		loaded.add(table);
		// Preserve the IDs allocated in source order by the original bootstrap.
		if (table === "tanah_additional") {
			return `INSERT INTO ${stage(table)} (id, ${generated.join(", ")}) VALUES (${nextAdditionalId++}, ${values});`;
		}
		return `INSERT INTO ${stage(table)} (${generated.join(", ")}) VALUES (${values});`;
	});
	assert.equal(loaded.size, names.length, "Missing canonical reference data");
	return [
		...names.map((table) => `CREATE TEMPORARY TABLE ${stage(table)} LIKE ${table};`),
		...inserts,
	].join("\n");
}

function mergeReferenceRows(sql: string) {
	const ids = new Set<number>();
	const counts = generatedStatements(sql).map((line) => {
		const match = /^UPDATE tanah_perek SET pasuk_count = ([1-9][0-9]*) WHERE id = ([1-9][0-9]*)$/.exec(line);
		assert.ok(match, "Unexpected canonical pasuk count update");
		const id = Number(match[2]);
		assert.ok(id <= 929 && !ids.has(id), "Unexpected canonical pasuk count identity");
		ids.add(id);
		return `UPDATE ${stage("tanah_perek")} SET pasuk_count = ${match[1]} WHERE id = ${match[2]};`;
	});
	assert.equal(ids.size, 929, "Missing canonical pasuk counts");
	const chapters = stage("tanah_perek");
	return [
		...counts,
		"CREATE TEMPORARY TABLE canonical_stage_complete (complete TINYINT NOT NULL CONSTRAINT canonical_reference_is_complete CHECK (complete = 1));",
		`INSERT INTO canonical_stage_complete SELECT COUNT(*) = 929 AND MIN(id) = 1 AND MAX(id) = 929 AND COUNT(pasuk_count) = 929 FROM ${chapters};`,
		`INSERT INTO canonical_stage_complete SELECT COUNT(*) = ${names.length} FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND ENGINE = 'InnoDB' AND TABLE_NAME IN (${names.map((table) => `'${table}'`).join(", ")});`,
		"SET FOREIGN_KEY_CHECKS = 1;",
		"START TRANSACTION;",
		...names.map((table) => {
			const { keys, columns } = tables[table];
			const fields = [...keys, ...columns];
			return `INSERT INTO ${table} (${fields.join(", ")})\nSELECT ${fields.map((field) => `incoming.${field}`).join(", ")} FROM ${stage(table)} AS incoming\nON DUPLICATE KEY UPDATE ${columns.map((field) => `${field} = incoming.${field}`).join(", ")};`;
		}),
		"INSERT INTO canonical_stage_complete SELECT COUNT(*) = 929 AND COUNT(DISTINCT perek_id) = 929 AND MIN(perek_id) = 1 AND MAX(perek_id) = 929 AND COUNT(pasuk_count) = 929 FROM tanah_perek_view;",
		"COMMIT;",
		"DROP TEMPORARY TABLE canonical_stage_complete;",
		...names.map((table) => `DROP TEMPORARY TABLE ${stage(table)};`),
	].join("\n");
}

export function prepareCanonicalReferenceSQL(name: string, source: Buffer) {
	switch (name) {
		case "tanah_static_structure.sql":
			return Buffer.from(prepareStructure(source.toString("utf8")));
		case "tanah_sefarim_and_perakim_data.sql":
			return Buffer.from(stageReferenceRows(source.toString("utf8")));
		case "tanah_perek_pasuk_count_data.sql":
			return Buffer.from(mergeReferenceRows(source.toString("utf8")));
		default:
			return source;
	}
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	const [, , name, file] = process.argv;
	process.stdout.write(prepareCanonicalReferenceSQL(name, readFileSync(file)));
}
