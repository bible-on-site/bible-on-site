#!/usr/bin/env node
/**
 * Paired production-runtime benchmark: Node vs Bun serving the identical
 * Next.js standalone artifact (issue #3315).
 *
 * One built `.next/standalone` output is served through the production
 * `scripts/start-server.mjs` wrapper under each runtime; the wrapper's
 * `process.execPath` propagation makes the generated `server.js` run under
 * the same runtime — matching the container entrypoint.
 *
 *   node scripts/runtime-bench.mjs run \
 *     --fixture ../../docs/performance/website-cpu-2026-11-02/replay-fixture.json \
 *     --trials 3 --out ../../docs/performance/website-bun-runtime-<date>/raw
 *   node scripts/runtime-bench.mjs report --in <raw dir>
 *
 * `run` writes one JSON per (trial, runtime) with every timed request plus
 * process-tree CPU/RSS samples; `report` folds them into summary.json and a
 * markdown table for the decision report.
 *
 * Measurement notes
 * - TTFB = time to response headers; duration = time to completed body.
 * - The request schedule is offset-driven (fixture starts/second and recorded
 *   burst second offsets), so both runtimes see an identical offered load.
 * - CPU/RSS come from an external PowerShell sampler over the wrapper's whole
 *   process tree — the same measurement for both runtimes even where in-process
 *   diagnostics (eventLoopUtilization, GC PerformanceObserver) are unsupported.
 * - Windows note: POSIX drain semantics (SIGTERM to the wrapper) cannot be
 *   validated on this platform; termination behavior is recorded, not judged.
 */

import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	writeFileSync,
} from "node:fs";
import http from "node:http";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import zlib from "node:zlib";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_ROOT = path.resolve(__dirname, "..");
const STANDALONE = path.join(APP_ROOT, ".next", "standalone");
const WRAPPER = path.join(APP_ROOT, "scripts", "start-server.mjs");
const HOST = "127.0.0.1";

export function resolveServerActions(manifest) {
	const actions = {};
	for (const [key, exportedName] of Object.entries({
		dedicationLines: "getBookshelfDedicationLines",
		perekSummariesBatch: "getPerekSummariesBatch",
	})) {
		const matches = Object.entries(manifest.node ?? {}).filter(
			([, entry]) =>
				entry.exportedName === exportedName &&
				entry.filename === "src/app/929/[number]/actions.ts" &&
				entry.workers?.["app/929/[number]/page"],
		);
		if (matches.length !== 1)
			throw new Error(
				`Expected one built action for ${exportedName}; found ${matches.length}`,
			);
		actions[key] = matches[0][0];
	}
	return actions;
}

export function assertRunPlatform(platform = process.platform) {
	if (platform !== "win32")
		throw new Error(
			"run currently requires native Windows process sampling/cleanup; Linux qualification needs a Linux lifecycle adapter. report/sanitize are portable.",
		);
}

// ---------------------------------------------------------------------------
// small utilities
// ---------------------------------------------------------------------------

function parseArgs(argv) {
	const args = { _: [] };
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		if (a.startsWith("--")) {
			const key = a.slice(2);
			const next = argv[i + 1];
			if (next === undefined || next.startsWith("--")) {
				args[key] = true;
			} else {
				args[key] = next;
				i++;
			}
		} else args._.push(a);
	}
	return args;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function percentile(sorted, p) {
	if (sorted.length === 0) return null;
	const idx = Math.min(
		sorted.length - 1,
		Math.ceil((p / 100) * sorted.length) - 1,
	);
	return sorted[Math.max(0, idx)];
}

function stats(values) {
	const v = values.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
	if (v.length === 0) return { n: 0 };
	const mean = v.reduce((s, x) => s + x, 0) / v.length;
	return {
		n: v.length,
		mean: round2(mean),
		p50: round2(percentile(v, 50)),
		p95: round2(percentile(v, 95)),
		p99: round2(percentile(v, 99)),
		max: round2(v[v.length - 1]),
	};
}

const round2 = (x) => (x == null ? null : Math.round(x * 100) / 100);

function loadEnvFile(file) {
	const env = {};
	if (!file || !existsSync(file)) return env;
	for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
		const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
		if (m && !line.trim().startsWith("#")) env[m[1]] = m[2];
	}
	return env;
}

function sha256(buf) {
	return createHash("sha256").update(buf).digest("hex");
}

// ---------------------------------------------------------------------------
// HTTP measurement
// ---------------------------------------------------------------------------

const agent = new http.Agent({ keepAlive: true, maxSockets: 64 });
const agentNoKeepAlive = new http.Agent({ keepAlive: false, maxSockets: 64 });
const healthAgent = new http.Agent({ keepAlive: true, maxSockets: 4 });

export function successfulActionResponse(response, body) {
	if (
		response.status !== 200 ||
		!response.contentType?.startsWith("text/x-component")
	)
		return false;
	// A 200 flight can still contain a rejected action. Follow the root's action
	// promise and require a fulfilled JSON row, rather than just HTTP success.
	try {
		const rows = new Map(
			body
				.toString("utf8")
				.trim()
				.split("\n")
				.map((line) => {
					const colon = line.indexOf(":");
					return [line.slice(0, colon), line.slice(colon + 1)];
				}),
		);
		const root = JSON.parse(rows.get("0"));
		if (!/^\$@[a-f0-9]+$/.test(root.a)) return false;
		JSON.parse(rows.get(root.a.slice(2)));
		return true;
	} catch {
		return false;
	}
}

/**
 * One timed request. Returns a result record; never rejects so a failing
 * request is data, not a crashed schedule.
 */
