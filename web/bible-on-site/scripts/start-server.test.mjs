import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { setTimeout as sleep } from "node:timers/promises";
import {
	inboundConnections,
	reportImageSnapshotter,
	startReadinessProbe,
} from "./start-server.mjs";

const entry = new URL("./start-server.mjs", import.meta.url).href;
const nativeSignals = { skip: process.platform === "win32", timeout: 15_000 };

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

async function fixture(t, source, options = {}) {
	const directory = await mkdtemp(
		path.join(os.tmpdir(), "bible-handover-test-"),
	);
	await writeFile(path.join(directory, "server.js"), source);
	// A file-backed counter lets tests steer the measured drain: rewrite it
	// mid-test to simulate remote clients appearing or disappearing. `false`
	// selects real procfs counting, so the file is not written at all.
	const measureFile = path.join(directory, "inbound-count.txt");
	if (options.measure !== false)
		await writeFile(measureFile, options.measure ?? "0");
	const launcher = path.join(directory, "launcher.mjs");
	await writeFile(
		launcher,
		`
const { readFile } = await import("node:fs/promises");
const { startServer } = await import(process.argv[2]);
const options = {
	cwd: process.argv[3],
	drainMs: Number(process.argv[4]),
	quietMs: Number(process.argv[5]),
	pollMs: Number(process.argv[6]),
	minDrainMs: Number(process.argv[7]),
};
if (process.env.MEASURE_FILE) {
	const metric = process.env.MEASURE_FILE;
	options.measure = async () => Number(await readFile(metric, "utf8"));
}
startServer(options);
`,
	);
	const wrapper = spawn(
		process.execPath,
		[
			launcher,
			entry,
			options.cwd === "missing" ? path.join(directory, "missing") : directory,
			String(options.drainMs ?? 90_000),
			String(options.quietMs ?? 30_000),
			String(options.pollMs ?? 500),
			String(options.minDrainMs ?? 0),
		],
		{
			stdio: ["ignore", "pipe", "pipe"],
			env: {
				...process.env,
				MEASURE_FILE: options.measure === false ? "" : measureFile,
				...options.env,
			},
		},
	);
	let output = "";
	let serverPid;
	wrapper.stdout.on("data", (data) => {
		output += data;
		serverPid = Number(output.match(/READY (\d+) /)?.[1]) || serverPid;
	});
	wrapper.stderr.on("data", (data) => {
		output += data;
	});
	const exited = once(wrapper, "close");
	t.after(async () => {
		if (wrapper.exitCode === null && wrapper.signalCode === null) {
			wrapper.kill("SIGKILL");
			if (serverPid) {
				try {
					process.kill(serverPid, "SIGKILL");
				} catch (error) {
					if (error.code !== "ESRCH") throw error;
				}
			}
		}
		assert.equal(path.dirname(directory), os.tmpdir());
		assert.ok(path.basename(directory).startsWith("bible-handover-test-"));
		await rm(directory, { recursive: true, force: true });
	});
	const waitFor = async (text) => {
		const deadline = Date.now() + 5_000;
		while (!output.includes(text)) {
			if (wrapper.exitCode !== null || Date.now() > deadline)
				throw new Error(`Missing ${text}: ${output}`);
			await new Promise((resolve) => setTimeout(resolve, 10));
		}
	};
	return { wrapper, exited, waitFor, measureFile, output: () => output };
}

const httpServer = `
const http = require('node:http');
const server = http.createServer((_request, response) => response.end('unchanged reader'));
server.listen(0, '127.0.0.1', () => console.log('READY ' + process.pid + ' ' + server.address().port));
process.on('SIGTERM', () => server.close(() => process.exit(143)));
process.on('SIGINT', () => server.close(() => process.exit(130)));
`;

test(
	"SIGTERM retains a real listener during DNS drain, then forwards and exits",
	nativeSignals,
	async (t) => {
		const server = await fixture(t, httpServer, { drainMs: 500 });
		await server.waitFor("READY ");
		const port = Number(server.output().match(/READY \d+ (\d+)/)[1]);
		server.wrapper.kill("SIGTERM");
		await server.waitFor("Website draining");
		server.wrapper.kill("SIGTERM");
		const response = await fetch(`http://127.0.0.1:${port}`, {
			signal: AbortSignal.timeout(1_000),
		});
		assert.equal(response.status, 200);
		assert.equal(await response.text(), "unchanged reader");
		assert.deepEqual(await server.exited, [143, null]);
		assert.equal(server.output().match(/Website draining/g).length, 1);
	},
);

test(
	"SIGINT interrupts without waiting for the production drain",
	nativeSignals,
	async (t) => {
		const server = await fixture(t, httpServer);
		await server.waitFor("READY ");
		server.wrapper.kill("SIGINT");
		assert.deepEqual(await server.exited, [130, null]);
		assert.ok(!server.output().includes("Website draining"));
	},
);

test(
	"SIGTERM ends the measured drain once inbound connections are quiet",
	nativeSignals,
	async (t) => {
		const server = await fixture(t, httpServer, {
			drainMs: 90_000,
			quietMs: 800,
			pollMs: 100,
		});
		await server.waitFor("READY ");
		const port = Number(server.output().match(/READY \d+ (\d+)/)[1]);
		const started = Date.now();
		server.wrapper.kill("SIGTERM");
		await server.waitFor("Website draining");
		const response = await fetch(`http://127.0.0.1:${port}`, {
			signal: AbortSignal.timeout(1_000),
		});
		assert.equal(response.status, 200);
		assert.deepEqual(await server.exited, [143, null]);
		const elapsed = Date.now() - started;
		assert.ok(
			elapsed < 30_000,
			`measured drain should end far before the 90s deadline (${elapsed}ms)`,
		);
		assert.match(server.output(), /saw no inbound connections/);
	},
);

