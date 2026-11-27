import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { readdir } from "node:fs/promises";
import { createInterface } from "node:readline";
import { describe, it } from "node:test";

async function listeningOrigin(server) {
	const output = createInterface({ input: server.stdout });
	try {
		for await (const line of output) {
			const origin = line.match(/http:\/\/127\.0\.0\.1:\d+/u)?.[0];
			if (origin) return origin;
		}
	} finally {
		output.close();
	}
	throw new Error("Built admin exited before announcing its listener");
}

describe("compiled admin asset caching", () => {
	it("caches existing chunks and returns uncached 404s for missing chunks", {
		timeout: 10_000,
	}, async (test) => {
		// Use local auth placeholders and leave production background work disabled.
		const server = spawn(process.execPath, [".output/server/index.mjs"], {
			env: {
				NODE_ENV: "test",
				NITRO_HOST: "127.0.0.1",
				NITRO_PORT: "0",
				COGNITO_USER_POOL_ID: "il-central-1_Fixture",
				COGNITO_CLIENT_ID: "fixture",
				COGNITO_CLIENT_SECRET: "fixture",
				COGNITO_DOMAIN: "example.invalid",
			},
			stdio: ["ignore", "pipe", "inherit"],
			windowsHide: true,
		});
		test.after(async () => {
			if (!server.pid || server.exitCode !== null || server.signalCode !== null)
				return;
			const exited = once(server, "exit");
			server.kill();
			await exited;
		});

		const origin = await Promise.race([
			listeningOrigin(server),
			once(server, "error").then(([error]) => {
				throw error;
			}),
		]);
		const asset = (await readdir(".output/public/assets")).find((file) =>
			file.endsWith(".js"),
		);
		assert.ok(asset, "Expected a compiled JavaScript asset");
		for (const method of ["GET", "HEAD"]) {
			const options = { method, redirect: "manual", signal: test.signal };
			const missing = await fetch(
				`${origin}/assets/missing-build-chunk.js`,
				options,
			);
			assert.equal(missing.status, 404);
			assert.equal(missing.headers.get("Cache-Control"), "no-store");
			assert.equal(missing.headers.get("Location"), null);
			await missing.body?.cancel();

			const existing = await fetch(
				`${origin}/assets/${encodeURIComponent(asset)}`,
				options,
			);
			assert.equal(existing.status, 200);
			assert.match(
				existing.headers.get("Cache-Control") ?? "",
				/\bimmutable\b/u,
			);
			await existing.body?.cancel();
		}
	});
});
