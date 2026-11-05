import assert from "node:assert/strict";
import test from "node:test";
import { API_ORIGINS } from "./api-public-transport.mjs";
import {
	CONTRACT_QUERIES,
	PublicAPIMonitor,
	healthRoutes,
} from "./api-public-monitor.mjs";

export const OLD_INSTANCE = "11111111-1111-4111-8111-111111111111";
export const NEW_INSTANCE = "22222222-2222-4222-8222-222222222222";
function reverseKeys(value) {
	if (Array.isArray(value)) return value.map(reverseKeys);
	if (value && typeof value === "object")
		return Object.fromEntries(
			Object.entries(value)
				.reverse()
				.map(([key, item]) => [key, reverseKeys(item)]),
		);
	return value;
}
function fixture() {
	let at = 0;
	const calls = [],
		events = [],
		f = { version: "0.1.100", instance: OLD_INSTANCE };
	const request = async (url, options) => {
		calls.push({ url, options });
		at += f.elapsed ?? 10;
		assert.equal(options.redirect, "error");
		assert.ok(options.signal instanceof AbortSignal);
		if (f.error) throw f.error;
		let data;
		if (url.endsWith("/health")) data = { status: "ok", version: f.version };
		else if (url.endsWith("/health/ready"))
			data = { status: f.readyStatus ?? "ready", version: f.version };
		else {
			assert.equal(options.method, "POST");
			const { query } = JSON.parse(options.body);
			if (query.includes("perakim"))
				data = {
					data: {
						perakim: Array.from({ length: f.chapters ?? 929 }, (_, i) => ({
							perekId: i + 1,
							...(query.includes("compiledSource")
								? { compiledSource: "מקור" + i }
								: {}),
						})),
					},
				};
			else if (query.includes("articleById"))
				data = {
					data: {
						articleById: {
							id: f.articleId ?? 495,
							articleContent: f.content ?? "content",
							name: "name",
						},
					},
				};
			else if (query.includes("dedications"))
				data = { data: { dedications: [] } };
			else {
				assert.ok(Object.values(CONTRACT_QUERIES).includes(query));
				data = {
					data: {
						searchArticles: {
							total: 2,
							hits: [
								{ articleId: 495, score: f.score ?? 1.5 },
								{ articleId: 496, score: 1.0 },
							],
						},
					},
				};
				if (f.reverseHits) data.data.searchArticles.hits.reverse();
			}
		}
		if (f.extraKey) data.extra = true;
		if (f.graphqlError) data.errors = [{ message: "private canary" }];
		if (f.reverseObjectKeys) data = reverseKeys(data);
		const headers = new Headers();
		if (f.instance !== null) headers.set("x-tanahpedia-instance", f.instance);
		return new Response(JSON.stringify(data), {
			status: f.status ?? 200,
			headers,
		});
	};
	const monitor = new PublicAPIMonitor({
		request,
		versions: ["0.1.101"],
		now: () => at,
		record: (name, value) => events.push({ name, value }),
		wait: async (ms) => {
			at += ms;
			monitor.running = false;
		},
	});
	return Object.assign(f, { monitor, calls, events });
}

test("baseline validates both aliases and all six routes while preserving exact health JSON", async () => {
	const f = fixture();
	assert.deepEqual(await f.monitor.baseline(), {
		version: "0.1.100",
		instance: OLD_INSTANCE,
	});
	assert.equal(f.monitor.rows.length, 6);
	assert.ok(f.monitor.rows.every((row) => row.passed));
	assert.equal(f.monitor.sawProcess("0.1.100", OLD_INSTANCE), true);
	assert.equal(f.monitor.instance("0.1.100"), OLD_INSTANCE);
	assert.equal(f.monitor.instance("0.1.100", OLD_INSTANCE), null);
	assert.ok(
		f.calls.every(({ url }) =>
			API_ORIGINS.some((origin) => url.startsWith(origin)),
		),
	);
	assert.throws(
		() => new PublicAPIMonitor({ request() {}, versions: ["invalid"] }),
	);
});

test("cycle rotation observes every route through both processes under a strict two-task round robin", async () => {
	const f = fixture();
	f.version = "0.1.101";
	for (let i = 0; i < 12; i++) {
		f.instance = i % 2 ? NEW_INSTANCE : OLD_INSTANCE;
		await f.monitor.sample(i);
	}
	assert.equal(f.monitor.instance(f.version, OLD_INSTANCE), NEW_INSTANCE);
	assert.equal(f.monitor.instance(f.version, NEW_INSTANCE), OLD_INSTANCE);
	assert.equal(
		f.monitor.instance(f.version, OLD_INSTANCE, 0, false),
		NEW_INSTANCE,
	);
	f.monitor.assertHealthy();
	assert.equal(f.monitor.rows.length, 12);
});

test("bootstrap accepts an old release without process headers", async () => {
	const f = fixture();
	f.instance = null;
	assert.deepEqual(await f.monitor.baseline(), {
		version: "0.1.100",
		instance: null,
	});
	assert.equal(f.monitor.instance("0.1.100"), null);
	assert.equal(f.monitor.sawProcess("0.1.100", null), true);
});

