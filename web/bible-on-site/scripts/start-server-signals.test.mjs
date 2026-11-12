import assert from "node:assert/strict";
import { test } from "node:test";
import {
	fixture,
	freePort,
	httpServer,
	nativeSignals,
	sleep,
} from "./start-server-test-kit.mjs";

test(
	"drains an immediate child-ready SIGTERM during synchronous probe initialization",
	nativeSignals,
	async (t) => {
		const port = await freePort();
		const source = `
const http = require('node:http');
const { writeFileSync } = require('node:fs');
const server = http.createServer((_request, response) => response.end('ready'));
server.listen(Number(process.env.PORT), '0.0.0.0', () => {
  console.log('READY ' + process.pid + ' ' + server.address().port);
  process.kill(process.ppid, 'SIGTERM');
  writeFileSync('probe-initialized', 'ready');
});
process.on('SIGTERM', () => server.close(() => process.exit(143)));
`;
		const server = await fixture(t, source, {
			drainMs: 500,
			quietMs: 0,
			pollMs: 1,
			port,
			env: { PORT: String(port) },
			// Hold the first request initialization until the real child has
			// signaled its parent. This reproduces lazy HTTP-client startup
			// deterministically without enlarging the signal-test deadline.
			beforeStart: `
const { existsSync } = await import('node:fs');
const { join } = await import('node:path');
const request = fetch;
const gate = join(process.argv[3], 'probe-initialized');
fetch = (...args) => {
  const deadline = Date.now() + 5_000;
  const signal = new Int32Array(new SharedArrayBuffer(4));
  while (!existsSync(gate)) {
    if (Date.now() > deadline) throw new Error('child never reached readiness');
    Atomics.wait(signal, 0, 0, 1);
  }
  return request(...args);
};
`,
		});
		await server.waitFor("Website draining");
		assert.deepEqual(await server.exited, [143, null]);
		assert.match(server.output(), /saw no inbound connections/);
	},
);

test(
	"retains a real listener during DNS drain before forwarding SIGTERM and exiting",
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
	"interrupts on SIGINT without waiting for the production drain",
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
	"waits out the minimum drain covering DNS removal before a quiet exit",
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
	"falls back to the full drain deadline when the connection metric is unreadable",
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
