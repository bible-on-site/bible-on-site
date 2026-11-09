import assert from "node:assert/strict";
import { test } from "node:test";
import {
	inboundConnections,
	reportImageSnapshotter,
	startReadinessProbe,
} from "./start-server.mjs";

test("inbound connection counting keeps live non-loopback sockets only", async () => {
	const table = [
		"  sl  local_address rem_address   st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode",
		// LISTEN on the server port: excluded state.
		"   0: 00000000:0BB8 00000000:0000 0A 00000000:00000000 00:00000000 00000000  1001        0 1 1 0000000000000000 100 0 0 10 0",
		// ESTABLISHED from the router address: counted.
		"   1: 00000000:0BB8 0B200AAC:01BB 01 00000000:00000000 02:00000000 00000000  1001        0 2 1 0000000000000000 20 4 30 10 -1",
		// SYN_RECV from another client: counted.
		"   2: 00000000:0BB8 0B210AAC:C001 03 00000000:00000000 00:00000000 00000000  1001        0 3 1 0000000000000000 20 4 30 10 -1",
		// ESTABLISHED from loopback (container health check): not counted.
		"   3: 0100007F:0BB8 0100007F:99AA 01 00000000:00000000 00:00000000 00000000  1001        0 4 1 0000000000000000 20 4 30 10 -1",
		// TIME_WAIT from the router: bytes are exchanged; must not hold the drain.
		"   4: 00000000:0BB8 0B200AAC:01BB 06 00000000:00000000 03:00000000 00000000  1001        0 5 1 0000000000000000 20 4 30 10 -1",
		// ESTABLISHED on a different local port: not ours.
		"   5: 00000000:1F90 0B200AAC:01BB 01 00000000:00000000 00:00000000 00000000  1001        0 6 1 0000000000000000 20 4 30 10 -1",
		// CLOSE_WAIT still counts: the response may not be flushed.
		"   6: 00000000:0BB8 0B220AAC:7788 08 00000000:00000000 00:00000000 00000000  1001        0 7 1 0000000000000000 20 4 30 10 -1",
		"",
	].join("\n");
	const missing = Object.assign(new Error("no table"), { code: "ENOENT" });
	assert.equal(
		await inboundConnections(3000, {
			read: async (file) =>
				file === "/proc/net/tcp" ? table : Promise.reject(missing),
		}),
		3,
	);
	const ipv6Table = [
		// ESTABLISHED v6 client: counted.
		"   0: 00000000000000000000000000000000:0BB8 2A000000000000000000000000000001:1234 01 00000000:00000000 00:00000000 00000000  1001        0 1 1 0000000000000000 20 4 30 10 -1",
		// ::1 remote (health check): not counted.
		"   1: 00000000000000000000000000000000:0BB8 00000000000000000000000001000000:1234 01 00000000:00000000 00:00000000 00000000  1001        0 2 1 0000000000000000 20 4 30 10 -1",
		// v4-mapped loopback remote: not counted.
		"   2: 00000000000000000000000000000000:0BB8 0000000000000000FFFF00000100007F:1234 01 00000000:00000000 00:00000000 00000000  1001        0 3 1 0000000000000000 20 4 30 10 -1",
	].join("\n");
	assert.equal(
		await inboundConnections(3000, {
			read: async (file) => (file === "/proc/net/tcp6" ? ipv6Table : "  sl\n"),
		}),
		1,
	);
	// A missing IPv4 table is an unreadable metric, not an empty one.
	await assert.rejects(
		inboundConnections(3000, { read: async () => Promise.reject(missing) }),
		{ code: "ENOENT" },
	);
	await assert.rejects(inboundConnections(70_000), RangeError);
});

