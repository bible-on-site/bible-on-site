import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
	BULLETIN_DOCUMENT_PATH,
	BULLETIN_MISSING_PATH,
	createAdminFixture,
	FIXTURE_BULLETIN,
} from "./native-admin-fixture.mjs";

function clock() {
	let time = 0;
	return {
		arch: "arm64",
		now: () => time,
		sleep: async (ms) => {
			time += ms;
		},
	};
}

test("document paths bind the SHA2 of the served bytes and a validly shaped miss", () => {
	const hash = createHash("sha256")
		.update(FIXTURE_BULLETIN.pdfText, "utf8")
		.digest("hex");
	assert.equal(
		BULLETIN_DOCUMENT_PATH,
		`/api/bulletin-documents/${FIXTURE_BULLETIN.date}/${hash}.pdf`,
	);
	assert.match(
		BULLETIN_MISSING_PATH,
		/^\/api\/bulletin-documents\/\d{4}-\d{2}-\d{2}\/[a-f0-9]{64}\.pdf$/,
	);
	assert.notEqual(BULLETIN_MISSING_PATH, BULLETIN_DOCUMENT_PATH);
});

test("fixture DDL keeps the production tanah_daily_bulletin column contract", () => {
	const production = readFileSync(
		new URL("../../../data/mysql/tanah_daily_bulletin_upgrade.sql", import.meta.url),
		"utf8",
	);
	const fixture = readFileSync(
		new URL("./native-admin-fixture.sql", import.meta.url),
		"utf8",
	);
	const productionColumns =
		/TABLE IF NOT EXISTS tanah_daily_bulletin \(([\s\S]+?)\) ENGINE=InnoDB/.exec(
			production,
		)?.[1];
	assert.ok(productionColumns, "production DDL shape changed; re-check fixture");
	for (const column of productionColumns.split("\n").map((line) => line.trim()))
		assert.ok(
			fixture.includes(column),
			`fixture DDL is missing production column: ${column}`,
		);
});

test("database owns an internal bridge and server, seeds the document row, and removes volumes", async () => {
	const commands = [];
	const inputs = [];
	const fixture = await createAdminFixture((args, options) => {
		commands.push(args);
		if (options?.input) {
			inputs.push(options.input);
			return options.input === "SELECT 1;" ? "1" : "";
		}
		return "";
	}, clock());
	const run = commands.find((args) => args[0] === "run");
	assert.equal(run.at(-1), "mysql:8.4");
	assert.ok(
		commands.some(
			(args) => args[0] === "network" && args.includes("--internal"),
		),
	);
	assert.equal(run[run.indexOf("--platform") + 1], "linux/arm64");
	assert.ok(!run.includes("--publish") && !run.includes("host"));
	assert.ok(
		inputs.some(
			(sql) =>
				sql.includes("CREATE TABLE tanah_daily_bulletin") &&
				sql.includes("pdf_data MEDIUMBLOB NOT NULL"),
		),
	);
	const inserted = inputs.find((sql) =>
		sql.includes("INSERT INTO tanah_daily_bulletin"),
	);
	const pdfHex = Buffer.from(FIXTURE_BULLETIN.pdfText, "utf8").toString("hex");
	assert.ok(
		inserted.includes(`X'${pdfHex}'`) &&
			inserted.includes(FIXTURE_BULLETIN.date) &&
			inserted.includes(FIXTURE_BULLETIN.filename),
	);
	assert.equal(new URL(fixture.databaseUrl).pathname, "/native_image_smoke");
	fixture.cleanup();
	assert.deepEqual(commands.at(-2).slice(0, 3), ["rm", "--force", "--volumes"]);
	assert.deepEqual(commands.at(-1).slice(0, 2), ["network", "rm"]);
});

test("failed initialization has a fixed budget and removes only the owned server and bridge", async (t) => {
	t.mock.method(console, "error", () => {});
	const commands = [];
	await assert.rejects(
		createAdminFixture((args, options) => {
			commands.push(args);
			if (options?.input) throw new Error("cannot connect");
			if (args[0] === "inspect") return "true";
			return "";
		}, clock()),
		/within 30000 ms/,
	);
	const owned = commands.find((args) => args[0] === "run")[3];
	assert.ok(commands.some((args) => args[0] === "rm" && args.at(-1) === owned));
	assert.equal(commands.at(-1)[1], "rm");
});

test("seeding error survives cleanup failure and network cleanup is still attempted", async (t) => {
	t.mock.method(console, "error", () => {});
	const commands = [];
	await assert.rejects(
		createAdminFixture((args, options) => {
			commands.push(args);
			if (options?.input) {
				if (options.input === "SELECT 1;") return "1";
				throw new Error("bad fixture schema");
			}
			if (args[0] === "rm") throw new Error("cleanup failed");
			return "";
		}, clock()),
		/bad fixture schema/,
	);
	assert.deepEqual(commands.at(-1).slice(0, 2), ["network", "rm"]);
});
