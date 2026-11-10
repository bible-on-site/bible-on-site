import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { test } from "node:test";
import {
	externalIPv4,
	fixture,
	httpServer,
	nativeSignals,
	sleep,
} from "./start-server-test-kit.mjs";

const ABSENT = JSON.stringify(["198.51.100.1"]);

test(
	"observed removal ends the floor one router cache window later",
	nativeSignals,
	async (t) => {
		const own = externalIPv4();
		assert.ok(own, "test host must have a non-loopback IPv4 address");
		const server = await fixture(t, httpServer, {
			drainMs: 90_000,
			quietMs: 200,
			pollMs: 100,
			// The fixed minimum stays far above the measured floor so the test
			// proves the discovery read, not the fallback, ended the drain.
			minDrainMs: 5_000,
			routerCacheMs: 400,
			dns: [own],
		});
		await server.waitFor("READY ");
		const started = Date.now();
		server.wrapper.kill("SIGTERM");
		await server.waitFor("Website draining");
		// Cloud Map removal reaches answers shortly after SIGTERM.
		await sleep(300);
		await writeFile(server.dnsFile, ABSENT);
		assert.deepEqual(await server.exited, [143, null]);
		const elapsed = Date.now() - started;
		assert.match(
			server.output(),
			/Website task left discovery answers after \d+ms/,
		);
		assert.match(server.output(), /saw no inbound connections/);
		assert.ok(
			elapsed < 5_000,
			`measured removal floor must clear before the ${5_000}ms fallback (${elapsed}ms)`,
		);
		// One router cache window after the last answer still naming the task.
		assert.ok(
			elapsed > 250,
			`floor must still cover the router cache window (${elapsed}ms)`,
		);
	},
);

test(
	"answers still listing the task hold the drain past the old fixed floor",
	nativeSignals,
	async (t) => {
		const own = externalIPv4();
		assert.ok(own, "test host must have a non-loopback IPv4 address");
		const server = await fixture(t, httpServer, {
			drainMs: 90_000,
			quietMs: 150,
			pollMs: 100,
			// Old-style floor: a guessed minimum alone would end the drain at
			// ~400+150ms — while answers still name this task the measured floor
			// must keep it serving.
			minDrainMs: 400,
			routerCacheMs: 300,
			dns: [own],
		});
		await server.waitFor("READY ");
		const started = Date.now();
		server.wrapper.kill("SIGTERM");
		await server.waitFor("Website draining");
		// Answers keep naming the task for ~700ms — slow Cloud Map propagation.
		await sleep(700);
		await writeFile(server.dnsFile, ABSENT);
		assert.deepEqual(await server.exited, [143, null]);
		const elapsed = Date.now() - started;
		assert.match(
			server.output(),
			/Website task left discovery answers after \d+ms/,
		);
		assert.ok(
			elapsed > 800,
			`still-listed answers must extend the floor past the fixed estimate (${elapsed}ms)`,
		);
		assert.ok(
			elapsed < 30_000,
			`measured drain should end far before the 90s deadline (${elapsed}ms)`,
		);
	},
);

test(
	"unreadable discovery keeps the fixed minimum floor",
	nativeSignals,
	async (t) => {
		// No answers file: the discovery read fails, so the drain falls back
		// to the unconditional minimum exactly as before.
		const server = await fixture(t, httpServer, {
			drainMs: 90_000,
			quietMs: 150,
			pollMs: 100,
			minDrainMs: 800,
		});
		await server.waitFor("READY ");
		const started = Date.now();
		server.wrapper.kill("SIGTERM");
		await server.waitFor("Website draining");
		assert.deepEqual(await server.exited, [143, null]);
		const elapsed = Date.now() - started;
		assert.doesNotMatch(server.output(), /left discovery answers/);
		// The failed resolver reads surface once instead of disappearing.
		assert.match(server.output(), /Website discovery read failed/);
		assert.match(server.output(), /saw no inbound connections/);
		assert.ok(
			elapsed > 600,
			`fixed minimum floor must still hold (${elapsed}ms)`,
		);
		assert.ok(
			elapsed < 3_000,
			`fixed floor should end shortly after its minimum (${elapsed}ms)`,
		);
	},
);

test(
	"a real unresolvable discovery name still drains on the fixed floor",
	nativeSignals,
	async (t) => {
		// `dns: false` exercises the genuine resolver path: the fixture name
		// does not resolve outside the VPC, so every read fails and the drain
		// must fall back without hanging or crashing.
		const server = await fixture(t, httpServer, {
			drainMs: 90_000,
			quietMs: 150,
			pollMs: 100,
			minDrainMs: 600,
			dns: false,
		});
		await server.waitFor("READY ");
		const started = Date.now();
		server.wrapper.kill("SIGTERM");
		await server.waitFor("Website draining");
		assert.deepEqual(await server.exited, [143, null]);
		const elapsed = Date.now() - started;
		assert.match(server.output(), /saw no inbound connections/);
		assert.ok(
			elapsed < 10_000,
			`unresolvable discovery must not stall the drain (${elapsed}ms)`,
		);
	},
);
