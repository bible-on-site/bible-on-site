import assert from "node:assert/strict";
import { once } from "node:events";
import { readFile } from "node:fs/promises";
import net from "node:net";
import { test } from "node:test";
import {
	boundServer,
	deadline,
	externalIPv4,
	fixture,
	freePort,
	sleep,
} from "./start-server-test-kit.mjs";

// Independent procfs capability probe: count every socket row the kernel
// exposes, in any state and on any port. The held client connection below
// guarantees rows exist on a working procfs, so an empty table means this
// environment cannot validate the drain metric at all (some WSL2 setups
// expose empty /proc/net/tcp*). Probing inboundConnections() itself would be
// circular — a blind metric would skip its own regression check.
async function procfsSocketRows() {
	let rows = 0;
	for (const table of ["/proc/net/tcp", "/proc/net/tcp6"]) {
		try {
			const text = await readFile(table, "utf8");
			rows += text
				.split("\n")
				.slice(1) // header
				.filter((line) => line.trim().split(/\s+/).length >= 4).length;
		} catch {
			// tcp6 is absent when IPv6 is disabled; an unreadable tcp means
			// there is no procfs socket table to validate against.
		}
	}
	return rows;
}

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
	// The hairpin connect to the runner's own external IPv4 has no kernel-level
	// deadline: an environment that cannot route it (dropped SYN under CI load)
	// would hang the test into the outer execFile kill without any TAP output.
	await deadline(once(client, "connect"), 5_000, "external IPv4 connect");
	t.after(() => client.destroy());
	// Skip only when procfs provably exposes no socket rows — an environment
	// where the drain metric cannot work at all (empty /proc/net/tcp tables,
	// e.g. some WSL2 setups). A populated table with an invisible held
	// connection is a real failure and must not skip.
	if ((await procfsSocketRows()) === 0) {
		t.skip("procfs exposes no socket rows in this environment");
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
	// The drain exits ~500ms after the close is observed (quietMs 500, pollMs
	// 100); a server-side socket that lingers in a counted state keeps it open
	// up to drainMs 90s, so bound the wait rather than the fixture.
	assert.deepEqual(
		await deadline(server.exited, 5_000, "wrapper exit after client close"),
		[143, null],
	);
	assert.match(server.output(), /saw no inbound connections/);
});