export function timedRequest(port, spec) {
	return new Promise((resolve) => {
		const started = performance.now();
		const chunks =
			spec.collectBody || spec.expectAction || spec.tag === "contract"
				? []
				: null;
		const req = http.request(
			{
				host: HOST,
				port,
				path: spec.path,
				method: spec.method ?? "GET",
				headers: spec.headers ?? {},
				agent:
					spec.tag === "health"
						? healthAgent
						: spec.keepAlive === false
							? agentNoKeepAlive
							: agent,
				timeout: spec.timeoutMs ?? 20_000,
			},
			(res) => {
				const ttfb = performance.now() - started;
				let bytes = 0;
				res.on("data", (c) => {
					bytes += c.length;
					if (chunks) chunks.push(c);
				});
				res.on("end", () => {
					const total = performance.now() - started;
					// Contract hashing uses the decoded body so zlib chunking
					// differences between runtimes don't masquerade as content
					// differences; the wire byte count stays recorded.
					let decoded;
					let decodeError = null;
					if (chunks) {
						const raw = Buffer.concat(chunks);
						try {
							decoded =
								spec.method === "HEAD" || res.statusCode === 304
									? raw
									: res.headers["content-encoding"] === "gzip"
										? zlib.gunzipSync(raw)
										: res.headers["content-encoding"] === "br"
											? zlib.brotliDecompressSync(raw)
											: raw;
						} catch (err) {
							decodeError = `body decode failed: ${err.message}`;
							decoded = raw;
						}
					}
					const actionSucceeded = spec.expectAction
						? successfulActionResponse(
								{
									status: res.statusCode,
									contentType: res.headers["content-type"],
								},
								decoded,
							)
						: undefined;
					resolve({
						path: spec.path,
						tag: spec.tag,
						status: res.statusCode,
						ttfbMs: round2(ttfb),
						totalMs: round2(total),
						bytes,
						error:
							decodeError ??
							(actionSucceeded === false
								? "server action did not fulfill successfully"
								: null),
						actionSucceeded,
						contentType: res.headers["content-type"],
						contentEncoding: res.headers["content-encoding"],
						vary: res.headers.vary,
						cacheControl: res.headers["cache-control"],
						etag: res.headers.etag,
						location: res.headers.location,
						bodySha256: chunks ? sha256(decoded) : undefined,
						decodedBytes: chunks ? decoded.length : undefined,
					});
				});
				res.on("error", (err) => {
					resolve({
						path: spec.path,
						tag: spec.tag,
						status: res.statusCode ?? 0,
						ttfbMs: round2(ttfb),
						totalMs: round2(performance.now() - started),
						bytes,
						error: String(err?.message ?? err),
					});
				});
			},
		);
		req.on("timeout", () => req.destroy(new Error("client timeout")));
		req.on("error", (err) => {
			resolve({
				path: spec.path,
				tag: spec.tag,
				status: 0,
				ttfbMs: round2(performance.now() - started),
				totalMs: round2(performance.now() - started),
				bytes: 0,
				error: String(err?.message ?? err),
			});
		});
		if (spec.body) req.write(spec.body);
		req.end();
	});
}

/**
 * Offset-driven request schedule: every item fires at `offsetMs` relative to
 * t0 regardless of how slow earlier requests are — identical offered load for
 * both runtimes.
 */
async function runSchedule(port, specs, onResult) {
	const t0 = performance.now();
	const results = await Promise.all(
		specs.map(async (spec) => {
			const wait = spec.offsetMs - (performance.now() - t0);
			if (wait > 0) await sleep(wait);
			const startedAt = performance.now() - t0;
			const r = await timedRequest(port, spec);
			r.startedAtMs = round2(startedAt);
			r.scheduledAtMs = spec.offsetMs;
			r.scheduleLatenessMs = round2(Math.max(0, startedAt - spec.offsetMs));
			if (onResult) onResult(r);
			return r;
		}),
	);
	return results;
}

// ---------------------------------------------------------------------------
// process-tree sampler (external measurement — same for both runtimes)
// ---------------------------------------------------------------------------

/**
 * Spawns a PowerShell sampler that prints `elapsedMs,cpuSeconds,workingSet,
 * peakWorkingSet` summed over the wrapper's process tree every `intervalMs`.
 * Returns { pid, lines(), stop() }.
 */
export function startSampler(
	wrapperPid,
	intervalMs = 400,
	command = "powershell.exe",
) {
	const ps = [
		`$w=${wrapperPid}`,
		"$sw=[Diagnostics.Stopwatch]::StartNew()",
		"while ($true) {",
		'  $kids = @(Get-CimInstance Win32_Process -Filter "ParentProcessId=$w" -ErrorAction SilentlyContinue | ForEach-Object ProcessId)',
		"  $ids = @($w) + $kids",
		"  $cpu = 0.0; $ws = [long]0; $peak = [long]0; $alive = $false",
		"  foreach ($i in $ids) { $p = Get-Process -Id $i -ErrorAction SilentlyContinue; if ($null -ne $p) { $alive = $true; $cpu += $p.CPU; $ws += $p.WorkingSet64; $peak += $p.PeakWorkingSet64 } }",
		"  if (-not $alive) { break }",
		'  Write-Output "$($sw.ElapsedMilliseconds),$cpu,$ws,$peak"',
		`  Start-Sleep -Milliseconds ${intervalMs}`,
		"}",
	].join("; ");
	const proc = spawn(
		command,
		["-NoProfile", "-NonInteractive", "-Command", ps],
		{ stdio: ["ignore", "pipe", "pipe"], windowsHide: true },
	);
	let buf = "";
	let failure = null;
	let stopped = false;
	proc.once("error", (err) => {
		failure = `sampler spawn failed: ${err.message}`;
	});
	proc.once("exit", (code) => {
		if (!stopped && code !== 0) failure = `sampler exited with ${code}`;
	});
	proc.stderr.on("data", (chunk) => {
		failure = `sampler: ${chunk.toString().slice(0, 500)}`;
	});
	const lines = [];
	proc.stdout.on("data", (c) => {
		buf += c.toString();
		for (let idx = buf.indexOf("\n"); idx >= 0; idx = buf.indexOf("\n")) {
			const line = buf.slice(0, idx).trim();
			buf = buf.slice(idx + 1);
			if (line) lines.push(line);
		}
	});
	return {
		pid: proc.pid,
		assertHealthy() {
			if (failure) throw new Error(failure);
			if (this.samples().length === 0)
				throw new Error("sampler produced no measurements");
		},
		/** Latest cumulative CPU-seconds across the tree (±1 sample interval). */
		cpuMark() {
			const s = this.samples();
			return s.length ? s[s.length - 1].cpuSeconds : null;
		},
		samples() {
			return lines
				.map((l) => l.split(","))
				.filter((p) => p.length === 4 && Number.isFinite(Number(p[0])))
				.map(([ms, cpu, ws, peak]) => ({
					ms: Number(ms),
					cpuSeconds: Number(cpu),
					rssBytes: Number(ws),
					peakRssBytes: Number(peak),
				}));
		},
		stop() {
			stopped = true;
			try {
				proc.kill();
			} catch {
				/* sampler already exited */
			}
		},
	};
}

