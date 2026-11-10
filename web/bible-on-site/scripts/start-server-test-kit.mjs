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
			// Port 0 keeps the readiness probe off: drain and signal fixtures
			// must not fire real HTTP at whatever happens to hold :3000.
			String(options.port ?? 0),
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
		}
		// An unexpectedly terminated wrapper can leave its child holding our
		// output pipes open. Always clean up that child so failures can report.
		if (serverPid) {
			try {
				process.kill(serverPid, "SIGKILL");
			} catch (error) {
				if (error.code !== "ESRCH") throw error;
			}
		}
		assert.equal(path.dirname(directory), os.tmpdir());
		assert.ok(path.basename(directory).startsWith("bible-handover-test-"));
		await rm(directory, { recursive: true, force: true });
	});
	const waitFor = async (text) => {
		const deadline = Date.now() + 5_000;
		while (!output.includes(text)) {
			if (
				wrapper.exitCode !== null ||
				wrapper.signalCode !== null ||
				Date.now() > deadline
			)
				throw new Error(`Missing ${text}: ${output}`);
			await new Promise((resolve) => setTimeout(resolve, 10));
		}
	};
	return { wrapper, exited, waitFor, measureFile, output: () => output };
}

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
