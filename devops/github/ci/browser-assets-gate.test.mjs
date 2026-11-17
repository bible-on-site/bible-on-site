import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { test } from "node:test";
import { parse } from "yaml";

const workflow = parse(
	readFileSync(
		new URL("../../../.github/workflows/shared-dockerize.yml", import.meta.url),
		"utf8",
	),
);
const step = workflow.jobs.package.steps.find((entry) =>
	entry.run?.includes("Prerendered HTML lacks the configured assets CDN host"),
);
const start = step.run.indexOf('if [ -n "$BROWSER_ASSETS_BASE_URL" ]');
const gate = step.run.slice(start, step.run.indexOf("\nfi", start) + 3);
const shell =
	process.platform === "win32" ? "C:/Program Files/Git/bin/bash.exe" : "bash";

test("browser asset gate drains large responses and retains failure checks", async (t) => {
	let mode;
	let requests;
	const server = createServer((request, response) => {
		requests.push(request.url);
		if (mode === "http-error") {
			response.writeHead(503).end("unavailable");
			return;
		}
		response.writeHead(200);
		const matches =
			mode !== "missing-html" &&
			!(mode === "missing-recitation" && request.url === "/api/recitation");
		response.write(matches ? "cdn.example.test\n" : "legacy.example.test\n");
		if (mode === "truncated") {
			setImmediate(() => response.destroy());
			return;
		}
		// Deliver more than the pipe buffer after the early hostname match.
		let remaining = 64;
		const timer = setInterval(() => {
			response.write(`${"x".repeat(65536)}\n`);
			if (--remaining === 0) response.end();
		}, 1);
		response.on("close", () => clearInterval(timer));
	});
	await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
	t.after(() => {
		server.closeAllConnections();
		server.close();
	});
	const origin = `http://127.0.0.1:${server.address().port}`;
	for (mode of [
		"large",
		"missing-html",
		"missing-recitation",
		"http-error",
		"truncated",
		"disabled",
	]) {
		await t.test(mode, async () => {
			requests = [];
			const child = spawn(
				shell,
				[
					"--noprofile",
					"--norc",
					"-e",
					"-o",
					"pipefail",
					"-c",
					gate.replace(/http:\/\/127\.0\.0\.1:3000/g, origin),
				],
				{
					env: {
						...process.env,
						BROWSER_ASSETS_BASE_URL:
							mode === "disabled" ? "" : "https://cdn.example.test",
					},
					stdio: ["ignore", "pipe", "pipe"],
				},
			);
			let output = "";
			child.stdout.on("data", (data) => {
				output += data;
			});
			child.stderr.on("data", (data) => {
				output += data;
			});
			const status = await new Promise((resolve, reject) => {
				child.on("error", reject);
				child.on("close", resolve);
			});
			if (mode === "large" || mode === "disabled")
				assert.equal(status, 0, output);
			else assert.notEqual(status, 0, output);
			if (mode === "large")
				assert.deepEqual(requests, ["/rabbis-blessing", "/api/recitation"]);
			if (mode === "disabled") assert.deepEqual(requests, []);
		});
	}
});