/** Names of the wrapper's direct children — runtime proof (node.exe vs bun.exe). */
function childProcessInfo(wrapperPid) {
	const out = spawnSync(
		"powershell.exe",
		[
			"-NoProfile",
			"-NonInteractive",
			"-Command",
			`Get-CimInstance Win32_Process -Filter "ParentProcessId=${wrapperPid}" | Select-Object ProcessId,Name,CommandLine | ConvertTo-Json -Compress`,
		],
		{ encoding: "utf8" },
	);
	if (out.error || out.status !== 0)
		throw new Error(
			`child process inspection failed: ${out.error?.message ?? out.stderr}`,
		);
	try {
		const parsed = JSON.parse(out.stdout.trim() || "null");
		return parsed ? (Array.isArray(parsed) ? parsed : [parsed]) : [];
	} catch {
		return [];
	}
}

function processAlive(pid) {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}

function killTree(rootPid, knownChildren = []) {
	// Retain child PIDs before SIGTERM: Windows can kill the wrapper while
	// leaving its child orphaned, after which taskkill /T on the wrapper fails.
	for (const pid of [rootPid, ...knownChildren]) {
		if (!pid || !processAlive(pid)) continue;
		const result = spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], {
			stdio: "ignore",
			windowsHide: true,
		});
		if (result.error) throw result.error;
	}
	const survivors = [rootPid, ...knownChildren].filter(
		(pid) => pid && processAlive(pid),
	);
	if (survivors.length)
		throw new Error(
			`server processes survived cleanup: ${survivors.join(",")}`,
		);
}

// ---------------------------------------------------------------------------
// server lifecycle
// ---------------------------------------------------------------------------

export function resolveRuntimeCommand(runtime) {
	if (runtime === "node") return process.execPath; // same Node the harness runs on
	const which = spawnSync(
		process.platform === "win32" ? "where" : "which",
		["bun"],
		{ encoding: "utf8" },
	);
	// Prefer a directly spawnable binary; shims without an extension cannot be
	// exec'd by child_process on Windows.
	const candidates = (which.stdout ?? "")
		.trim()
		.split(/\r?\n/)
		.map((l) => l.trim())
		.filter(Boolean);
	// npm's Windows bun.cmd shim is not directly spawnable. Resolve the native
	// binary installed beside that shim, rather than passing a .cmd to spawn.
	const bin =
		process.platform === "win32"
			? candidates
					.flatMap((p) => [
						p,
						path.join(path.dirname(p), "node_modules/bun/bin/bun.exe"),
					])
					.find((p) => /\.exe$/i.test(p) && existsSync(p))
			: candidates[0];
	if (!bin) throw new Error("bun not found on PATH");
	return bin;
}

/**
 * Spawns the production wrapper under `runtime`, waits for liveness then the
 * real readiness probe, and returns handles for measurement and teardown.
 */
async function startServer({ runtime, port, extraEnv, diagnostics }) {
	const cmd = resolveRuntimeCommand(runtime);
	const env = {
		...process.env,
		...extraEnv,
		NODE_ENV: "production",
		PORT: String(port),
		HOSTNAME: HOST,
		NEXT_TELEMETRY_DISABLED: "1",
	};
	if (diagnostics) env.ENABLE_EVENT_LOOP_DIAGNOSTICS = "1";
	const wrapper = spawn(cmd, [WRAPPER], {
		cwd: STANDALONE,
		env,
		stdio: ["ignore", "pipe", "pipe"],
	});
	const serverLog = [];
	let spawnError = null;
	wrapper.once("error", (err) => {
		spawnError = String(err?.message ?? err);
	});
	const onData = (c) => {
		serverLog.push(c.toString());
		if (serverLog.length > 400) serverLog.shift();
	};
	wrapper.stdout.on("data", onData);
	wrapper.stderr.on("data", onData);
	return { wrapper, serverLog, spawnErrorRef: () => spawnError };
}

async function waitReady(port, timeoutMs = 240_000) {
	const t0 = performance.now();
	let liveAt = null;
	for (;;) {
		const r = await timedRequest(port, {
			path: "/api/health",
			timeoutMs: 3000,
			keepAlive: false,
		});
		if (r.status === 200 && liveAt === null) {
			liveAt = performance.now() - t0;
			break;
		}
		if (performance.now() - t0 > timeoutMs)
			throw new Error("server never became live");
		await sleep(250);
	}
	for (;;) {
		const r = await timedRequest(port, {
			path: "/api/health/ready",
			timeoutMs: 10_000,
			keepAlive: false,
		});
		if (r.status === 200) {
			return {
				liveMs: round2(liveAt),
				readyMs: round2(performance.now() - t0),
			};
		}
		if (performance.now() - t0 > timeoutMs)
			throw new Error("server never became ready");
		await sleep(400);
	}
}

// ---------------------------------------------------------------------------
// workloads
// ---------------------------------------------------------------------------

const HTML_HEADERS = {
	Accept:
		"text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
	"Accept-Encoding": "gzip",
	"User-Agent": "runtime-bench/1.0",
};
const RSC_HEADERS = {
	...HTML_HEADERS,
	RSC: "1",
};

function fixtureSpecs(fixture) {
	return fixture.ordinary.paths.map((p, i) => ({
		path: p,
		offsetMs: i * (1000 / fixture.ordinary.startsPerSecond),
		headers: p.includes("_rsc") ? RSC_HEADERS : HTML_HEADERS,
		tag: "ordinary",
	}));
}

