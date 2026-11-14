// Own the entire database server: a schema alone cannot isolate MySQL named locks.
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

export async function createApiFixture(docker, { arch, now, sleep }) {
	const identity = `native-api-fixture-${randomUUID()}`;
	const network = `${identity}-network`;
	const name = `${identity}-mysql`;
	const password = randomBytes(24).toString("hex");
	let networkCreated = false;
	let containerCreated = false;
	const sql = (input) =>
		docker(
			[
				"exec",
				"--interactive",
				"--env",
				`MYSQL_PWD=${password}`,
				name,
				"mysql",
				"--user=root",
				"--host=127.0.0.1",
				"--batch",
				"--skip-column-names",
				"native_image_smoke",
			],
			{ input },
		);
	const cleanup = () => {
		const errors = [];
		if (containerCreated) {
			try {
				docker(["rm", "--force", "--volumes", name]);
			} catch (error) {
				errors.push(error);
			}
		}
		if (networkCreated) {
			try {
				docker(["network", "rm", network]);
			} catch (error) {
				errors.push(error);
			}
		}
		if (errors.length)
			throw new AggregateError(errors, "Could not clean the owned API fixture");
	};
	try {
		// No host ports, credentials from the environment, or outbound network route.
		networkCreated = true;
		docker(["network", "create", "--internal", network]);
		containerCreated = true;
		docker([
			"run",
			"--detach",
			"--name",
			name,
			"--platform",
			`linux/${arch}`,
			"--network",
			network,
			"--cpus",
			"1",
			"--memory",
			"768m",
			"--env",
			`MYSQL_ROOT_PASSWORD=${password}`,
			"--env",
			"MYSQL_ROOT_HOST=%",
			"--env",
			"MYSQL_DATABASE=native_image_smoke",
			"mysql:8.4",
		]);
		const deadline = now() + 30_000;
		let lastError;
		while (true) {
			try {
				assert.equal(sql("SELECT 1;"), "1");
				break;
			} catch (error) {
				lastError = error;
				assert.equal(
					docker(["inspect", "--format", "{{.State.Running}}", name]),
					"true",
					"Isolated MySQL exited",
				);
				if (now() >= deadline)
					throw new Error("Isolated MySQL did not initialize within 30000 ms", {
						cause: lastError,
					});
				await sleep(250);
			}
		}
		for (const path of [
			"./native-api-fixture.sql",
			"../../../data/mysql/tanah_dynamic_structure.sql",
			"./native-api-fixture-rows.sql",
		]) {
			sql(readFileSync(new URL(path, import.meta.url), "utf8"));
		}
		return {
			network,
			sql,
			cleanup,
			databaseUrl: `mysql://root:${password}@${name}:3306/native_image_smoke`,
			stopDatabase() {
				docker(["stop", "--time", "1", name]);
			},
			async holdRetrainLock() {
				sql("DELETE FROM native_fixture_lock_owner;");
				docker([
					"exec",
					"--detach",
					"--env",
					`MYSQL_PWD=${password}`,
					name,
					"mysql",
					"--user=root",
					"--host=127.0.0.1",
					"--database=native_image_smoke",
					"--execute",
					"SET @acquired = GET_LOCK('article_search_retrain', 0); INSERT INTO native_fixture_lock_owner SELECT CONNECTION_ID() WHERE @acquired = 1; DO SLEEP(30);",
				]);
				const until = now() + 2_000;
				while (now() < until) {
					const owner = sql(
						"SELECT connection_id FROM native_fixture_lock_owner;",
					);
					if (/^[1-9][0-9]*$/.test(owner))
						return () => {
							assert.equal(
								sql("SELECT IS_USED_LOCK('article_search_retrain');"),
								owner,
								"The exact fixture session must still hold the retrain lock",
							);
							sql(`KILL CONNECTION ${owner};`);
						};
					await sleep(50);
				}
				throw new Error("Fixture failed to acquire the retrain lock");
			},
		};
	} catch (error) {
		try {
			cleanup();
		} catch (cleanupError) {
			console.error(cleanupError);
		}
		throw error;
	}
}
