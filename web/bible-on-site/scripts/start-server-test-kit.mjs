import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

export const entry = new URL("./start-server.mjs", import.meta.url).href;
export const nativeSignals = {
	skip: process.platform === "win32",
	timeout: 15_000,
};

export async function fixture(t, source, options = {}) {
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
	// A file-backed answer list steers the discovery read the same way: rewrite
	// it mid-test to move the task's address in or out of the resolver's
	// answers. `false` selects the real VPC resolver; omitted means an
	// unreadable answers file — the fixed-minimum fallback.
	const dnsFile = path.join(directory, "discovery-answers.txt");
	if (options.dns !== false && options.dns !== undefined)
		await writeFile(dnsFile, JSON.stringify(options.dns));
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
	port: Number(process.argv[8]),
	routerCacheMs: Number(process.argv[9]),
	dnsTimeoutMs: Number(process.argv[10]),
};
if (process.env.MEASURE_FILE) {
	const metric = process.env.MEASURE_FILE;
	options.measure = async () => Number(await readFile(metric, "utf8"));
}
if (process.env.DNS_FILE) {
	const answers = process.env.DNS_FILE;
	options.resolve = async () => JSON.parse(await readFile(answers, "utf8"));
}
if (process.env.START_SERVER_TEST_PROBE_SIGNAL) {
	const request = globalThis.fetch;
	globalThis.fetch = (...args) => {
		globalThis.fetch = request;
		process.kill(process.pid, process.env.START_SERVER_TEST_PROBE_SIGNAL);
		return request(...args);
	};
}
${options.beforeStart ?? ""}
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
			// Port 0 keeps the readiness probe off: drain and signal fixtures
			// must not fire real HTTP at whatever happens to hold :3000.
			String(options.port ?? 0),
			String(options.routerCacheMs ?? 10_000),
			String(options.dnsTimeoutMs ?? 1_000),
		],
		{
			stdio: ["ignore", "pipe", "pipe"],
			// Own the whole process group even when the launcher exits before
			// its server and no child PID was announced, so a failed
			// assertion cannot leave CI waiting on pipes.
			detached: process.platform !== "win32",
			env: {
				...process.env,
				MEASURE_FILE: options.measure === false ? "" : measureFile,
				DNS_FILE: options.dns === false ? "" : dnsFile,
				START_SERVER_TEST_PROBE_SIGNAL: options.signalDuringProbe ?? "",
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
	const closed = once(wrapper, "close");
	const exited = once(wrapper, "close", { signal: t.signal });
	// Output-only callers need not await this promise. Awaiting callers still
	// see cancellation, allowing node:test to enter teardown on its deadline.
	exited.catch(() => {});
	t.after(async () => {
		// EOF proves only that the wrapper and its captured output closed.
		// A descendant can close its output and keep serving after that point.
		const killOwned = (pid) => {
			try {
				process.kill(pid, "SIGKILL");
			} catch (error) {
				if (error.code !== "ESRCH") throw error;
			}
		};
		if (process.platform !== "win32" && wrapper.pid) {
			killOwned(-wrapper.pid);
		} else {
			if (wrapper.exitCode === null && wrapper.signalCode === null)
				wrapper.kill("SIGKILL");
			if (serverPid) killOwned(serverPid);
		}
		// Teardown observes real EOF even if the test-facing wait was aborted.
		await closed;
		assert.equal(path.dirname(directory), os.tmpdir());
		assert.ok(path.basename(directory).startsWith("bible-handover-test-"));
		await rm(directory, { recursive: true, force: true });
	});
	// READY rides the spawned server's stdio — kernel-buffered and written
	// the moment listen() fires, so the five-second default stays the
	// startup deadline. The drain/readiness markers are printed by the
	// wrapper's own event loop, which CI starvation can leave unturned for
	// seconds; those call sites pass eventLoopMarkerMs explicitly.
	const waitFor = async (text, ms = 5_000) => {
		const deadline = Date.now() + ms;
		while (!output.includes(text)) {
			// exitCode alone cannot detect a signal-killed wrapper: a
			// SIGTERM/SIGKILL death sets signalCode while exitCode stays
			// null, and polling only exitCode would spin the whole bound
			// on a process that can never print the marker again.
			const gone =
				wrapper.exitCode !== null || wrapper.signalCode !== null;
			if (gone || Date.now() > deadline)
				throw new Error(
					`Missing ${text} (${
						gone
							? `wrapper exited ${wrapper.exitCode ?? wrapper.signalCode}`
							: "wrapper still running"
					}): ${output}`,
				);
			await new Promise((resolve) => setTimeout(resolve, 10));
		}
	};
	return {
		wrapper,
		exited,
		waitFor,
		measureFile,
		dnsFile,
		output: () => output,
	};
}

// Bound for markers the wrapper prints from its own event loop (drain
// notices, readiness-probe results): under CPU starvation the loop can be
// unturned for seconds even though the child already wrote READY to the
// shared pipe. Not an SLA — the test's own timeout is the real budget.
export const eventLoopMarkerMs = 10_000;

export const httpServer = `
const http = require('node:http');
const server = http.createServer((_request, response) => response.end('unchanged reader'));
server.listen(0, '127.0.0.1', () => console.log('READY ' + process.pid + ' ' + server.address().port));
process.on('SIGTERM', () => server.close(() => process.exit(143)));
process.on('SIGINT', () => server.close(() => process.exit(130)));
`;

export const externalIPv4 = () =>
	Object.values(os.networkInterfaces())
		.flat()
		.find((iface) => iface && iface.family === "IPv4" && !iface.internal)
		?.address;

// node:test's own timeout marks a hung test failed but cannot unwind its
// awaits: a pending connect or process exit keeps the file (and the spawned
// wrapper) alive until the outer execFile kills it — an opaque SIGTERM that
// also leaks the fixture children. Bounding a wait inside the test's existing
// budget turns such a stall into a failure that names the phase which never
// settled.
export const deadline = (promise, ms, what) => {
	let timer;
	const expired = new Promise((_, reject) => {
		timer = setTimeout(
			() => reject(new Error(`${what} did not settle within ${ms}ms`)),
			ms,
		);
	});
	return Promise.race([promise, expired]).finally(() => clearTimeout(timer));
};

export const freePort = async () => {
	const probe = net.createServer();
	probe.listen(0, "0.0.0.0");
	await once(probe, "listening");
	const { port } = probe.address();
	probe.close();
	await once(probe, "close");
	return port;
};

export const boundServer = `
const http = require('node:http');
const server = http.createServer((_request, response) => response.end('unchanged reader'));
server.listen(Number(process.env.PORT), '0.0.0.0', () => console.log('READY ' + process.pid + ' ' + server.address().port));
process.on('SIGTERM', () => server.close(() => process.exit(143)));
`;

export { sleep };