function burstSpecs(fixture) {
	return fixture.peak.requests.map((r) => ({
		path: r.path,
		offsetMs: r.offset * 1000,
		headers: r.path.includes("_rsc") ? RSC_HEADERS : HTML_HEADERS,
		tag: "burst",
		sourceStatus: r.sourceStatus,
	}));
}

/**
 * The fixture's `?_rsc=<nonce>` URLs replay the logged first hop, which the
 * current build answers 307 → canonical `?_rsc`. The delivered warmed-RSC
 * response lives behind that canonical form — measure it directly with the
 * same RSC-marked path set and schedule.
 */
function rscSpecs(fixture) {
	const rscPaths = fixture.ordinary.paths.filter((p) => p.includes("_rsc"));
	return rscPaths.map((p, i) => ({
		path: p.replace(/([?&])_rsc=[^&]*/, "$1_rsc"),
		offsetMs: i * (1000 / fixture.ordinary.startsPerSecond),
		headers: RSC_HEADERS,
		tag: "rsc",
	}));
}

/** First-hit probes on distinct route types — run once per fresh server. */
function coldSpecs(SERVER_ACTIONS) {
	const specs = [
		{ path: "/", headers: HTML_HEADERS },
		{ path: "/929/1", headers: HTML_HEADERS },
		{ path: "/929/1?_rsc=cold", headers: RSC_HEADERS },
		{ path: "/929/161/%D7%A8%D7%9E%D7%91%22%D7%9F", headers: HTML_HEADERS },
		{ path: "/%D7%9E%D7%A1%D7%95%D7%A8%D7%94/485", headers: HTML_HEADERS },
		{ path: "/%D7%A4%D7%A8%D7%A9%D7%94", headers: HTML_HEADERS },
		{ path: "/api/search?q=%D7%90%D7%9C%D7%94%D7%99%D7%9D&limit=10" },
		{ path: "/api/recitation" },
		{ path: "/api/recitation/2" },
		{
			path: "/_next/image?url=%2Fimages%2Flogos%2Flogo192.webp&w=256&q=75",
		},
		{
			path: "/929/1",
			method: "POST",
			headers: {
				"Next-Action": SERVER_ACTIONS.dedicationLines,
				"Content-Type": "text/plain;charset=UTF-8",
			},
			body: "[]",
			expectAction: true,
		},
		{ path: "/bookshelf", headers: HTML_HEADERS },
	];
	return specs.map((s, i) => ({
		...s,
		offsetMs: i * 1500,
		tag: "cold",
		collectBody: true,
	}));
}

/** Dynamic API/action mix — the non-cached production surface. */
function apiMixSpecs(SERVER_ACTIONS) {
	const items = [
		{ path: "/api/health/ready", tag: "api" },
		{ path: "/api/recitation", tag: "api" },
		{ path: "/api/recitation/2", tag: "api" },
		{ path: "/api/recitation/929", tag: "api" },
		{
			path: "/api/search?q=%D7%90%D7%9C%D7%94%D7%99%D7%9D&limit=10",
			tag: "api",
		},
		{
			path: "/api/search?q=%D7%95%D7%99%D7%94%D7%99&limit=10",
			tag: "api",
		},
		{ path: "/api/tanah/pasuk/1/1", tag: "api" },
		{ path: "/api/tanah/pasuk/929/7", tag: "api" },
		{
			path: "/_next/image?url=%2Fimages%2Flogos%2Flogo192.webp&w=256&q=75",
			tag: "api",
		},
		{
			path: "/929/1",
			method: "POST",
			headers: {
				"Next-Action": SERVER_ACTIONS.dedicationLines,
				"Content-Type": "text/plain;charset=UTF-8",
			},
			body: "[]",
			expectAction: true,
			tag: "action",
		},
		{
			path: "/929/1",
			method: "POST",
			headers: {
				"Next-Action": SERVER_ACTIONS.perekSummariesBatch,
				"Content-Type": "text/plain;charset=UTF-8",
			},
			body: "[[1,2,3,4,5]]",
			expectAction: true,
			tag: "action",
		},
	];
	const specs = [];
	for (let rep = 0; rep < 6; rep++)
		for (const it of items) specs.push({ ...it, offsetMs: specs.length * 500 });
	return specs;
}

/**
 * Response-contract probes: same checks on both runtimes; the report compares
 * the records field by field.
 */
