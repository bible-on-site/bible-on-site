import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import {
	API_ORIGINS,
	DNSCache,
	createPublicTransport,
	parseDNSResponse,
} from "./api-public-transport.mjs";

const HOST = new URL(API_ORIGINS[0]).hostname;
const answer = (ttl = 10) => ({
	Status: 0,
	Answer: [
		{ type: 5, TTL: ttl, data: "router.example" },
		{ type: 1, TTL: 60, data: "192.0.2.1" },
	],
});

function fixture() {
	let tick = 0;
	const calls = [],
		agents = [],
		plans = [];
	class Agent {
		constructor(options) {
			this.options = options;
			agents.push(this);
		}
		destroy() {
			this.destroyed = true;
		}
	}
	const httpsClient = {
		Agent,
		request(url, options, callback) {
			const dns = url.hostname === "1.1.1.1",
				plan = dns ? {} : (plans.shift() ?? {});
			const req = new EventEmitter();
			req.reusedSocket = !dns && calls.some((row) => !row.dns);
			req.destroy = (error) => {
				queueMicrotask(() => req.emit("error", error));
			};
			req.end = (body) => {
				calls.push({ dns, url, options, body, req });
				const abort = () => req.destroy(options.signal.reason);
				options.signal.addEventListener("abort", abort, { once: true });
				async function reply() {
					try {
						if (!dns)
							await new Promise((resolve, reject) =>
								options.lookup(
									HOST,
									{ all: plan.all },
									(error, address, family) => {
										if (error) reject(error);
										else {
											req.address = address;
											req.family = family;
											resolve();
										}
									},
								),
							);
						if (plan.error) throw plan.error;
						if (plan.hang) return;
						tick += plan.elapsed ?? 1;
						const response = new EventEmitter();
						response.socket = { authorized: plan.authorized ?? true };
						response.statusCode = plan.status ?? 200;
						response.headers = {
							date: "Sun, 01 Nov 2026 00:00:00 GMT",
							"content-type": "application/json",
							...(plan.headers ?? {}),
						};
						callback(response);
						if (plan.aborted) response.emit("aborted");
						else if (plan.responseError)
							response.emit("error", plan.responseError);
						else {
							response.emit(
								"data",
								Buffer.from(
									dns
										? JSON.stringify(httpsClient.dnsAnswer ?? answer())
										: (plan.body ?? '{"ok":true}'),
								),
							);
							response.emit("end");
						}
					} catch (error) {
						req.emit("error", error);
					} finally {
						if (!plan.hang) options.signal.removeEventListener("abort", abort);
					}
				}
				queueMicrotask(reply);
			};
			return req;
		},
	};
	const transport = createPublicTransport({ httpsClient, now: () => tick });
	const request = (options = {}) =>
		transport.request(API_ORIGINS[0] + "/health", {
			signal: AbortSignal.timeout(2000),
			redirect: "error",
			...options,
		});
	return {
		transport,
		request,
		calls,
		agents,
		plans,
		httpsClient,
		advance(ms) {
			tick += ms;
		},
	};
}

test("DNS accepts only approved hosts, IPv4 records and authoritative nonnegative TTLs", () => {
	assert.deepEqual(parseDNSResponse(HOST, answer()), {
		addresses: ["192.0.2.1"],
		ttl: 10,
	});
	for (const value of [
		{ Status: 3 },
		{ Status: 0 },
		{ Status: 0, Answer: [] },
		{ Status: 0, Answer: [{ type: 28, TTL: 10, data: "::1" }] },
		{ Status: 0, Answer: [{ type: 1, TTL: -1, data: "192.0.2.1" }] },
		{ Status: 0, Answer: [{ type: 1, TTL: 0.5, data: "192.0.2.1" }] },
		{ Status: 0, Answer: [{ type: 1, TTL: 10, data: "::1" }] },
		{ Status: 0, Answer: [{ type: 5, TTL: 10, data: "alias" }] },
	])
		assert.throws(() => parseDNSResponse(HOST, value));
	assert.throws(() => parseDNSResponse("other.example", answer()));
});

test("DNS cache expires at the shortest CNAME/A TTL and never extends a zero TTL", () => {
	let now = 0;
	const cache = new DNSCache(() => now);
	assert.equal(cache.get(HOST), null);
	cache.set(HOST, ["192.0.2.1"], 10);
	now = 9999;
	assert.deepEqual(cache.get(HOST), ["192.0.2.1"]);
	now = 10000;
	assert.equal(cache.get(HOST), null);
	cache.set(HOST, ["192.0.2.1"], 0);
	assert.equal(cache.get(HOST), null);
	assert.throws(() => cache.set(HOST, [], -1));
});

