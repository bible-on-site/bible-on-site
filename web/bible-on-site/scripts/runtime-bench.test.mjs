import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { once } from "node:events";
import {
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import {
	assertRunPlatform,
	compareContracts,
	readJson,
	resolveRuntimeCommand,
	resolveServerActions,
	startSampler,
	successfulActionResponse,
	summarizeRun,
	timedRequest,
} from "./runtime-bench.mjs";

const script = fileURLToPath(new URL("./runtime-bench.mjs", import.meta.url));
const raw = fileURLToPath(
	new URL(
		"../../../docs/performance/website-bun-runtime-2026-11-12/raw/",
		import.meta.url,
	),
);
const nodeRecord = readJson(path.join(raw, "trial0-node.json.gz"));
const bunRecord = readJson(path.join(raw, "trial0-bun.json.gz"));

test("run refuses unsupported hosts before starting a process", () => {
	assert.throws(
		() => assertRunPlatform("linux"),
		/Windows.*Linux lifecycle adapter/,
	);
	assert.doesNotThrow(() => assertRunPlatform("win32"));
});

test("Bun resolves to a directly executable runtime rather than a Windows npm shim", () => {
	const result = spawnSync(resolveRuntimeCommand("bun"), ["--version"], {
		encoding: "utf8",
	});
	assert.equal(result.status, 0, result.error?.message ?? result.stderr);
	assert.match(result.stdout, /^\d+\.\d+/);
});

test("action IDs come from the selected artifact and must resolve unambiguously", () => {
	const entry = (exportedName) => ({
		exportedName,
		filename: "src/app/929/[number]/actions.ts",
		workers: { "app/929/[number]/page": {} },
	});
	const manifest = {
		node: {
			newDedication: entry("getBookshelfDedicationLines"),
			newSummaries: entry("getPerekSummariesBatch"),
		},
	};
	assert.deepEqual(resolveServerActions(manifest), {
		dedicationLines: "newDedication",
		perekSummariesBatch: "newSummaries",
	});
	assert.throws(() => resolveServerActions({ node: {} }), /found 0/);
	manifest.node.duplicate = entry("getBookshelfDedicationLines");
	assert.throws(() => resolveServerActions(manifest), /found 2/);
});

test("a successful HTTP flight must contain a fulfilled action, including 200 error flights", () => {
	const response = { status: 200, contentType: "text/x-component" };
	assert.equal(
		successfulActionResponse(
			response,
			Buffer.from('0:{"a":"$@1"}\n1:{"top":"text"}\n'),
		),
		true,
	);
	assert.equal(
		successfulActionResponse(
			response,
			Buffer.from('0:{"a":"$@1"}\n1:E{"digest":"failure"}\n'),
		),
		false,
	);
	assert.equal(
		successfulActionResponse(response, Buffer.from('0:{"a":"$@1"}\n')),
		false,
	);
	assert.equal(
		successfulActionResponse(
			{ ...response, status: 400 },
			Buffer.from("not an action"),
		),
		false,
	);
});

test("all three published pairs preserve recorded contracts, with JSON charset differences exposed", () => {
	for (let trial = 0; trial < 3; trial++) {
		const comparison = compareContracts(
			readJson(path.join(raw, `trial${trial}-node.json.gz`)),
			readJson(path.join(raw, `trial${trial}-bun.json.gz`)),
		);
		assert.equal(comparison.status, "passed");
		assert.equal(comparison.headerDifferences.length, 2);
		assert.ok(comparison.unrecordedBodyProbes.includes("gzip-negotiation"));
	}
});

test("decoded body, status, headers and missing probes fail a paired comparison", () => {
	for (const field of [
		"bodySha256",
		"status",
		"vary",
		"location",
		"contentType",
	]) {
		const changed = structuredClone(bunRecord);
		changed.workloads.contract.find((r) => r.name === "rsc-second-hop")[field] =
			field === "status" ? 500 : "different";
		assert.equal(compareContracts(nodeRecord, changed).status, "failed", field);
	}
	const changed = structuredClone(bunRecord);
	changed.workloads.contract = changed.workloads.contract.filter(
		(r) => r.name !== "rsc-second-hop",
	);
	assert.equal(compareContracts(nodeRecord, changed).status, "failed");
});

test("matching runtime failures cannot masquerade as compatibility", () => {
	const n = structuredClone(nodeRecord);
	const b = structuredClone(bunRecord);
	for (const rec of [n, b])
		rec.workloads.contract.find((r) => r.name === "action-dedication").status =
			400;
	assert.equal(compareContracts(n, b).status, "failed");
	assert.equal(
		compareContracts({ workloads: {} }, { workloads: {} }).status,
		"not-assessed",
	);
});

test("RSS peak uses simultaneous samples and legacy teardown is not steady-state memory", () => {
	const summary = summarizeRun({
		workloads: {},
		processSamples: [
			{ cpuSeconds: 1, rssBytes: 60 * 1048576, peakRssBytes: 100 * 1048576 },
			{ cpuSeconds: 2, rssBytes: 80 * 1048576, peakRssBytes: 120 * 1048576 },
		],
	});
	assert.equal(summary.process.rssPeakMB, 80);
	assert.equal(summary.process.rssSumOfProcessPeaksMB, 120);
	assert.equal(summary.process.rssEndMB, null);
});

test("report handles gzip evidence, rejects empty/duplicate input and fails a real mismatch", () => {
	const dir = mkdtempSync(path.join(os.tmpdir(), "runtime-bench-report-"));
	try {
		let result = spawnSync(process.execPath, [script, "report", "--in", dir], {
			encoding: "utf8",
		});
		assert.notEqual(result.status, 0);
		assert.deepEqual(readdirSync(dir), []);
		for (const [runtime, rec] of [
			["node", nodeRecord],
			["bun", bunRecord],
		])
			writeFileSync(
				path.join(dir, `trial0-${runtime}.json.gz`),
				gzipSync(JSON.stringify(rec)),
			);
		result = spawnSync(process.execPath, [script, "report", "--in", dir], {
			encoding: "utf8",
		});
		assert.equal(result.status, 0, result.stderr);
		assert.equal(readJson(path.join(dir, "summary.json")).length, 2);
		assert.equal(
			readJson(path.join(dir, "compatibility.json"))[0].status,
			"passed",
		);
		writeFileSync(path.join(dir, "trial0-bun.json"), JSON.stringify(bunRecord));
		result = spawnSync(process.execPath, [script, "report", "--in", dir], {
			encoding: "utf8",
		});
		assert.notEqual(result.status, 0);
		rmSync(path.join(dir, "trial0-bun.json"));
		const changed = structuredClone(bunRecord);
		changed.workloads.contract[0].bodySha256 = "changed";
		writeFileSync(
			path.join(dir, "trial0-bun.json.gz"),
			gzipSync(JSON.stringify(changed)),
		);
		result = spawnSync(process.execPath, [script, "report", "--in", dir], {
			encoding: "utf8",
		});
		assert.equal(result.status, 1);
		assert.equal(
			readJson(path.join(dir, "compatibility.json"))[0].status,
			"failed",
		);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("sanitize reads and preserves compressed evidence", () => {
	const dir = mkdtempSync(path.join(os.tmpdir(), "runtime-bench-sanitize-"));
	try {
		const file = path.join(dir, "trial0-node.json.gz");
		writeFileSync(
			file,
			gzipSync(
				JSON.stringify({
					path: process.env.USERPROFILE ?? process.env.HOME,
					timing: 42,
				}),
			),
		);
		const result = spawnSync(
			process.execPath,
			[script, "sanitize", "--in", dir],
			{ encoding: "utf8" },
		);
		assert.equal(result.status, 0, result.stderr);
		assert.equal(readFileSync(file)[0], 0x1f);
		assert.deepEqual(readJson(file), { path: "<home>", timing: 42 });
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("missing sampler executable is a recorded failure, not an unhandled error", async () => {
	const sampler = startSampler(
		process.pid,
		400,
		"nonexistent-runtime-bench-sampler",
	);
	await new Promise((resolve) => setImmediate(resolve));
	assert.throws(() => sampler.assertHealthy(), /sampler spawn failed/);
	sampler.stop();
});

test("health requests bypass a fully occupied replay connection pool", async () => {
	const held = [];
	let saturated;
	const full = new Promise((resolve) => {
		saturated = resolve;
	});
	const server = http.createServer((req, res) => {
		if (req.url === "/work") {
			held.push(res);
			if (held.length === 64) saturated();
		} else res.end("ready");
	});
	server.listen(0, "127.0.0.1");
	await once(server, "listening");
	const port = server.address().port;
	const replay = Array.from({ length: 64 }, () =>
		timedRequest(port, { path: "/work" }),
	);
	try {
		await full;
		const health = await timedRequest(port, {
			path: "/api/health/ready",
			tag: "health",
			timeoutMs: 1000,
		});
		assert.equal(health.status, 200);
		assert.equal(health.error, null);
	} finally {
		for (const res of held) res.end("done");
		await Promise.all(replay);
		server.closeAllConnections();
		await new Promise((resolve) => server.close(resolve));
	}
});
