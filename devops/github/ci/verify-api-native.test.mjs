import assert from "node:assert/strict";
import { test } from "node:test";
import {
	apiPackageVersion,
	assertApiResponses,
	verifyApiRuntime,
} from "./verify-api-native.mjs";

function response() {
	return {
		data: {
			__typename: "QueryRoot",
			articleById: {
				id: 1,
				name: "Alpha orchard",
				abstract: null,
				articleContent: "<p>alpha orchard apple alpha</p>",
				coverageVerified: true,
				coveringSources: [{ perekId: 1, pasuk: 1 }],
			},
			articlesByPerekId: [{ id: 1 }, { id: 2 }, { id: 3 }],
			searchArticles: {
				total: 1,
				hits: [
					{
						articleId: 1,
						name: "Alpha orchard",
						excerpt: "alpha orchard",
						authorName: "Fixture author",
						source: "Fixture book א",
					},
				],
			},
			dedications: [null, "2099-01-02T03:04:05Z"].map((expiresAt, index) => ({
				id: index + 1,
				subject: index === 0 ? "Ongoing fixture" : "Expiring fixture",
				expiresAt,
				purposes: ["Fixture purpose"],
				scopes: [
					"ARTICLE",
					"HELEK",
					"MASORA",
					"PARASHA",
					"PEREK",
					"SEFER",
					"TANAHPEDIA_ENTRY",
				].map((kind) => ({ kind, expiresAt })),
			})),
		},
	};
}

test("API evidence requires real content, all scope/null/expiry contracts and a search hit, including HTTP-200 GraphQL errors", () => {
	const health = { status: "ok", version: "0.1.96" };
	assertApiResponses(health, response(), "0.1.96");
	for (const mutate of [
		(value) => {
			value.errors = [{ message: "driver error" }];
		},
		(value) => {
			value.data.articleById.coveringSources = [];
		},
		(value) => {
			value.data.searchArticles.hits = [];
		},
		(value) => {
			value.data.dedications[0].scopes.pop();
		},
		(value) => {
			value.data.dedications[0].expiresAt = "not null";
		},
		(value) => {
			value.data.dedications[1].scopes[0].expiresAt = null;
		},
	]) {
		const value = response();
		mutate(value);
		assert.throws(() => assertApiResponses(health, value, "0.1.96"));
	}
});

function harness({
	neverReady = false,
	cleanupFails = false,
	exited = false,
	releaseFails = false,
	lateReady = false,
	wrongVersion = false,
} = {}) {
	let clock = 0;
	let locked = false;
	let database = true;
	let trained = false;
	let updated = false;
	let publication = "stable";
	let cleaned = false;
	const commands = [];
	const failure = () => {
		const error = new Error(
			"wget: server returned error: HTTP/1.1 503 Service Unavailable",
		);
		error.stderr = error.message;
		throw error;
	};
	const fixture = {
		network: "owned-network",
		databaseUrl: "mysql://fixture-only@owned-mysql/native_image_smoke",
		holdRetrainLock: async () => {
			locked = true;
			return () => {
				locked = false;
				if (releaseFails) throw new Error("lock release error");
			};
		},
		stopDatabase: () => {
			database = false;
		},
		cleanup() {
			cleaned = true;
			if (cleanupFails) throw new Error("fixture cleanup error");
		},
		sql(statement) {
			if (statement.startsWith("CREATE TABLE native_fixture_saved_docs"))
				return "";
			if (statement.startsWith("UPDATE article_search_doc")) {
				publication = "mixed";
				return "";
			}
			if (statement.startsWith("DELETE FROM article_search_doc")) {
				publication = "empty";
				return "";
			}
			if (statement.startsWith("INSERT INTO article_search_doc")) {
				publication = "stable";
				return "";
			}

			if (statement.startsWith("UPDATE tanah_article")) {
				updated = true;
				return "";
			}
			if (statement.includes("COUNT(*)")) return "0";
			if (statement.includes("model_epoch")) return updated ? "2" : "1";
			if (statement.includes("doc_count")) return "3";
			if (statement.includes("IS_USED_LOCK")) return locked ? "42" : "NULL";
			throw new Error(`Unexpected fixture SQL ${statement}`);
		},
	};
	return {
		commands,
		cleaned: () => cleaned,
		now: () => clock,
		options: {
			image: "validation:arm64",
			expectedVersion: "0.1.96",
			arch: "arm64",
			common: [
				"run",
				"--name",
				"owned-api",
				"--cpus",
				"0.25",
				"--memory",
				"512m",
			],
			now: () => clock,
			sleep: async (ms) => {
				clock += ms;
			},
			createFixture: async () => fixture,
			docker(args) {
				commands.push(args);
				if (args[0] === "exec" && args[2] === "uname") return "aarch64";
				if (args[0] === "exec") {
					if (args.includes("http://127.0.0.1:3003/health/ready")) {
						if (
							!database ||
							neverReady ||
							(locked && !trained) ||
							(args[1] !== "owned-api" && publication !== "stable")
						)
							return failure();
						if (lateReady) clock = 31_000;
						trained = true;
						return JSON.stringify({ status: "ready", version: "0.1.96" });
					}
					if (args.includes("http://127.0.0.1:3003/health")) {
						if (exited) throw new Error("connection refused");
						return JSON.stringify({
							status: "ok",
							version: wrongVersion ? "0.1.95" : "0.1.96",
						});
					}
					if (
						args.some(
							(arg) =>
								arg.startsWith("--post-data=") && arg.includes("__typename"),
						)
					)
						return JSON.stringify(response());
					return JSON.stringify({
						data: {
							searchArticles: {
								total: 2,
								hits: [{ articleId: 1, name: "Omega orchard" }],
							},
						},
					});
				}
				if (args[0] === "inspect" && args[2] === "{{json .}}")
					return JSON.stringify({
						HostConfig: { NanoCpus: 250_000_000, Memory: 536_870_912 },
						State: { OOMKilled: false },
					});
				if (args[0] === "inspect") return exited ? "false" : "true";
				if (args[0] === "stats") return "{}";
				return "";
			},
		},
	};
}

