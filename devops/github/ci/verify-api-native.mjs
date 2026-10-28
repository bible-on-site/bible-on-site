import assert from "node:assert/strict";
import { createApiFixture } from "./native-api-fixture.mjs";

export function assertPlainVersion(value) {
	const parts = typeof value === "string" ? value.split(".") : [];
	assert.ok(
		parts.length === 3 &&
			parts.every(
				(part) =>
					part.length > 0 &&
					(part.length === 1 || part[0] !== "0") &&
					[...part].every((character) => {
						const code = character.charCodeAt(0);
						return code >= 48 && code <= 57;
					}),
			),
		"Expected version must be plain major.minor.patch",
	);
	return value;
}

// Read only the API's explicit package version; unsupported/ambiguous TOML fails closed.
export function apiPackageVersion(contents) {
	let inPackage = false;
	let foundPackage = false;
	let version;
	for (const raw of contents.split("\n")) {
		const line = raw.trim();
		if (line.startsWith("[")) {
			inPackage = line.split("#", 1)[0].trim() === "[package]";
			if (inPackage) {
				assert.ok(!foundPackage, "Duplicate Cargo package section");
				foundPackage = true;
			}
			continue;
		}
		if (!inPackage || !line || line.startsWith("#")) continue;
		const equals = line.indexOf("=");
		if (equals < 0 || line.slice(0, equals).trim() !== "version") continue;
		assert.equal(version, undefined, "Duplicate Cargo package version");
		const value = line.slice(equals + 1).trim();
		const quote = value[0];
		assert.ok(
			quote === '"' || quote === "'",
			"Cargo package version must be a string",
		);
		const end = value.indexOf(quote, 1);
		const trailing = value.slice(end + 1).trim();
		assert.ok(
			end > 1 && (!trailing || trailing.startsWith("#")),
			"Invalid Cargo package version string",
		);
		version = assertPlainVersion(value.slice(1, end));
	}
	assert.ok(
		foundPackage && version !== undefined,
		"Cargo package version is required",
	);
	return version;
}

export function assertApiVersion(health, expectedVersion) {
	assert.equal(health.status, "ok");
	assert.equal(
		health.version,
		assertPlainVersion(expectedVersion),
		"API binary version differs from the expected package version",
	);
}

export const fixtureQuery = `query {
 __typename
 articleById(id: 1) { id name abstract articleContent coverageVerified coveringSources { perekId pasuk } }
 articlesByPerekId(perekId: 1) { id }
 dedications(context: { perekIds: [1], parashaIds: [1], articleIds: [1], entryIds: ["fixture-entry"], masora: true }) {
   id subject expiresAt purposes scopes { kind expiresAt }
 }
 searchArticles(phrase: "alpha", limit: 10) { total hits { articleId name excerpt authorName source } }
}`;

export function assertApiResponses(health, graphql, expectedVersion) {
	assertApiVersion(health, expectedVersion);
	assert.equal(
		graphql.errors,
		undefined,
		"GraphQL fixture query must not return errors",
	);
	const data = graphql.data;
	assert.equal(data.__typename, "QueryRoot");
	assert.deepEqual(
		data.articlesByPerekId.map(({ id }) => id).sort(),
		[1, 2, 3],
	);
	assert.deepEqual(data.articleById, {
		id: 1,
		name: "Alpha orchard",
		abstract: null,
		articleContent: "<p>alpha orchard apple alpha</p>",
		coverageVerified: true,
		coveringSources: [{ perekId: 1, pasuk: 1 }],
	});
	assert.equal(data.searchArticles.total, 1);
	assert.deepEqual(
		data.searchArticles.hits.map(({ articleId }) => articleId),
		[1],
	);
	assert.equal(data.searchArticles.hits[0].authorName, "Fixture author");
	assert.equal(data.searchArticles.hits[0].source, "Fixture book א");
	assert.match(data.searchArticles.hits[0].excerpt, /alpha/);
	assert.equal(data.dedications.length, 2);
	for (const [index, dedication] of [...data.dedications]
		.sort((a, b) => a.id - b.id)
		.entries()) {
		assert.equal(dedication.id, index + 1);
		const expiry = index === 0 ? null : "2099-01-02T03:04:05Z";
		assert.equal(
			dedication.subject,
			index === 0 ? "Ongoing fixture" : "Expiring fixture",
		);
		assert.equal(dedication.expiresAt, expiry);
		assert.deepEqual(dedication.purposes, ["Fixture purpose"]);
		assert.deepEqual(dedication.scopes.map(({ kind }) => kind).sort(), [
			"ARTICLE",
			"HELEK",
			"MASORA",
			"PARASHA",
			"PEREK",
			"SEFER",
			"TANAHPEDIA_ENTRY",
		]);
		assert.ok(dedication.scopes.every(({ expiresAt }) => expiresAt === expiry));
	}
}