async function contractChecks(port, SERVER_ACTIONS) {
	const results = [];
	const push = (name, r) => results.push({ name, ...r });

	// Status + body hash on representative paths (Hebrew percent-encoded incl.)
	for (const [path_, headers] of [
		["/", HTML_HEADERS],
		["/929/1", HTML_HEADERS],
		["/929/161/%D7%A8%D7%9E%D7%91%22%D7%9F", HTML_HEADERS],
		["/%D7%9E%D7%A1%D7%95%D7%A8%D7%94/485", HTML_HEADERS],
		["/929/1?_rsc=contract", RSC_HEADERS],
		["/api/recitation/2", {}],
	]) {
		push(
			`GET ${path_}`,
			await timedRequest(port, {
				path: path_,
				headers,
				collectBody: true,
				tag: "contract",
			}),
		);
	}

	// Explicit RSC-vs-HTML distinction WITHOUT the _rsc marker: the RSC header
	// alone must flip the payload type.
	push(
		"explicit-rsc-header",
		await timedRequest(port, {
			path: "/929/2",
			headers: RSC_HEADERS,
			collectBody: true,
			tag: "contract",
		}),
	);
	push(
		"explicit-html",
		await timedRequest(port, {
			path: "/929/2",
			headers: HTML_HEADERS,
			collectBody: true,
			tag: "contract",
		}),
	);

	// Second RSC hop: the canonical `?_rsc` URL serves the prerendered flight
	// payload — byte-identical across runtimes if delivery is correct.
	push(
		"rsc-second-hop",
		await timedRequest(port, {
			path: "/929/2?_rsc",
			headers: RSC_HEADERS,
			collectBody: true,
			tag: "contract",
		}),
	);

	// Canonical redirect through the middleware (legacy alias).
	push(
		"redirect-tanahpedia",
		await timedRequest(port, {
			path: "/tanahpedia/jerusalem",
			headers: HTML_HEADERS,
			tag: "contract",
		}),
	);

	// ETag conditional GET on a static asset.
	const asset = await timedRequest(port, {
		path: "/images/logos/logo192.webp",
		tag: "contract",
	});
	push("static-asset", asset);
	if (asset.etag) {
		push(
			"static-asset-304",
			await timedRequest(port, {
				path: "/images/logos/logo192.webp",
				headers: { "If-None-Match": asset.etag },
				tag: "contract",
			}),
		);
	}

	// HEAD on an HTML route and a static asset.
	push(
		"HEAD /929/1",
		await timedRequest(port, {
			path: "/929/1",
			method: "HEAD",
			headers: HTML_HEADERS,
			tag: "contract",
		}),
	);

	// Compression negotiation on a prerendered page.
	push(
		"gzip-negotiation",
		await timedRequest(port, {
			path: "/929/3",
			headers: { ...HTML_HEADERS, "Accept-Encoding": "gzip" },
			tag: "contract",
		}),
	);

	// Brotli-only client: does either runtime compress where the other sends
	// identity? (Also feeds Vary correctness checks.)
	push(
		"br-negotiation",
		await timedRequest(port, {
			path: "/929/3",
			headers: { ...HTML_HEADERS, "Accept-Encoding": "br" },
			tag: "contract",
		}),
	);

	// Server action contract (status + body hash).
	push(
		"action-dedication",
		await timedRequest(port, {
			path: "/929/1",
			method: "POST",
			headers: {
				"Next-Action": SERVER_ACTIONS.dedicationLines,
				"Content-Type": "text/plain;charset=UTF-8",
			},
			body: "[]",
			expectAction: true,
			collectBody: true,
			tag: "contract",
		}),
	);
	push(
		"action-summaries",
		await timedRequest(port, {
			path: "/929/1",
			method: "POST",
			headers: {
				"Next-Action": SERVER_ACTIONS.perekSummariesBatch,
				"Content-Type": "text/plain;charset=UTF-8",
			},
			body: "[[1,2,3,4,5]]",
			expectAction: true,
			tag: "contract",
		}),
	);

	// Invalid action must reject identically.
	push(
		"action-invalid",
		await timedRequest(port, {
			path: "/929/1",
			method: "POST",
			headers: {
				"Next-Action": "0000000000000000000000000000000000000000",
				"Content-Type": "text/plain;charset=UTF-8",
			},
			body: "[]",
			tag: "contract",
		}),
	);

	// Client disconnect mid-body on a dynamic route: the server must tolerate
	// the aborted response and keep serving (production bursts are 499-heavy).
	await new Promise((resolve) => {
		const req = http.request(
			{
				host: HOST,
				port,
				path: "/api/search?q=%D7%90%D7%9C%D7%94%D7%99%D7%9D&limit=50",
				headers: HTML_HEADERS,
				agent: agentNoKeepAlive,
			},
			(res) => {
				res.once("data", () => req.destroy()); // abort after first byte
				res.on("error", () => {});
				res.on("end", resolve);
				res.on("close", resolve);
			},
		);
		req.on("error", () => resolve());
		setTimeout(resolve, 5000).unref();
		req.end();
	});
	push(
		"post-disconnect-health",
		await timedRequest(port, { path: "/api/health", tag: "contract" }),
	);

	return results;
}

// ---------------------------------------------------------------------------
// one measured server run
// ---------------------------------------------------------------------------

async function runInstance({
	runtime,
	port,
	fixture,
	extraEnv,
	diagnostics,
	workloads,
	serverActions,
}) {
	const { wrapper, serverLog, spawnErrorRef } = await startServer({
		runtime,
		port,
		extraEnv,
		diagnostics,
	});
	await sleep(500); // let an immediate spawn error surface before the wait
	if (spawnErrorRef()) {
		const record = {
			runtime,
			port,
			startedAt: new Date().toISOString(),
			startupError: `spawn failed: ${spawnErrorRef()}`,
			workloads: {},
			serverLogTail: serverLog.slice(-40),
		};
		killTree(wrapper.pid);
		return record;
	}
	const sampler = startSampler(wrapper.pid);
	const record = {
		schemaVersion: 2,
		runtime,
		port,
		diagnostics: Boolean(diagnostics),
		startedAt: new Date().toISOString(),
		workloads: {},
	};
	try {
		const ready = await waitReady(port);
		record.startup = ready;
		sampler.assertHealthy();
		// Runtime proof: the wrapper's child must be the same runtime family.
		await sleep(300); // one beat for WMI to see the child
		record.serverChildren = childProcessInfo(wrapper.pid).map((c) => ({
			pid: c.ProcessId,
			name: c.Name,
			commandLine: String(c.CommandLine).slice(0, 160),
		}));
		if (
			!record.serverChildren.some(
				(c) => c.name?.toLowerCase() === `${runtime}.exe`,
			)
		)
			throw new Error(`could not prove ${runtime} server child`);
	} catch (err) {
		// A runtime that never becomes ready is a compatibility result, not a
		// lost run — keep the record with whatever the server logged.
		record.startupError = String(err?.message ?? err);
	}

	try {
		const ready = !record.startupError;
		record.cpuMarks = { startupDone: sampler.cpuMark() };
		if (ready && workloads.includes("cold")) {
			record.workloads.cold = await runSchedule(port, coldSpecs(serverActions));
			record.cpuMarks.coldDone = sampler.cpuMark();
		}

		if (ready && workloads.includes("ordinary")) {
			const specs = fixtureSpecs(fixture);
			// Independent health checks on a separate agent, like the ECS
			// healthcheck racing ordinary traffic.
			const health = [];
			const healthTimer = setInterval(() => {
				health.push(
					timedRequest(port, {
						path: "/api/health/ready",
						tag: "health",
					}),
				);
			}, 1000);
			try {
				record.workloads.ordinary = await runSchedule(port, specs);
			} finally {
				clearInterval(healthTimer);
				record.workloads.healthDuringOrdinary = await Promise.all(health);
			}
		}

		record.cpuMarks.ordinaryDone = sampler.cpuMark();
		if (ready && workloads.includes("rsc")) {
			record.workloads.rsc = await runSchedule(port, rscSpecs(fixture));
			record.cpuMarks.rscDone = sampler.cpuMark();
		}
		if (ready && workloads.includes("api")) {
			record.workloads.apiMix = await runSchedule(
				port,
				apiMixSpecs(serverActions),
			);
			record.cpuMarks.apiDone = sampler.cpuMark();
		}

		if (ready && workloads.includes("burst")) {
			record.workloads.burst = await runSchedule(port, burstSpecs(fixture));
			record.cpuMarks.burstDone = sampler.cpuMark();
		}

		if (ready && workloads.includes("contract"))
			record.workloads.contract = await contractChecks(port, serverActions);

		// A quiet tail records post-burst memory; it does not establish
		// sustained-load memory stability or rule out a leak.
		await sleep(5000);
		sampler.assertHealthy();
	} catch (err) {
		record.workloadError = String(err?.message ?? err);
	} finally {
		// Shutdown evidence: try POSIX semantics first, then force the tree
		// down — Windows cannot deliver SIGTERM to the wrapper.
		const t = performance.now();
		const knownChildren = new Set(
			record.serverChildren?.map((c) => c.pid) ?? [],
		);
		try {
			for (const child of childProcessInfo(wrapper.pid))
				knownChildren.add(child.ProcessId);
		} catch (err) {
			record.workloadError = `cleanup inspection failed: ${err.message}`;
		}
		record.processSamples = sampler.samples();
		record.samplesBeforeShutdown = true;
		sampler.stop();
		wrapper.kill("SIGTERM");
		await sleep(3000);
		record.shutdown = {
			sigtermSent: true,
			childrenAliveAfterSigterm3s: [...knownChildren].filter(processAlive)
				.length,
			platform: process.platform,
		};
		killTree(wrapper.pid, [...knownChildren]);
		await sleep(500);
		record.shutdown.forceCleanMs = round2(performance.now() - t);
		record.serverLogTail = serverLog.slice(-40);
	}
	return record;
}

