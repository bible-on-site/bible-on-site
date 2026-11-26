import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { performance } from "node:perf_hooks";
import { setTimeout as sleep } from "node:timers/promises";
import stableStringify from "fast-json-stable-stringify";
import { API_ORIGINS, HTTP_BUDGET_MS } from "./api-public-transport.mjs";

const uuid =
	/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const CONTENT_CONTRACT_QUERIES = {
	article: "query {articleById(id:495){id name abstract articleContent}}",
	chapters: "query {perakim{perekId compiledSource}}",
	dedications:
		"query {dedications(context:{perekIds:[1]}){id expiresAt scopes{kind expiresAt}}}",
};
const SEARCH_CONTRACT_LIMIT = 10;
const SEARCH_CONTRACT_QUERIES = {
	searchShabbat: `query {searchArticles(phrase:"שבת",limit:${SEARCH_CONTRACT_LIMIT}){total hits{articleId score}}}`,
	searchBereshit: `query {searchArticles(phrase:"בראשית",limit:${SEARCH_CONTRACT_LIMIT}){total hits{articleId score}}}`,
};
export const CONTRACT_QUERIES = {
	...CONTENT_CONTRACT_QUERIES,
	...SEARCH_CONTRACT_QUERIES,
};
const routes = API_ORIGINS.flatMap((origin) => [
	{ origin, path: "/health", status: "ok" },
	{ origin, path: "/health/ready", status: "ready" },
	{ origin, path: "/", query: "query { perakim { perekId } }" },
]);
export const healthRoutes = routes
	.filter((route) => !route.query)
	.map(({ origin, path }) => origin + path);
const sha = (value) =>
	createHash("sha256").update(stableStringify(value)).digest("hex");

function assertSearchContract(result, name) {
	assert.ok(
		Number.isSafeInteger(result?.total) &&
			result.total >= SEARCH_CONTRACT_LIMIT &&
			Array.isArray(result.hits) &&
			result.hits.length === SEARCH_CONTRACT_LIMIT,
		`Public search contract returned an incomplete page (${name})`,
	);
	const articleIds = new Set();
	let previousScore = 1;
	for (const hit of result.hits) {
		assert.ok(
			Number.isSafeInteger(hit?.articleId) &&
				hit.articleId > 0 &&
				!articleIds.has(hit.articleId) &&
				Number.isFinite(hit.score) &&
				hit.score > 0 &&
				hit.score <= previousScore,
			`Public search contract returned invalid ranked hits (${name})`,
		);
		articleIds.add(hit.articleId);
		previousScore = hit.score;
	}
}

