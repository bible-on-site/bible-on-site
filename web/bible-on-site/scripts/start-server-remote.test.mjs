import assert from "node:assert/strict";
import { once } from "node:events";
import net from "node:net";
import { test } from "node:test";
import { inboundConnections } from "./start-server.mjs";
import {
	boundServer,
	externalIPv4,
	fixture,
	freePort,
	sleep,
} from "./start-server-test-kit.mjs";

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
	// The drain only holds on platforms whose procfs actually reports the
	// socket (empty /proc/net/tcp tables exist, e.g. some WSL2 setups).
	if ((await inboundConnections(port)) === 0) {
		t.skip("procfs does not expose the held connection to the drain metric");
		return;
	}
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