test("requests preserve original SNI, verified TLS and pooled sockets with TTL cache reuse", async () => {
	const f = fixture();
	assert.deepEqual(await (await f.request()).json(), { ok: true });
	f.plans.push({ all: true, headers: { "x-example": ["one", "two"] } });
	assert.equal((await f.request()).headers.get("x-example"), "one, two");
	assert.equal(f.calls.filter((row) => row.dns).length, 1);
	const calls = f.calls.filter((row) => !row.dns);
	for (const { options, url } of calls) {
		assert.equal(url.hostname, HOST);
		assert.equal(options.servername, HOST);
		assert.equal(options.rejectUnauthorized, true);
		assert.equal(options.minVersion, "TLSv1.2");
		assert.equal(options.agent, f.agents[0]);
	}
	assert.deepEqual(calls[0].req.address, "192.0.2.1");
	assert.deepEqual(calls[1].req.address, [{ address: "192.0.2.1", family: 4 }]);
	assert.equal(f.transport.observations[1].reusedSocket, true);
	assert.equal(f.transport.dnsObservations[1].cacheHit, true);
	f.advance(10000);
	await f.request();
	assert.equal(f.calls.filter((row) => row.dns).length, 2);
	f.transport.close();
	assert.ok(
		f.agents.every((agent) => agent.destroyed && agent.options.keepAlive),
	);
});

test("POST sends exact UTF-8 length and one request, with no retries", async () => {
	const f = fixture(),
		body = JSON.stringify({ query: "שלום" });
	await f.request({
		method: "POST",
		headers: { "content-type": "application/json" },
		body,
	});
	const row = f.calls.find((row) => !row.dns);
	assert.equal(row.options.headers["content-length"], Buffer.byteLength(body));
	assert.equal(row.body, body);
	assert.equal(row.options.method, "POST");
	f.plans.push({
		error: Object.assign(new Error("reset"), { code: "ECONNRESET" }),
	});
	await assert.rejects(f.request(), /reset/);
	assert.equal(f.calls.filter((row) => !row.dns).length, 2);
	assert.equal(f.transport.observations.at(-1).error.code, "ECONNRESET");
});

test("origin, credentials, redirect mode, methods and bodies are checked before network calls", async () => {
	const f = fixture();
	for (const url of [
		"http://" + HOST,
		"https://other.example",
		"https://user:secret@" + HOST,
		API_ORIGINS[0] + "/#fragment",
	])
		await assert.rejects(
			f.transport.request(url, {
				signal: AbortSignal.timeout(2000),
				redirect: "error",
			}),
		);
	for (const options of [
		{ redirect: "follow" },
		{ signal: null },
		{ method: "DELETE" },
		{ body: 123 },
	])
		await assert.rejects(f.request(options));
	assert.equal(f.calls.length, 0);
});

for (const [name, plan] of [
	["redirect", { status: 302 }],
	["unverified certificate", { authorized: false }],
	["whole-request deadline", { elapsed: 2001 }],
	["truncated response", { aborted: true }],
	["response stream error", { responseError: new Error("stream failed") }],
	["oversized body", { body: "a".repeat(4 * 1024 * 1024 + 1) }],
])
	test(name + " fails the sample without an HTTP retry", async () => {
		const f = fixture();
		f.plans.push(plan);
		await assert.rejects(f.request());
		assert.equal(f.calls.filter((row) => !row.dns).length, 1);
		assert.ok(f.transport.observations.at(-1).error);
	});

test("invalid DNS answers are recorded and never cached", async () => {
	const f = fixture();
	f.httpsClient.dnsAnswer = { Status: 3 };
	await assert.rejects(f.request());
	await assert.rejects(f.request());
	assert.equal(f.calls.filter((row) => row.dns).length, 2);
	assert.ok(f.transport.dnsObservations.every((row) => row.error));
});

test("an otherwise valid oversized DNS document is rejected before it can enter the cache", async () => {
	const f = fixture();
	f.httpsClient.dnsAnswer = { ...answer(), padding: "a".repeat(65536) };
	await assert.rejects(f.request(), /DNS response exceeds 64 KiB/);
	assert.equal(f.calls.filter((row) => row.dns).length, 1);
	assert.equal(f.transport.dnsObservations[0].cacheHit, false);
	assert.ok(f.transport.dnsObservations[0].error);
});

test("an aborted request fails before a call and in-flight aborts preserve their reason", async () => {
	const f = fixture(),
		controller = new AbortController(),
		reason = new Error("cancelled");
	controller.abort(reason);
	await assert.rejects(f.request({ signal: controller.signal }), /cancelled/);
	assert.equal(f.calls.length, 0);
	const running = new AbortController();
	f.plans.push({ hang: true });
	const result = f.request({ signal: running.signal });
	await new Promise((resolve) => setImmediate(resolve));
	running.abort(reason);
	await assert.rejects(result, /cancelled/);
	assert.equal(f.transport.observations.at(-1).error.name, "Error");
});