// ---------------------------------------------------------------------------
// driver + report
// ---------------------------------------------------------------------------

async function cmdRun(args) {
	// Fail before starting any server on unsupported hosts.
	assertRunPlatform();
	const manifestPath = path.join(
		STANDALONE,
		".next/server/server-reference-manifest.json",
	);
	const serverActions = resolveServerActions(readJson(manifestPath));
	const fixturePath = path.resolve(args.fixture);
	const fixture = JSON.parse(readFileSync(fixturePath, "utf8"));
	const trials = Number(args.trials ?? 3);
	const basePort = Number(args["base-port"] ?? 3210);
	const outDir = path.resolve(args.out ?? "runtime-bench-out");
	const envFile = args["env-file"] ?? path.join(APP_ROOT, ".dev.env");
	const extraEnv = loadEnvFile(envFile);
	const workloads = String(
		args.workloads ?? "cold,ordinary,rsc,api,burst,contract",
	).split(",");
	if (!Number.isSafeInteger(trials) || trials < 1)
		throw new Error("trials must be a positive integer");
	mkdirSync(outDir, { recursive: true });

	const meta = {
		sourceSha: spawnSync("git", ["rev-parse", "HEAD"], {
			cwd: APP_ROOT,
			encoding: "utf8",
		}).stdout.trim(),
		nodeVersion: spawnSync(process.execPath, ["--version"], {
			encoding: "utf8",
		}).stdout.trim(),
		bunVersion: spawnSync(resolveRuntimeCommand("bun"), ["--version"], {
			encoding: "utf8",
		}).stdout.trim(),
		platform: `${process.platform} ${process.arch}`,
		cpus: (await import("node:os")).cpus().length,
		cpuModel: (await import("node:os")).cpus()[0]?.model,
		totalMemBytes: (await import("node:os")).totalmem(),
		fixture: path.relative(APP_ROOT, fixturePath),
		standaloneDir: path.relative(APP_ROOT, STANDALONE),
		buildId: readFileSync(
			path.join(STANDALONE, ".next/BUILD_ID"),
			"utf8",
		).trim(),
		serverSha256: sha256(readFileSync(path.join(STANDALONE, "server.js"))),
		actionManifestSha256: sha256(readFileSync(manifestPath)),
		serverActions,
		startedAt: new Date().toISOString(),
	};
	writeFileSync(path.join(outDir, "meta.json"), JSON.stringify(meta, null, 2));
	console.log("bench meta:", JSON.stringify(meta));

	for (let trial = 0; trial < trials; trial++) {
		// Alternate runtime order so warmup/host-cache effects pair out.
		const order = trial % 2 === 0 ? ["node", "bun"] : ["bun", "node"];
		for (const runtime of order) {
			const port = basePort + trial * 10 + (runtime === "bun" ? 1 : 0);
			console.log(`\n=== trial ${trial} runtime ${runtime} port ${port} ===`);
			const rec = await runInstance({
				runtime,
				port,
				fixture,
				extraEnv,
				workloads,
				diagnostics: Boolean(args.diagnostics),
				serverActions,
			});
			const suffix = args.diagnostics ? "-diag" : "";
			const file = path.join(outDir, `trial${trial}-${runtime}${suffix}.json`);
			writeFileSync(file, JSON.stringify(rec));
			if (
				rec.startupError ||
				rec.workloadError ||
				Object.values(rec.workloads).some((rs) => rs.some((r) => r.error))
			)
				process.exitCode = 1;
			console.log(
				`wrote ${file}: ready=${rec.startup?.readyMs}ms, children=${rec.serverChildren?.map((c) => c.name)}`,
			);
		}
	}
	cmdReport({ in: outDir });
}

