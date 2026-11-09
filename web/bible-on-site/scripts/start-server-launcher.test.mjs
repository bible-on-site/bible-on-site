import assert from "node:assert/strict";
import { test } from "node:test";
import {
	boundServer,
	fixture,
	freePort,
	httpServer,
	nativeSignals,
	sleep,
} from "./start-server-test-kit.mjs";

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

test("the launcher probes readiness as soon as the listener accepts", {
	timeout: 15_000,
}, async (t) => {
	const port = await freePort();
	const server = await fixture(t, boundServer, {
		drainMs: 500,
		measure: "0",
		port,
		env: { PORT: String(port) },
	});
	await server.waitFor("READY ");
	// The fixture answers every path, so the probe's first response is the
	// warm-up trigger plus startup timing evidence — long before any
	// simulated container check could arrive.
	await server.waitFor("Website readiness probe: HTTP 200");
	server.wrapper.kill("SIGINT");
	// boundServer has no SIGINT handler, so the child dies by the signal. POSIX
	// forwards SIGINT through the wrapper and reports 128+SIGINT; Windows
	// terminates the wrapper process with the signal itself.
	assert.deepEqual(
		await server.exited,
		process.platform === "win32" ? [null, "SIGINT"] : [130, null],
	);
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
