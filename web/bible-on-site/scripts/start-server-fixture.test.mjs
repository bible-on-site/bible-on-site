import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
	fixture,
	httpServer,
	nativeSignals,
} from "./start-server-test-kit.mjs";

const fixtureModule = new URL("./start-server-test-kit.mjs", import.meta.url)
	.href;
const silentServer = `console.log('CHILD ' + process.pid); setInterval(() => {}, 1000);`;

// A separate node:test process proves failure reporting and stdio really finish.
// The outer test owns the probe's process group, including its failure cleanup.
async function probe(t, body, { timeout = 2_000 } = {}) {
	const directory = await mkdtemp(
		path.join(os.tmpdir(), "bible-fixture-probe-"),
	);
	const file = path.join(directory, "probe.mjs");
	await writeFile(
		file,
		`import { test } from 'node:test';
import { once } from 'node:events';
import { fixture } from ${JSON.stringify(fixtureModule)};
test('fixture lifecycle probe', { timeout: ${timeout} }, async (t) => {
  const server = await fixture(t, ${JSON.stringify(silentServer)});
  await server.waitFor('CHILD ');
  console.log('OWNED_WRAPPER ' + server.wrapper.pid);
  ${body}
});`,
	);
	const environment = { ...process.env };
	delete environment.NODE_TEST_CONTEXT;
	const child = spawn(
		process.execPath,
		["--test", "--test-reporter=tap", file],
		{
			detached: true,
			stdio: ["ignore", "pipe", "pipe"],
			env: environment,
		},
	);
	let output = "";
	let closed = false;
	for (const stream of [child.stdout, child.stderr]) {
		stream.on("data", (data) => {
			output += data;
		});
	}
	child.once("close", () => {
		closed = true;
	});
	t.after(async () => {
		if (!closed) {
			// A broken fixture may own its own group; reap it as well as the
			// probe group so a red regression cannot leak a local server.
			const groups = [
				child.pid,
				...Array.from(output.matchAll(/OWNED_WRAPPER (\d+)/g), (m) =>
					Number(m[1]),
				),
			];
			for (const group of groups) {
				try {
					process.kill(-group, "SIGKILL");
				} catch (error) {
					if (error.code !== "ESRCH") throw error;
				}
			}
			child.stdout.destroy();
			child.stderr.destroy();
		}
		await rm(directory, { recursive: true, force: true });
	});
	try {
		const [code, signal] = await once(child, "close", {
			signal: AbortSignal.any([t.signal, AbortSignal.timeout(5_000)]),
		});
		return { code, signal, output };
	} catch (cause) {
		throw new Error(`Fixture kept the test process/stdio alive:\n${output}`, {
			cause,
		});
	}
}

test(
	"fixture cleanup reaps a server that never emits READY",
	nativeSignals,
	async (t) => {
		const result = await probe(
			t,
			"// End normally with the server still alive.",
		);
		assert.equal(result.signal, null);
		assert.equal(result.code, 0, result.output);
		assert.match(result.output, /# fail 0/);
	},
);

test(
	"failed test cleanup closes inherited pipes without a READY PID",
	nativeSignals,
	async (t) => {
		const result = await probe(
			t,
			"throw new Error('intentional fixture failure');",
		);
		assert.equal(result.signal, null);
		assert.equal(result.code, 1, result.output);
		assert.match(result.output, /intentional fixture failure/);
		assert.match(result.output, /# fail 1/);
	},
);

test(
	"an already killed wrapper cannot strand its unannounced server",
	nativeSignals,
	async (t) => {
		const result = await probe(
			t,
			`
    const exited = once(server.wrapper, 'exit');
    server.wrapper.kill('SIGKILL');
    await exited;
    throw new Error('wrapper died before cleanup');
  `,
		);
		assert.equal(result.signal, null);
		assert.equal(result.code, 1, result.output);
		assert.match(result.output, /wrapper died before cleanup/);
		assert.match(result.output, /# fail 1/);
	},
);

test(
	"a timed out exit wait still tears down the fixture",
	nativeSignals,
	async (t) => {
		const result = await probe(t, "await server.exited;", { timeout: 300 });
		assert.equal(result.signal, null);
		assert.equal(result.code, 1, result.output);
		assert.match(result.output, /testTimeoutFailure/);
	},
);

test(
	"a closed wrapper cannot leave a server with closed output listening",
	nativeSignals,
	async (t) => {
		let connectionClosed;
		await t.test("close wrapper and inherited output", async (subtest) => {
			const server = await fixture(
				subtest,
				`
const fs = require('node:fs');
const server = require('node:net').createServer(client => client.write('accepted'));
server.listen(0, '127.0.0.1', () => {
  process.stdout.write('READY ' + process.pid + ' ' + server.address().port + '\\n', () => {
    fs.closeSync(1);
    fs.closeSync(2);
  });
});`,
			);
			// Also reap a leaking regression so a red run cannot leave a server.
			t.after(() => {
				try {
					process.kill(-server.wrapper.pid, "SIGKILL");
				} catch (error) {
					if (error.code !== "ESRCH") throw error;
				}
			});
			await server.waitFor("READY ");
			const port = Number(server.output().match(/READY \d+ (\d+)/)[1]);
			const client = net.createConnection({ host: "127.0.0.1", port });
			t.after(() => client.destroy());
			await once(client, "data", { signal: t.signal });
			connectionClosed = once(client, "close", { signal: t.signal });
			server.wrapper.kill("SIGKILL");
			await server.exited;
		});
		// Signal delivery is asynchronous. Observe the accepted connection
		// closing instead of racing the kernel with an immediate port probe.
		await connectionClosed;
	},
);

test(
	"tearing down one fixture leaves a concurrent fixture running",
	nativeSignals,
	async (t) => {
		const other = await fixture(t, httpServer);
		await other.waitFor("READY ");
		await t.test("owns only its own server", async (subtest) => {
			const own = await fixture(subtest, httpServer);
			await own.waitFor("READY ");
		});
		assert.equal(other.wrapper.exitCode, null);
		assert.equal(other.wrapper.signalCode, null);
		other.wrapper.kill("SIGINT");
		assert.deepEqual(await other.exited, [130, null]);
	},
);