export function summarizeRun(rec) {
	const out = {
		runtime: rec.runtime,
		startup: rec.startup,
		startupError: rec.startupError,
		workloadError: rec.workloadError,
		serverChildren: rec.serverChildren,
		shutdown: rec.shutdown,
	};
	const mark = rec.cpuMarks ?? {};
	const cpuSpan = {
		cold: [mark.startupDone, mark.coldDone],
		ordinary: [mark.coldDone ?? mark.startupDone, mark.ordinaryDone],
		rsc: [mark.ordinaryDone, mark.rscDone],
		apiMix: [mark.rscDone ?? mark.ordinaryDone, mark.apiDone],
		burst: [mark.apiDone ?? mark.rscDone ?? mark.ordinaryDone, mark.burstDone],
	};
	for (const [name, results] of Object.entries(rec.workloads)) {
		if (!Array.isArray(results)) continue;
		const errors = results.filter(
			(r) => r.error || r.status === 0 || r.status >= 500,
		);
		const ttfbs = results.map((r) => r.ttfbMs);
		const totals = results.map((r) => r.totalMs);
		// Window throughput = span of the offered schedule, not per-request mean.
		const span =
			Math.max(...results.map((r) => (r.startedAtMs ?? 0) + r.totalMs), 0) -
			Math.min(...results.map((r) => r.startedAtMs ?? 0), Infinity);
		const cpuBounds = cpuSpan[name];
		out[name] = {
			requests: results.length,
			errors: errors.length,
			errorSample: errors.slice(0, 5).map((r) => ({
				path: r.path,
				status: r.status,
				error: r.error,
			})),
			ttfb: stats(ttfbs),
			total: stats(totals),
			scheduleLateness: stats(results.map((r) => r.scheduleLatenessMs)),
			windowSec: round2(span / 1000),
			rps: round2(results.length / (span / 1000)),
			cpuSeconds:
				cpuBounds?.[0] != null && cpuBounds?.[1] != null
					? round2(cpuBounds[1] - cpuBounds[0])
					: undefined,
			cpuMsPerRequest:
				cpuBounds?.[0] != null && cpuBounds?.[1] != null
					? round2(((cpuBounds[1] - cpuBounds[0]) * 1000) / results.length)
					: undefined,
		};
	}
	// CPU/RSS from the external sampler.
	const s = rec.processSamples ?? [];
	if (s.length >= 2) {
		out.process = {
			cpuSecondsTotal: round2(s[s.length - 1].cpuSeconds - s[0].cpuSeconds),
			// Legacy samples include shutdown; their last RSS may be a dying
			// wrapper alone, so do not present it as a steady-state footprint.
			rssEndMB: rec.samplesBeforeShutdown
				? round2(s[s.length - 1].rssBytes / 1048576)
				: null,
			rssLastSampleMB: round2(s[s.length - 1].rssBytes / 1048576),
			rssPeakMB: round2(Math.max(...s.map((x) => x.rssBytes)) / 1048576),
			rssSumOfProcessPeaksMB: round2(
				Math.max(...s.map((x) => x.peakRssBytes)) / 1048576,
			),
			rssMeanMB: round2(
				s.reduce((a, x) => a + x.rssBytes, 0) / s.length / 1048576,
			),
			samples: s.length,
		};
	}
	return out;
}

function readJsonText(file) {
	const bytes = readFileSync(file);
	return (file.endsWith(".gz") ? zlib.gunzipSync(bytes) : bytes).toString("utf8");
}

export function readJson(file) {
	return JSON.parse(readJsonText(file));
}

function writeJson(file, value) {
	const json = JSON.stringify(value, null, 2);
	writeFileSync(file, file.endsWith(".gz") ? zlib.gzipSync(json) : json);
}

const BASE_CONTRACT_PROBES = [
	"GET /",
	"GET /929/1",
	"GET /929/161/%D7%A8%D7%9E%D7%91%22%D7%9F",
	"GET /%D7%9E%D7%A1%D7%95%D7%A8%D7%94/485",
	"GET /929/1?_rsc=contract",
	"GET /api/recitation/2",
	"explicit-rsc-header",
	"explicit-html",
	"rsc-second-hop",
	"redirect-tanahpedia",
	"static-asset",
	"static-asset-304",
	"HEAD /929/1",
	"gzip-negotiation",
	"br-negotiation",
	"action-dedication",
	"action-invalid",
	"post-disconnect-health",
];

function semanticHeader(field, value) {
	if (value == null) return null;
	if (field === "vary")
		return value
			.toLowerCase()
			.split(",")
			.map((x) => x.trim())
			.sort()
			.join(",");
	// JSON is UTF-8. Retain the observed spelling difference in the report.
	if (
		field === "contentType" &&
		/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(value)
	)
		return "application/json";
	return value;
}

