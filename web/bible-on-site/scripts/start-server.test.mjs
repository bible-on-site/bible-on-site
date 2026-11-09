import assert from "node:assert/strict";
import { once } from "node:events";
import { writeFile } from "node:fs/promises";
import net from "node:net";
import { test } from "node:test";
import {
	boundServer,
	externalIPv4,
	fixture,
	freePort,
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
		port,
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