export class PublicAPIMonitor {
	constructor({
		request,
		versions,
		record = () => {},
		now = () => performance.now(),
		wait = sleep,
	}) {
		assert.ok(
			versions.length &&
				versions.every((value) => /^\d+\.\d+\.\d+$/.test(value)),
		);
		this.request = request;
		this.versions = new Set(versions);
		this.record = record;
		this.now = now;
		this.wait = wait;
		this.rows = [];
		this.running = false;
	}
	async read(route) {
		const started = this.now();
		const response = await this.request(route.origin + route.path, {
			redirect: "error",
			signal: AbortSignal.timeout(HTTP_BUDGET_MS),
			...(route.query
				? {
						method: "POST",
						headers: { "content-type": "application/json" },
						body: stableStringify({ query: route.query }),
					}
				: {}),
		});
		const data = await response.json();
		assert.ok(
			this.now() - started <= HTTP_BUDGET_MS,
			"Public request exceeded 2s",
		);
		assert.equal(
			response.status,
			200,
			"Public API returned an unsuccessful status",
		);
		if (data.errors !== undefined) {
			const error = new Error("Public GraphQL returned errors");
			error.code = "PUBLIC_GRAPHQL_ERRORS";
			throw error;
		}
		return {
			data,
			instance: response.headers.get("x-tanahpedia-instance"),
			elapsedMs: this.now() - started,
		};
	}
	async sample(index) {
		// Rotate each cycle so a six-route probe cannot lock to the parity of
		// a two-task round robin and miss one process on a particular route.
		const route =
				routes[(index + Math.floor(index / routes.length)) % routes.length],
			at = this.now();
		let row;
		try {
			const { data, instance, elapsedMs } = await this.read(route);
			if (route.query) {
				const chapters = data.data?.perakim;
				const ids = Array.isArray(chapters)
					? chapters.map((item) => Number(item?.perekId)).sort((a, b) => a - b)
					: [];
				if (ids.length !== 929 || !ids.every((id, i) => id === i + 1)) {
					throw Object.assign(new Error("Public chapter identities changed"), {
						code: "PUBLIC_CHAPTER_IDENTITIES",
						chapterCount: ids.length,
					});
				}
			} else {
				assert.deepEqual(Object.keys(data).sort(), ["status", "version"]);
				assert.equal(data.status, route.status);
				assert.ok(
					this.versions.has(data.version),
					"Unexpected public API version",
				);
				if (instance !== null)
					assert.match(instance, uuid, "Invalid public process marker");
			}
			row = {
				passed: true,
				at,
				route: route.origin + route.path,
				elapsedMs,
				...(!route.query
					? { version: data.version, instance }
					: { chapters: 929 }),
			};
		} catch (error) {
			row = {
				passed: false,
				at,
				route: route.origin + route.path,
				elapsedMs: this.now() - at,
				error: {
					name: error.name,
					code: error.code ?? null,
					...(error.code === "PUBLIC_CHAPTER_IDENTITIES" &&
					Number.isSafeInteger(error.chapterCount)
						? { chapterCount: error.chapterCount }
						: {}),
				},
			};
		}
		this.rows.push(row);
		this.record("public-sample", row);
		return row;
	}
	assertHealthy(since = 0) {
		assert.ok(
			!this.rows.slice(since).some((row) => !row.passed),
			"A public handover sample failed",
		);
	}
	instance(version, excluded = null, since = 0, allRoutes = true) {
		const seen = new Map();
		for (const row of this.rows.slice(since)) {
			if (
				!row.passed ||
				row.version !== version ||
				!row.instance ||
				row.instance === excluded
			)
				continue;
			if (!seen.has(row.instance)) seen.set(row.instance, new Set());
			seen.get(row.instance).add(row.route);
		}
		const complete = [...seen].filter(([, hits]) =>
			allRoutes
				? healthRoutes.every((route) => hits.has(route))
				: API_ORIGINS.every((origin) =>
						[...hits].some((route) => route.startsWith(origin + "/")),
					),
		);
		assert.ok(
			complete.length <= 1,
			"Multiple replacement process markers appeared",
		);
		return complete[0]?.[0] ?? null;
	}
	sawProcess(version, instance, since = 0) {
		const hits = new Set(
			this.rows
				.slice(since)
				.filter(
					(row) =>
						row.passed && row.version === version && row.instance === instance,
				)
				.map((row) => row.route),
		);
		return healthRoutes.every((route) => hits.has(route));
	}
	async baseline() {
		assert.ok(!this.running);
		const first = await this.read({ origin: API_ORIGINS[0], path: "/health" });
		const version = first.data.version;
		assert.match(version, /^\d+\.\d+\.\d+$/);
		this.versions.add(version);
		for (let i = 0; i < routes.length; i++) await this.sample(i);
		this.assertHealthy();
		const rows = this.rows.filter((row) => row.version);
		assert.ok(rows.every((row) => row.version === version));
		assert.equal(
			new Set(rows.map((row) => row.instance)).size,
			1,
			"Baseline spans multiple processes",
		);
		return { instance: rows[0].instance, version };
	}
	start() {
		assert.ok(!this.running);
		this.running = true;
		this.loop = (async () => {
			let index = 0;
			while (this.running) {
				const started = this.now();
				await this.sample(index++);
				if (this.running)
					await this.wait(Math.max(0, 1000 - (this.now() - started)));
			}
		})().catch((error) => {
			this.running = false;
			const row = {
				passed: false,
				at: this.now(),
				route: "public-monitor",
				error: { name: error.name, code: error.code ?? null },
			};
			this.rows.push(row);
			this.record("public-sample", row);
		});
	}
	async stop() {
		this.running = false;
		await this.loop;
	}
	async contracts(version, expected = null, instance = null) {
		const results = [];
		for (const origin of API_ORIGINS) {
			for (const [path, status] of [
				["/health", "ok"],
				["/health/ready", "ready"],
			]) {
				const { data, instance: actualInstance } = await this.read({
					origin,
					path,
				});
				assert.deepEqual(data, { status, version });
				if (instance !== null)
					assert.equal(
						actualInstance,
						instance,
						"Public contract reached the wrong process",
					);
			}
			const hashes = {};
			for (const [name, query] of Object.entries(CONTRACT_QUERIES)) {
				const { data } = await this.read({ origin, path: "/", query });
				if (name === "article") assert.equal(data.data.articleById.id, 495);
				if (name === "chapters") {
					assert.deepEqual(
						data.data.perakim.map((row) => row.perekId).sort((a, b) => a - b),
						Array.from({ length: 929 }, (_, i) => i + 1),
					);
				}
				if (Object.hasOwn(SEARCH_CONTRACT_QUERIES, name))
					assertSearchContract(data.data?.searchArticles, name);
				hashes[name] = sha(data.data);
			}
			results.push({ origin, hashes });
		}
		this.record("public-contracts", { version, requests: 14, results });
		assert.deepEqual(
			results[0].hashes,
			results[1].hashes,
			"Public alias contracts differ",
		);
		// A rebuild can change relevance scores even when the API version is
		// unchanged. Check ranked results above and require both aliases to
		// agree, then compare the content contracts with the pre-rollout values.
		if (expected) {
			for (const { origin, hashes } of results) {
				const prior = expected.find((result) => result.origin === origin);
				assert.ok(prior, "Public contract baseline is missing an alias");
				for (const name of Object.keys(CONTENT_CONTRACT_QUERIES))
					assert.equal(
						hashes[name],
						prior.hashes[name],
						`Public content contracts changed during deployment (${name})`,
					);
			}
		}
		return results;
	}
}