export async function verifyApiRuntime({
	docker,
	common,
	image,
	arch,
	now,
	sleep,
	expectedVersion,
	createFixture = createApiFixture,
}) {
	assertPlainVersion(expectedVersion);
	const fixture = await createFixture(docker, { arch, now, sleep });
	const initialName = common[2];
	const containers = new Set();
	let failure;
	let evidence;
	const url = "http://127.0.0.1:3003";
	const get = (name, path) =>
		JSON.parse(
			docker(["exec", name, "wget", "-T", "2", "-qO-", `${url}${path}`]),
		);
	const query = (name, text) =>
		JSON.parse(
			docker([
				"exec",
				name,
				"wget",
				"-T",
				"2",
				"-qO-",
				"--header=Content-Type: application/json",
				`--post-data=${JSON.stringify({ query: text })}`,
				`${url}/`,
			]),
		);
	const wait = async (name, deadline, probe) => {
		let lastError;
		do {
			try {
				const result = probe();
				assert.ok(
					now() <= deadline,
					"API probe exceeded the fixed phase deadline",
				);
				return result;
			} catch (error) {
				lastError = error;
				assert.equal(
					docker(["inspect", "--format", "{{.State.Running}}", name]),
					"true",
					"API exited during qualification",
				);
				if (now() >= deadline) break;
				await sleep(Math.min(250, deadline - now()));
			}
		} while (now() < deadline);
		throw new Error(
			"API phase did not succeed within the existing 30000 ms budget",
			{ cause: lastError },
		);
	};
	const launch = (name) => {
		const started = now();
		containers.add(name);
		docker([
			...common.slice(0, 2),
			name,
			...common.slice(3),
			"--detach",
			"--network",
			fixture.network,
			"-e",
			"PROFILE=prod",
			"-e",
			"HOST=0.0.0.0",
			"-e",
			"PORT=3003",
			"-e",
			`DB_URL=${fixture.databaseUrl}`,
			image,
		]);
		assert.equal(
			docker(["exec", name, "uname", "-m"]),
			arch === "amd64" ? "x86_64" : "aarch64",
		);
		return started;
	};
	const assertNotReady = (name) => {
		assert.throws(
			() => get(name, "/health/ready"),
			(error) => /503/.test(String(error.stderr ?? error.message)),
			"Readiness must return HTTP 503",
		);
		assert.equal(
			get(name, "/health").status,
			"ok",
			"Liveness must retain its existing contract",
		);
	};
	const withRetrainLock = async (operation) => {
		const release = await fixture.holdRetrainLock();
		let result;
		let error;
		try {
			result = await operation();
		} catch (cause) {
			error = cause;
		}
		try {
			release();
		} catch (releaseError) {
			if (error) console.error(releaseError);
			else error = releaseError;
		}
		if (error) throw error;
		return result;
	};
	try {
		const started = await withRetrainLock(async () => {
			const launchTime = launch(initialName);
			const health = await wait(initialName, launchTime + 30_000, () =>
				get(initialName, "/health"),
			);
			// Version mismatch is a completed HTTP result, never a startup retry.
			assertApiVersion(health, expectedVersion);
			assertNotReady(initialName);
			return launchTime;
		});
		const ready = await wait(initialName, started + 30_000, () =>
			get(initialName, "/health/ready"),
		);
		assert.equal(ready.status, "ready");
		const coldReadyMs = now() - started;
		const health = get(initialName, "/health");
		assert.equal(ready.version, health.version);
		const graphql = query(initialName, fixtureQuery);
		assertApiResponses(health, graphql, expectedVersion);
		assert.equal(
			fixture.sql("SELECT doc_count FROM article_search_state WHERE id = 1;"),
			"3",
			"Actual worker must persist its trained corpus",
		);
		const initialEpoch = Number(
			fixture.sql("SELECT model_epoch FROM article_search_state WHERE id = 1;"),
		);

		const warmName = `${initialName}-rolling`;
		const warmReadyMs = await withRetrainLock(async () => {
			const warmStarted = launch(warmName);
			const warmReady = await wait(warmName, warmStarted + 30_000, () =>
				get(warmName, "/health/ready"),
			);
			assert.equal(warmReady.status, "ready");
			const elapsed = now() - warmStarted;
			assert.notEqual(
				fixture.sql("SELECT IS_USED_LOCK('article_search_retrain');"),
				"NULL",
				"Warm readiness must succeed while the other owner still holds the lock",
			);
			assertApiResponses(
				get(warmName, "/health"),
				query(warmName, fixtureQuery),
				expectedVersion,
			);
			return elapsed;
		});
		docker(["rm", "--force", warmName]);
		containers.delete(warmName);

		// Model publication is not atomic across its state/doc statements.
		// New processes must defer mixed/empty derived rows; existing warm
		// processes must keep the prior internally consistent snapshot.
		fixture.sql(
			"CREATE TABLE native_fixture_saved_docs AS SELECT * FROM article_search_doc;",
		);
		const partialStarts = new Map();
		await withRetrainLock(async () => {
			fixture.sql(
				"UPDATE article_search_doc SET model_epoch = 0 WHERE article_id = 1;",
			);
			const partialName = `${initialName}-partial`;
			partialStarts.set(partialName, launch(partialName));
			await wait(partialName, partialStarts.get(partialName) + 30_000, () =>
				get(partialName, "/health"),
			);
			assertNotReady(partialName);
			assert.equal(get(initialName, "/health/ready").status, "ready");
			fixture.sql("DELETE FROM article_search_doc;");
			const emptyName = `${initialName}-empty-gap`;
			partialStarts.set(emptyName, launch(emptyName));
			await wait(emptyName, partialStarts.get(emptyName) + 30_000, () =>
				get(emptyName, "/health"),
			);
			assertNotReady(emptyName);
			assert.equal(get(initialName, "/health/ready").status, "ready");
			fixture.sql(
				"INSERT INTO article_search_doc SELECT * FROM native_fixture_saved_docs;",
			);
		});
		for (const [name, launchTime] of partialStarts) {
			const recovered = await wait(name, launchTime + 30_000, () =>
				get(name, "/health/ready"),
			);
			assert.equal(recovered.status, "ready");
			assertApiResponses(
				get(name, "/health"),
				query(name, fixtureQuery),
				expectedVersion,
			);
			docker(["rm", "--force", name]);
			containers.delete(name);
		}

		fixture.sql(
			"UPDATE tanah_article SET name = 'Omega orchard', content = '<p>omega orchard omega</p>' WHERE id = 1; INSERT INTO article_search_queue(article_id) VALUES (1);",
		);
		const changedAt = now();
		const changed = await wait(initialName, changedAt + 30_000, () => {
			assert.equal(
				fixture.sql(
					"SELECT COUNT(*) FROM article_search_queue WHERE article_id = 1;",
				),
				"0",
			);
			assert.ok(
				Number(
					fixture.sql(
						"SELECT model_epoch FROM article_search_state WHERE id = 1;",
					),
				) > initialEpoch,
			);
			const response = query(
				initialName,
				'query { searchArticles(phrase: "omega") { total hits { articleId name } } }',
			);
			assert.equal(response.errors, undefined);
			assert.ok(
				response.data.searchArticles.hits.some(
					(hit) => hit.articleId === 1 && hit.name === "Omega orchard",
				),
			);
			return response;
		});
		const queueUpdateMs = now() - changedAt;
		const state = JSON.parse(
			docker(["inspect", "--format", "{{json .}}", initialName]),
		);
		assert.equal(state.HostConfig.NanoCpus, 250_000_000);
		assert.equal(state.HostConfig.Memory, 512 * 1024 * 1024);
		assert.equal(state.State.OOMKilled, false);
		const resources = JSON.parse(
			docker(["stats", "--no-stream", "--format", "{{json .}}", initialName]),
		);
		fixture.stopDatabase();
		assertNotReady(initialName);
		evidence = {
			expectedVersion,
			health,
			ready,
			graphql,
			queueSearch: changed,
			coldReadyMs,
			warmReadyMs,
			queueUpdateMs,
			isolatedDatabase: true,
			incompletePublicationReturns503: true,
			warmSnapshotSurvivesPublication: true,
			databaseFailureReturns503: true,
			livenessDuringDatabaseFailure: true,
			resourceLimits: { cpu: 0.25, memoryBytes: state.HostConfig.Memory },
			resourceSnapshot: resources,
		};
	} catch (error) {
		failure = error;
		for (const name of containers) {
			try {
				console.error(docker(["logs", name]));
			} catch (logsError) {
				console.error(logsError);
			}
		}
	} finally {
		const errors = [];
		for (const name of containers) {
			try {
				docker(["rm", "--force", name]);
			} catch (error) {
				errors.push(error);
			}
		}
		try {
			fixture.cleanup();
		} catch (error) {
			errors.push(error);
		}
		if (errors.length) {
			const cleanupError = new AggregateError(
				errors,
				"API qualification cleanup failed",
			);
			if (failure) console.error(cleanupError);
			else failure = cleanupError;
		}
	}
	if (failure) throw failure;
	return evidence;
}