test(
	"inbound activity extends the measured drain until traffic stops",
	nativeSignals,
	async (t) => {
		const server = await fixture(t, httpServer, {
			drainMs: 90_000,
			quietMs: 400,
			pollMs: 100,
			measure: "2",
		});
		await server.waitFor("READY ");
		const started = Date.now();
		server.wrapper.kill("SIGTERM");
		await server.waitFor("Website draining");
		// A client still arriving at the old address keeps the drain open.
		await sleep(500);
		assert.equal(server.wrapper.exitCode, null);
		await writeFile(server.measureFile, "0");
		assert.deepEqual(await server.exited, [143, null]);
		const elapsed = Date.now() - started;
		assert.ok(
			elapsed > 700,
			`drain must wait out quiet window after last activity (${elapsed}ms)`,
		);
		assert.ok(
			elapsed < 30_000,
			`measured drain should end far before the 90s deadline (${elapsed}ms)`,
		);
	},
);

test(
	"the quiet exit waits out the minimum drain covering DNS removal",
	nativeSignals,
	async (t) => {
		const server = await fixture(t, httpServer, {
			drainMs: 90_000,
			minDrainMs: 800,
			quietMs: 100,
			pollMs: 100,
		});
		await server.waitFor("READY ");
		const started = Date.now();
		server.wrapper.kill("SIGTERM");
		await server.waitFor("Website draining");
		// Quiet from the start, but DNS removal may still be propagating.
		await sleep(400);
		assert.equal(
			server.wrapper.exitCode,
			null,
			"quiet must not end the drain before the minimum",
		);
		assert.deepEqual(await server.exited, [143, null]);
		const elapsed = Date.now() - started;
		assert.ok(
			elapsed >= 750,
			`drain must hold until the minimum (${elapsed}ms)`,
		);
		assert.match(server.output(), /saw no inbound connections/);
	},
);

test(
	"an unreadable connection metric falls back to the full drain deadline",
	nativeSignals,
	async (t) => {
		const server = await fixture(t, httpServer, {
			drainMs: 700,
			quietMs: 100,
			pollMs: 100,
			measure: "not a number",
		});
		await server.waitFor("READY ");
		const started = Date.now();
		server.wrapper.kill("SIGTERM");
		await server.waitFor("Website draining");
		assert.deepEqual(await server.exited, [143, null]);
		const elapsed = Date.now() - started;
		assert.ok(
			elapsed >= 650,
			`an unreadable metric must keep the full drain (${elapsed}ms)`,
		);
		assert.match(server.output(), /reached the deadline/);
	},
);

const externalIPv4 = () =>
	Object.values(os.networkInterfaces())
		.flat()
		.find((iface) => iface && iface.family === "IPv4" && !iface.internal)
		?.address;

const freePort = async () => {
	const probe = net.createServer();
	probe.listen(0, "0.0.0.0");
	await once(probe, "listening");
	const { port } = probe.address();
	probe.close();
	await once(probe, "close");
	return port;
};

const boundServer = `
const http = require('node:http');
const server = http.createServer((_request, response) => response.end('unchanged reader'));
server.listen(Number(process.env.PORT), '0.0.0.0', () => console.log('READY ' + process.pid + ' ' + server.address().port));
process.on('SIGTERM', () => server.close(() => process.exit(143)));
`;

test("a held remote connection keeps the real measured drain open until it closes", {
	skip:
		process.platform === "win32" ||
		process.platform === "darwin" ||
		!externalIPv4(),
	timeout: 15_000,
}, async (t) => {
	const port = await freePort();
	const server = await fixture(t, boundServer, {
		drainMs: 90_000,
		quietMs: 500,
		pollMs: 100,
		measure: false, // real /proc/net/tcp counting
		env: { PORT: String(port) },
	});
	await server.waitFor("READY ");
	const client = net.connect(port, externalIPv4());
	await once(client, "connect");
	t.after(() => client.destroy());
	server.wrapper.kill("SIGTERM");
	await server.waitFor("Website draining");
	await sleep(1_200);
	assert.equal(
		server.wrapper.exitCode,
		null,
		"an open remote connection must hold the drain",
	);
	client.destroy();
	assert.deepEqual(await server.exited, [143, null]);
	assert.match(server.output(), /saw no inbound connections/);
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

test("the launcher probes readiness as soon as the listener accepts", {
	timeout: 15_000,
}, async (t) => {
	const port = await freePort();
	const server = await fixture(t, boundServer, {
		drainMs: 500,
		measure: "0",
		env: { PORT: String(port) },
	});
	await server.waitFor("READY ");
	// The fixture answers every path, so the probe's first response is the
	// warm-up trigger plus startup timing evidence — long before any
	// simulated container check could arrive.
	await server.waitFor("Website readiness probe: HTTP 200");
	server.wrapper.kill("SIGINT");
	// boundServer has no SIGINT handler, so the child dies by the signal.
	assert.deepEqual(await server.exited, [null, "SIGINT"]);
});

test("child startup failures keep their nonzero exit code", {
	timeout: 10_000,
}, async (t) => {
	const server = await fixture(t, "process.exit(7)");
	assert.deepEqual(await server.exited, [7, null]);
});

test("spawn errors fail instead of leaving a healthy wrapper", {
	timeout: 10_000,
}, async (t) => {
	const server = await fixture(t, "", { cwd: "missing" });
	assert.deepEqual(await server.exited, [1, null]);
	assert.ok(server.output().includes("Website server could not start"));
});
