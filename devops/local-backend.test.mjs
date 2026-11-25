import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { startDockerBackend } from "./local-backend.mjs";

test("Compose MySQL becomes healthy before the API starts with a TLS URL on the same network", () => {
	const calls = [];
	const env = { COMPOSE_PROJECT_NAME: "fixture", LOCAL_MYSQL_PORT: "13306" };
	startDockerBackend((...call) => calls.push(call), {
		composeMysql: true,
		dbUrl: "mysql://root:test_123@127.0.0.1:13306/tanah-dev",
		env,
	});
	assert.equal(calls.length, 2);
	const [
		[mysqlCommand, mysqlArgs, mysqlOptions],
		[apiCommand, apiArgs, apiOptions],
	] = calls;
	assert.equal(mysqlCommand, "docker");
	assert.deepEqual(mysqlArgs, [
		"compose",
		"--profile",
		"backend",
		"--profile",
		"mysql",
		"up",
		"--detach",
		"--wait",
		"mysql",
	]);
	assert.deepEqual(mysqlOptions.env, env);
	assert.equal(apiCommand, "docker");
	assert.deepEqual(apiArgs.slice(0, 5), mysqlArgs.slice(0, 5));
	assert.equal(apiArgs.at(-1), "api");
	assert.deepEqual(apiOptions.env, {
		...env,
		LOCAL_BACKEND_DB_URL:
			"mysql://root:test_123@mysql:3306/tanah-dev?ssl-mode=REQUIRED",
	});
});

test("a separately installed database keeps its configured port and TLS mode", () => {
	const calls = [];
	startDockerBackend((...call) => calls.push(call), {
		composeMysql: false,
		dbUrl: "mysql://root:test_123@127.0.0.1:13306/tanah-dev?ssl-mode=REQUIRED",
		env: {},
	});
	assert.equal(calls.length, 1);
	assert.equal(calls[0][1].at(-1), "api");
	assert.equal(
		calls[0][2].env.LOCAL_BACKEND_DB_URL,
		"mysql://root:test_123@host.docker.internal:13306/tanah-dev?ssl-mode=REQUIRED",
	);
});

test("the API is not started if the Compose database does not become healthy", () => {
	let calls = 0;
	assert.throws(
		() =>
			startDockerBackend(
				() => {
					calls++;
					throw new Error("MySQL did not become healthy");
				},
				{ composeMysql: true, env: {} },
			),
		/MySQL did not become healthy/,
	);
	assert.equal(calls, 1);
});

test("the launcher exposes Compose MySQL and rejects using it with native mode", () => {
	const script = fileURLToPath(new URL("./local-backend.mjs", import.meta.url));
	const help = spawnSync(process.execPath, [script, "--", "--help"], {
		encoding: "utf8",
	});
	assert.ifError(help.error);
	assert.equal(help.status, 0, help.stderr);
	assert.match(help.stdout, /--compose-mysql/);

	const conflict = spawnSync(
		process.execPath,
		[script, "--native", "--compose-mysql"],
		{ encoding: "utf8" },
	);
	assert.ifError(conflict.error);
	assert.equal(conflict.status, 1);
	assert.match(conflict.stderr, /Choose either --native or --compose-mysql/);
});
