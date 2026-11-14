import assert from "node:assert/strict";
import { test } from "node:test";
import { createApiFixture } from "./native-api-fixture.mjs";

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

test("database owns an internal bridge and server, uses production TIMESTAMP schema and synthetic rows, and removes volumes", async () => {
	const commands = [];
	const inputs = [];
	const fixture = await createApiFixture((args, options) => {
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
		inputs.some((sql) => sql.includes("`created_at` timestamp NOT NULL")),
	);
	assert.ok(
		inputs.some(
			(sql) =>
				sql.includes("INSERT INTO tanah_article") &&
				sql.includes("Ongoing fixture"),
		),
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
		createApiFixture((args, options) => {
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
		createApiFixture((args, options) => {
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

test("retrain lock release kills only the positively observed numeric session", async () => {
	const commands = [];
	const fixture = await createApiFixture((args, options) => {
		commands.push({ args, input: options?.input });
		if (options?.input === "SELECT 1;") return "1";
		if (
			[
				"SELECT connection_id FROM native_fixture_lock_owner;",
				"SELECT IS_USED_LOCK('article_search_retrain');",
			].includes(options?.input)
		)
			return "42";
		return "";
	}, clock());
	const release = await fixture.holdRetrainLock();
	release();
	assert.ok(commands.some(({ input }) => input === "KILL CONNECTION 42;"));
	fixture.cleanup();
});
