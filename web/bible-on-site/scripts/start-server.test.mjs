import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

const entry = new URL("./start-server.mjs", import.meta.url).href;
const nativeSignals = { skip: process.platform === "win32", timeout: 10_000 };

async function fixture(t, source, options = {}) {
	const directory = await mkdtemp(path.join(os.tmpdir(), "bible-handover-test-"));
	await writeFile(path.join(directory, "server.js"), source);
	const launcher = path.join(directory, "launcher.mjs");
	await writeFile(launcher, `
const { startServer } = await import(process.argv[2]);
startServer({ cwd: process.argv[3], drainMs: Number(process.argv[4]) });
`);
	const wrapper = spawn(
		process.execPath,
		[
			launcher,
			entry,
			options.cwd === "missing" ? path.join(directory, "missing") : directory,
			String(options.drainMs ?? 90_000),
		],
		{ stdio: ["ignore", "pipe", "pipe"] },
	);
	let output = "";
	let serverPid;
	wrapper.stdout.on("data", (data) => {
		output += data;
		serverPid = Number(output.match(/READY (\d+) /)?.[1]) || serverPid;
	});
	wrapper.stderr.on("data", (data) => { output += data; });
	const exited = once(wrapper, "close");
	t.after(async () => {
		if (wrapper.exitCode === null && wrapper.signalCode === null) {
			wrapper.kill("SIGKILL");
			if (serverPid) {
				try { process.kill(serverPid, "SIGKILL"); } catch (error) {
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
	return { wrapper, exited, waitFor, output: () => output };
}

const httpServer = `
const http = require('node:http');
const server = http.createServer((_request, response) => response.end('unchanged reader'));
server.listen(0, '127.0.0.1', () => console.log('READY ' + process.pid + ' ' + server.address().port));
process.on('SIGTERM', () => server.close(() => process.exit(143)));
process.on('SIGINT', () => server.close(() => process.exit(130)));
`;

test("SIGTERM retains a real listener during DNS drain, then forwards and exits", nativeSignals, async (t) => {
	const server = await fixture(t, httpServer, { drainMs: 500 });
	await server.waitFor("READY ");
	const port = Number(server.output().match(/READY \d+ (\d+)/)[1]);
	server.wrapper.kill("SIGTERM");
	await server.waitFor("Website draining");
	server.wrapper.kill("SIGTERM");
	const response = await fetch(`http://127.0.0.1:${port}`, { signal: AbortSignal.timeout(1_000) });
	assert.equal(response.status, 200);
	assert.equal(await response.text(), "unchanged reader");
	assert.deepEqual(await server.exited, [143, null]);
	assert.equal(server.output().match(/Website draining/g).length, 1);
});

test("SIGINT interrupts without waiting for the production drain", nativeSignals, async (t) => {
	const server = await fixture(t, httpServer);
	await server.waitFor("READY ");
	server.wrapper.kill("SIGINT");
	assert.deepEqual(await server.exited, [130, null]);
	assert.ok(!server.output().includes("Website draining"));
});

test("child startup failures keep their nonzero exit code", { timeout: 10_000 }, async (t) => {
	const server = await fixture(t, "process.exit(7)");
	assert.deepEqual(await server.exited, [7, null]);
});

test("spawn errors fail instead of leaving a healthy wrapper", { timeout: 10_000 }, async (t) => {
	const server = await fixture(t, "", { cwd: "missing" });
	assert.deepEqual(await server.exited, [1, null]);
	assert.ok(server.output().includes("Website server could not start"));
});
