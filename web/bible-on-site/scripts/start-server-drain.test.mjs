import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { test } from "node:test";
import {
	eventLoopMarkerMs,
	fixture,
	httpServer,
	nativeSignals,
	sleep,
} from "./start-server-test-kit.mjs";

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
		await server.waitFor("Website draining", eventLoopMarkerMs);
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
		await server.waitFor("Website draining", eventLoopMarkerMs);
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