test("full image qualification composes cold/rolling/worker/outage checks on owned network and always removes both API processes", async () => {
	const h = harness();
	const result = await verifyApiRuntime(h.options);
	assert.equal(result.isolatedDatabase, true);
	assert.equal(result.databaseFailureReturns503, true);
	assert.equal(result.livenessDuringDatabaseFailure, true);
	const launches = h.commands.filter((args) => args[0] === "run");
	assert.equal(launches.length, 4);
	assert.ok(
		launches.every(
			(args) => args[args.indexOf("--network") + 1] === "owned-network",
		),
	);
	assert.ok(
		launches.every(
			(args) => !args.includes("--publish") && !args.includes("host"),
		),
	);
	assert.equal(h.commands.filter((args) => args[0] === "rm").length, 4);
	assert.ok(h.cleaned());
});

test("startup retains the existing 30-second deadline and its failure survives cleanup errors", async (t) => {
	t.mock.method(console, "error", () => {});
	const h = harness({ neverReady: true, cleanupFails: true });
	await assert.rejects(verifyApiRuntime(h.options), /existing 30000 ms budget/);
	assert.equal(h.now(), 30_000);
	assert.ok(h.cleaned());
	assert.ok(h.commands.some((args) => args[0] === "logs"));
	assert.ok(h.commands.some((args) => args[0] === "rm"));
});

test("a successful probe arriving after the phase deadline cannot qualify the image", async (t) => {
	t.mock.method(console, "error", () => {});
	const h = harness({ lateReady: true });
	await assert.rejects(verifyApiRuntime(h.options), /existing 30000 ms budget/);
	assert.ok(h.cleaned());
});

test("a lock-release error cannot replace an exited-image failure", async (t) => {
	t.mock.method(console, "error", () => {});
	const h = harness({ exited: true, releaseFails: true });
	await assert.rejects(
		verifyApiRuntime(h.options),
		/API exited during qualification/,
	);
	assert.ok(h.cleaned());
});

test("the Cargo reader selects only one explicit package version and preserves comments/CRLF", () => {
	const source =
		'# version = "9.9.9"\r\n[package] # own\r\nname = "api"\r\nversion = "0.1.96" # compiled\r\n[dependencies]\r\nversion = "9.9.9"\r\n';
	assert.equal(apiPackageVersion(source), "0.1.96");
	assert.equal(apiPackageVersion("[package]\nversion = '0.1.96'"), "0.1.96");
	for (const invalid of [
		'[workspace]\nversion = "0.1.96"',
		"[package]\nversion.workspace = true",
		'[package]\nversion = "01.2.3"',
		'[package]\nversion = "1.2.3-beta"',
		'[package]\nversion = "1.2.3" + "bad"',
		'[package]\nversion = "1.2.3"\nversion = "1.2.3"',
		'[package]\nversion = "1.2.3"\n[package]',
	]) {
		assert.throws(() => apiPackageVersion(invalid));
	}
});

test("a completed wrong-version health response fails immediately and survives release/cleanup errors", async (t) => {
	t.mock.method(console, "error", () => {});
	const h = harness({
		wrongVersion: true,
		releaseFails: true,
		cleanupFails: true,
	});
	await assert.rejects(
		verifyApiRuntime(h.options),
		/API binary version differs/,
	);
	assert.equal(h.now(), 0, "wrong binary must not consume startup retries");
	assert.ok(h.cleaned());
	assert.equal(h.commands.filter((args) => args[0] === "run").length, 1);
});