test("snapshotter evidence logs only the allowed loader field", async () => {
	for (const Snapshotter of ["soci", "overlayfs"]) {
		const lines = [];
		assert.equal(
			await reportImageSnapshotter({
				uri: "http://169.254.170.2/v4/owned-container",
				request: async (url, options) => {
					assert.equal(url.hostname, "169.254.170.2");
					assert.equal(options.redirect, "error");
					assert.ok(options.signal);
					return Response.json({
						Snapshotter,
						LogOptions: { private: "never log" },
						ContainerARN: "private task",
					});
				},
				log: (line) => lines.push(line),
			}),
			true,
		);
		assert.deepEqual(lines, [
			JSON.stringify({ websiteImageSnapshotter: Snapshotter }),
		]);
	}
});
test("metadata diagnostics reject foreign addresses, redirects and unknown loader values", async () => {
	for (const uri of [
		"",
		"http://other.example/v4/container",
		"https://169.254.170.2/v4/container",
		"http://user@169.254.170.2/v4/container",
		"http://169.254.170.2:8000/v4/container",
		"http://169.254.170.2/v4/container?extra=1",
		"http://169.254.170.2/v4/container#fragment",
		"http://169.254.170.2/task",
		"not a url",
	]) {
		assert.equal(
			await reportImageSnapshotter({
				uri,
				request: async () => {
					throw new Error("must not request");
				},
				log: () => assert.fail("must not log"),
			}),
			false,
		);
	}
	for (const response of [
		new Response(null, { status: 302 }),
		new Response(null),
		Response.json({ Snapshotter: "unrecognized" }),
		new Response("malformed"),
		new Response(" ".repeat(64 * 1024 + 1)),
	]) {
		assert.equal(
			await reportImageSnapshotter({
				uri: "http://169.254.170.2/v4/container",
				request: async () => response,
				log: () => assert.fail("must not log"),
			}),
			false,
		);
	}
	assert.equal(
		await reportImageSnapshotter({
			uri: "http://169.254.170.2/v4/container",
			request: async () => {
				throw new Error("bounded transport failure");
			},
			log: () => assert.fail("must not log"),
		}),
		false,
	);
});

test("readiness probe retries refused connections and logs the first response once", async () => {
	let attempts = 0;
	const lines = [];
	const warnings = [];
	let clock = 1_000;
	const stop = startReadinessProbe({
		port: 3000,
		request: async (url, options) => {
			assert.equal(url, "http://127.0.0.1:3000/api/health/ready");
			assert.ok(options.signal instanceof AbortSignal);
			attempts += 1;
			if (attempts < 3) throw new Error("connect ECONNREFUSED");
			clock += 400; // response lands 400ms after the probe started
			return Response.json({ status: "ready" });
		},
		sleep: async () => {},
		now: () => clock,
		log: (line) => lines.push(line),
		warn: (...args) => warnings.push(args),
	});
	const deadline = Date.now() + 2_000;
	while (lines.length === 0) {
		if (Date.now() > deadline) throw new Error("probe never logged");
		await new Promise((resolve) => setTimeout(resolve, 5));
	}
	await new Promise((resolve) => setTimeout(resolve, 20));
	assert.deepEqual(lines, ["Website readiness probe: HTTP 200 after 400ms"]);
	assert.equal(attempts, 3);
	// Identical boot-time refusals collapse into a single warning.
	assert.equal(warnings.length, 1);
	assert.match(String(warnings[0][0]), /attempt failed/);
	stop();
});

test("readiness probe warns once per distinct failure", async () => {
	const warnings = [];
	let attempts = 0;
	const stop = startReadinessProbe({
		port: 3000,
		request: async () => {
			attempts += 1;
			if (attempts === 1 || attempts === 2)
				throw new Error("connect ECONNREFUSED");
			if (attempts === 3) throw new Error("socket hang up");
			return Response.json({ status: "ready" });
		},
		sleep: async () => {},
		log: () => {},
		warn: (...args) => warnings.push(args),
	});
	const deadline = Date.now() + 2_000;
	while (attempts < 4) {
		if (Date.now() > deadline) throw new Error("probe never finished");
		await new Promise((resolve) => setTimeout(resolve, 5));
	}
	await new Promise((resolve) => setTimeout(resolve, 20));
	assert.equal(warnings.length, 2);
	stop();
});

test("readiness probe stop aborts a pending request without logging", async () => {
	const lines = [];
	const warnings = [];
	let requested = false;
	const stop = startReadinessProbe({
		port: 3000,
		request: (_url, { signal }) => {
			requested = true;
			return new Promise((_resolve, reject) => {
				signal.addEventListener("abort", () => reject(new Error("aborted")));
			});
		},
		sleep: async () => {},
		log: (line) => lines.push(line),
		warn: (...args) => warnings.push(args),
	});
	const deadline = Date.now() + 2_000;
	while (!requested) {
		if (Date.now() > deadline) throw new Error("probe never requested");
		await new Promise((resolve) => setTimeout(resolve, 5));
	}
	stop();
	await new Promise((resolve) => setTimeout(resolve, 20));
	assert.deepEqual(lines, []);
	assert.deepEqual(warnings, []);
	stop(); // idempotent
});

test("readiness probe rejects unusable ports", () => {
	for (const port of [0, -1, 65_536, 1.5, Number.NaN]) {
		assert.throws(() => startReadinessProbe({ port }), RangeError);
	}
});
