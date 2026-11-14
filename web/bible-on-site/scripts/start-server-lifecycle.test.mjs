import assert from "node:assert/strict";
import { once } from "node:events";
import { test } from "node:test";
import { startServer } from "./start-server.mjs";
import {
	boundServer,
	eventLoopMarkerMs,
	fixture,
	freePort,
	httpServer,
	nativeSignals,
} from "./start-server-test-kit.mjs";

for (const signal of ["SIGTERM", "SIGINT"]) {
	test(
		`${signal} during the first readiness probe reaches the child`,
		nativeSignals,
		async (t) => {
			const port = await freePort();
			const server = await fixture(t, boundServer, {
				drainMs: 500,
				quietMs: 100,
				pollMs: 10,
				measure: "0",
				port,
				env: { PORT: String(port) },
				signalDuringProbe: signal,
			});
			if (signal === "SIGTERM") await server.waitFor("Website draining");
			const processExit =
				server.wrapper.exitCode !== null || server.wrapper.signalCode !== null
					? [server.wrapper.exitCode, server.wrapper.signalCode]
					: await once(server.wrapper, "exit");
			assert.deepEqual(processExit, [signal === "SIGTERM" ? 143 : 130, null]);
			await server.exited;
		},
	);
}

test(
	"fixture cleanup terminates an orphan after its launcher has exited",
	nativeSignals,
	async (t) => {
		let cleanup;
		const server = await fixture(
			{
				after(fn) {
					cleanup = fn;
					t.after(fn);
				},
			},
			httpServer,
		);
		await server.waitFor("READY ");
		const childPid = Number(server.output().match(/READY (\d+) /)[1]);
		// Independent fallback keeps this regression itself from hanging if
		// fixture cleanup ever loses ownership of its orphaned child again.
		t.after(() => {
			try {
				process.kill(childPid, "SIGKILL");
			} catch (error) {
				if (error.code !== "ESRCH") throw error;
			}
		});
		const wrapperExited = once(server.wrapper, "exit");
		server.wrapper.kill("SIGKILL");
		await wrapperExited;
		await cleanup();
		assert.deepEqual(await server.exited, [null, "SIGKILL"]);
	},
);

test("a synchronous spawn failure leaves signal handlers unchanged", () => {
	const signals = ["SIGTERM", "SIGINT"];
	const before = signals.map((signal) => process.listenerCount(signal));
	assert.throws(() => startServer({ cwd: 42, port: 0 }), TypeError);
	assert.deepEqual(
		signals.map((signal) => process.listenerCount(signal)),
		before,
	);
});

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
