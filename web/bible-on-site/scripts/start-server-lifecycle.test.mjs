import assert from "node:assert/strict";
import { test } from "node:test";
import {
	boundServer,
	eventLoopMarkerMs,
	fixture,
	freePort,
} from "./start-server-test-kit.mjs";

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
	await server.waitFor(
		"Website readiness probe: HTTP 200",
		eventLoopMarkerMs,
	);
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