test("new processes require observations through every health route at both aliases", async () => {
	const f = fixture();
	await f.monitor.baseline();
	const start = f.monitor.rows.length;
	f.version = "0.1.101";
	f.instance = NEW_INSTANCE;
	await f.monitor.sample(0);
	assert.equal(f.monitor.instance(f.version, OLD_INSTANCE), null);
	for (let i = 1; i < 6; i++) await f.monitor.sample(i);
	assert.equal(
		f.monitor.instance(f.version, OLD_INSTANCE, start),
		NEW_INSTANCE,
	);
	assert.equal(f.monitor.sawProcess(f.version, NEW_INSTANCE, start), true);
	assert.equal(
		f.monitor.sawProcess(f.version, NEW_INSTANCE, f.monitor.rows.length),
		false,
	);
	f.monitor.rows.push(
		...healthRoutes.map((route) => ({
			passed: true,
			route,
			version: f.version,
			instance: OLD_INSTANCE,
		})),
	);
	assert.throws(() => f.monitor.instance(f.version), /Multiple replacement/);
});

for (const [name, change, route] of [
	["HTTP 502", { status: 502 }, 0],
	["2s deadline", { elapsed: 2001 }, 0],
	["unexpected JSON key", { extraKey: true }, 0],
	["readiness failure", { readyStatus: "starting" }, 1],
	["unexpected version", { version: "0.2.0" }, 0],
	["invalid marker", { instance: "private-ip" }, 0],
	["missing chapter", { chapters: 928 }, 2],
	["GraphQL error", { graphqlError: true }, 2],
	["transport error", { error: new Error("canary must remain private") }, 0],
])
	test(name + " remains a failed sample in the journal", async () => {
		const f = fixture();
		f.monitor.versions.add(f.version);
		Object.assign(f, change);
		const row = await f.monitor.sample(route);
		assert.equal(row.passed, false);
		assert.throws(() => f.monitor.assertHealthy(), /sample failed/);
		assert.equal(JSON.stringify(f.events).includes("private"), false);
		f.status = 200;
		f.elapsed = 10;
		f.extraKey = false;
		f.readyStatus = "ready";
		f.version = "0.1.100";
		f.instance = OLD_INSTANCE;
		f.chapters = 929;
		f.graphqlError = false;
		f.error = null;
		await f.monitor.sample(route);
		f.monitor.assertHealthy(1);
		assert.equal(f.monitor.rows[0].passed, false);
	});

test("one background sample per second stops cleanly", async () => {
	const f = fixture();
	f.monitor.versions.add(f.version);
	f.monitor.start();
	await f.monitor.loop;
	await f.monitor.stop();
	assert.equal(f.monitor.rows.length, 1);
	f.monitor.assertHealthy();
});

test("fourteen contracts compare content, search ranking and scores without logging content", async () => {
	const f = fixture(),
		baseline = await f.monitor.contracts(f.version, null, OLD_INSTANCE);
	assert.equal(f.calls.length, 14);
	assert.equal(baseline.length, 2);
	f.version = "0.1.101";
	f.instance = NEW_INSTANCE;
	assert.deepEqual(
		await f.monitor.contracts(f.version, baseline, NEW_INSTANCE),
		baseline,
	);
	assert.equal(JSON.stringify(f.events).includes('"content"'), false);
	f.content = "changed";
	await assert.rejects(
		f.monitor.contracts(f.version, baseline),
		/contracts changed/,
	);
	f.articleId = 1;
	await assert.rejects(f.monitor.contracts(f.version));
});

test("contracts reject changed readiness versions, markers and chapter identities", async () => {
	const f = fixture();
	await assert.rejects(f.monitor.contracts("0.1.101"));
	await assert.rejects(
		f.monitor.contracts(f.version, null, NEW_INSTANCE),
		/wrong process/,
	);
	f.chapters = 928;
	await assert.rejects(f.monitor.contracts(f.version));
});

test("contract hashes canonicalize object keys while preserving ranking and scores", async () => {
	const f = fixture(),
		baseline = await f.monitor.contracts(f.version);
	f.reverseObjectKeys = true;
	assert.deepEqual(await f.monitor.contracts(f.version, baseline), baseline);
	f.score = 1.6;
	await assert.rejects(
		f.monitor.contracts(f.version, baseline),
		/contracts changed/,
	);
	f.score = 1.5;
	f.reverseHits = true;
	await assert.rejects(
		f.monitor.contracts(f.version, baseline),
		/contracts changed/,
	);
});

test("a background observer failure is retained and prevents a healthy result", async () => {
	const f = fixture();
	f.monitor.versions.add(f.version);
	f.monitor.wait = async () => {
		throw new Error("private observer canary");
	};
	f.monitor.start();
	await f.monitor.loop;
	assert.equal(f.monitor.running, false);
	assert.equal(f.monitor.rows.at(-1).passed, false);
	assert.throws(() => f.monitor.assertHealthy(), /sample failed/);
	assert.equal(
		JSON.stringify(f.events).includes("private observer canary"),
		false,
	);
});