export function compareContracts(node, bun) {
	const mismatches = [];
	const headerDifferences = [];
	const unrecordedBodyProbes = [];
	const index = (rec, runtime) => {
		const map = new Map();
		for (const probe of rec.workloads?.contract ?? []) {
			if (map.has(probe.name))
				mismatches.push({ probe: probe.name, field: "duplicate", runtime });
			map.set(probe.name, probe);
		}
		return map;
	};
	const n = index(node, "node");
	const b = index(bun, "bun");
	if (!n.size && !b.size)
		return {
			status: "not-assessed",
			mismatches,
			headerDifferences,
			unrecordedBodyProbes,
		};
	const required = [
		...BASE_CONTRACT_PROBES,
		...(node.schemaVersion >= 2 || bun.schemaVersion >= 2
			? ["action-summaries"]
			: []),
	];
	for (const name of new Set([...required, ...n.keys(), ...b.keys()])) {
		const nr = n.get(name);
		const br = b.get(name);
		if (!nr || !br) {
			mismatches.push({
				probe: name,
				field: "missing",
				node: Boolean(nr),
				bun: Boolean(br),
			});
			continue;
		}
		for (const field of [
			"status",
			"error",
			"contentType",
			"contentEncoding",
			"vary",
			"cacheControl",
			"etag",
			"location",
			"bodySha256",
			"decodedBytes",
		]) {
			if (semanticHeader(field, nr[field]) !== semanticHeader(field, br[field]))
				mismatches.push({
					probe: name,
					field,
					node: nr[field] ?? null,
					bun: br[field] ?? null,
				});
			else if ((nr[field] ?? null) !== (br[field] ?? null))
				headerDifferences.push({
					probe: name,
					field,
					node: nr[field] ?? null,
					bun: br[field] ?? null,
				});
		}
		if (nr.error || br.error)
			mismatches.push({ probe: name, field: "request-error" });
		if (!nr.bodySha256 && !br.bodySha256) unrecordedBodyProbes.push(name);
		for (const [runtime, probe] of [
			["node", nr],
			["bun", br],
		]) {
			const expected =
				name === "action-invalid"
					? 400
					: name === "static-asset-304"
						? 304
						: name === "redirect-tanahpedia"
							? 308
							: ["explicit-rsc-header", "GET /929/1?_rsc=contract"].includes(
										name,
									)
								? 307
								: name.includes("/929/161/")
									? 404
									: 200;
			if (probe.status !== expected)
				mismatches.push({
					probe: name,
					field: "expected-status",
					runtime,
					expected,
					actual: probe.status,
				});
			if (
				name.startsWith("action-") &&
				name !== "action-invalid" &&
				(probe.actionSucceeded === false ||
					((runtime === "node" ? node : bun).schemaVersion >= 2 &&
						probe.actionSucceeded !== true) ||
					!probe.contentType?.startsWith("text/x-component"))
			)
				mismatches.push({ probe: name, field: "action-result", runtime });
		}
	}
	return {
		status: mismatches.length ? "failed" : "passed",
		mismatches,
		headerDifferences,
		unrecordedBodyProbes,
	};
}

export function cmdReport(args) {
	const inDir = path.resolve(args.in);
	const files = readdirSync(inDir)
		.filter((f) => /^trial\d+-(node|bun)(-diag)?\.json(?:\.gz)?$/.test(f))
		.sort();
	if (!files.length) throw new Error(`No trial files in ${inDir}`);
	const rows = [];
	const pairs = new Map();
	for (const f of files) {
		const [, trial, runtime, diag = ""] = f.match(
			/^trial(\d+)-(node|bun)(-diag)?\.json/,
		);
		const key = `trial${trial}${diag}`;
		const pair = pairs.get(key) ?? {};
		if (pair[runtime])
			throw new Error(`Duplicate ${runtime} evidence for ${key}`);
		const rec = readJson(path.join(inDir, f));
		if (rec.runtime !== runtime) throw new Error(`Runtime mismatch in ${f}`);
		pair[runtime] = rec;
		pairs.set(key, pair);
		rows.push({ file: f, ...summarizeRun(rec) });
	}
	const compatibility = [...pairs].map(([trial, pair]) => ({
		trial,
		...(pair.node && pair.bun
			? compareContracts(pair.node, pair.bun)
			: { status: "failed", mismatches: [{ field: "missing-runtime" }] }),
	}));
	const outDir = path.resolve(args.out ?? inDir);
	mkdirSync(outDir, { recursive: true });
	writeJson(
		path.join(outDir, args.gzip ? "summary.json.gz" : "summary.json"),
		rows,
	);
	writeJson(
		path.join(
			outDir,
			args.gzip ? "compatibility.json.gz" : "compatibility.json",
		),
		compatibility,
	);
	for (const r of rows) {
		console.log(`\n### ${r.file}`);
		console.log(JSON.stringify(r, null, 1));
	}
	console.log("Paired compatibility:", JSON.stringify(compatibility, null, 2));
	const failed =
		compatibility.some((p) => p.status === "failed") ||
		rows.some(
			(r) =>
				r.startupError ||
				r.workloadError ||
				Object.values(r).some((w) => w?.errors > 0),
		);
	if (failed) process.exitCode = 1;
	return { rows, compatibility, failed };
}

/**
 * Strips machine-local paths from raw result files before they are committed
 * as sanitized evidence. Operates on parsed values so JSON-escaped paths are
 * caught; timings, statuses and hashes are untouched.
 */
export function cmdSanitize(args) {
	const dir = path.resolve(args.in);
	const replacements = [
		[APP_ROOT, "<repo>"],
		[path.resolve(APP_ROOT, ".."), "<repo>"],
		[process.env.USERPROFILE ?? process.env.HOME, "<home>"],
	].filter(([from]) => Boolean(from));
	const clean = (value) => {
		if (typeof value === "string") {
			let out = value;
			for (const [from, to] of replacements) out = out.split(from).join(to);
			return out;
		}
		if (Array.isArray(value)) return value.map(clean);
		if (value && typeof value === "object") {
			const out = {};
			for (const [k, v] of Object.entries(value)) out[k] = clean(v);
			return out;
		}
		return value;
	};
	let files = 0;
	for (const f of readdirSync(dir).filter((f) => /\.json(?:\.gz)?$/.test(f))) {
		const p = path.join(dir, f);
		writeJson(p, clean(readJson(p)));
		files++;
	}
	// Guard: no absolute local path may survive.
	let leaks = 0;
	for (const f of readdirSync(dir).filter((f) => /\.json(?:\.gz)?$/.test(f))) {
		const s = readJsonText(path.join(dir, f));
		for (const m of s.matchAll(/[A-Za-z]:[\\/]+Users[\\/]+[^"\\/\s]+/g)) {
			leaks++;
			console.warn(`possible local path in ${f}: ${m[0]}`);
		}
	}
	console.log(`sanitized ${files} files, ${leaks} suspicious paths left`);
}

if (
	process.argv[1] &&
	path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
	const args = parseArgs(process.argv.slice(2));
	const mode = args._[0];
	if (mode === "run") await cmdRun(args);
	else if (mode === "report") await cmdReport(args);
	else if (mode === "sanitize") await cmdSanitize(args);
	else {
		console.error("usage: runtime-bench.mjs run|report|sanitize --<flags>");
		process.exit(1);
	}
}
