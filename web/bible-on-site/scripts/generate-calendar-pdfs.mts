/**
 * Generates the bounded set of learning-calendar PDFs (#2608).
 *
 * Layout of the artifacts directory (default `.cache/calendar-pdf`):
 *   objects/<sha256>.pdf  — content-addressed bodies; the publish workflow
 *                           syncs these to S3 under the same names
 *   manifest.json         — public manifest published last (the switch that
 *                           points /api/calendar-pdf at the objects)
 *   cache-state.json      — per-key input fingerprints for partial regen
 *
 * Modes:
 *   (default)   render every missing/stale artifact, then write manifest +
 *               cache state. Used by the publish workflow and locally.
 *   --check     never writes: reports fresh/stale/missing counts and
 *               re-renders --sample artifacts byte-comparing them against
 *               the cache, so CI proves reuse + determinism in ~seconds.
 *
 * Flags:
 *   --include a,b,c   extra canonical keys (out-of-band months/cycles)
 *   --sample N        artifacts to re-render and verify in --check (default 3)
 *   --dir PATH        artifacts directory (default .cache/calendar-pdf)
 */

import {
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import {
	buildCalendarPdfInput,
	calendarArtifactFilename,
	getCalendarArtifactBounds,
	isGeneratableArtifactKey,
	listCalendarArtifactKeys,
	type MonthCellsCache,
	parseCalendarArtifactKey,
} from "../src/lib/download/calendar-artifacts";
import { generateCalendarPdf } from "../src/lib/download/calendar-pdf";
import {
	buildCalendarPdfManifest,
	type CalendarPdfCacheArtifact,
	type CalendarPdfCacheIndex,
	calendarArtifactInputSha,
	carriedExtraKeys,
	parseCalendarPdfCacheIndex,
	planCalendarPdfGeneration,
	sha256Bytes,
} from "../src/lib/download/calendar-pdf-plan";
import {
	computeCalendarPdfFingerprint,
	computeCalendarPdfRenderFingerprint,
} from "./calendar-pdf-inputs.mjs";

const WEBSITE_ROOT = fileURLToPath(new URL("..", import.meta.url));
const DEFAULT_DIR = join(WEBSITE_ROOT, ".cache", "calendar-pdf");

interface Args {
	check: boolean;
	sample: number;
	dir: string;
	includes: string[];
}

function parseArgs(argv: string[]): Args {
	const args: Args = {
		check: false,
		sample: 3,
		dir: DEFAULT_DIR,
		includes: [],
	};
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (arg === "--check") {
			args.check = true;
		} else if (arg === "--sample") {
			args.sample = Number.parseInt(argv[++i] ?? "", 10);
		} else if (arg === "--dir") {
			args.dir = argv[++i] ?? args.dir;
		} else if (arg === "--include") {
			args.includes.push(
				...(argv[++i] ?? "")
					.split(",")
					.map((k) => k.trim())
					.filter(Boolean),
			);
		} else {
			throw new Error(`Unknown argument: ${arg}`);
		}
	}
	if (!Number.isInteger(args.sample) || args.sample < 0) {
		throw new Error("--sample must be a non-negative integer");
	}
	return args;
}

/**
 * The desired key set = bounded set + extras. Extras come from `--include`
 * args AND from keys a previous run published that are outside the bounded
 * set — carrying them forward keeps their URLs live across regular publishes
 * instead of the manifest silently dropping them on the next run. Only
 * canonical, still-generatable keys carry (a key that can no longer render
 * is dropped rather than published stale).
 */
function resolveKeys(
	includes: string[],
	cache: CalendarPdfCacheIndex | null,
): string[] {
	const keys = listCalendarArtifactKeys();
	const seen = new Set(keys);
	for (const key of carriedExtraKeys(keys, cache)) {
		const parsed = parseCalendarArtifactKey(key);
		if (parsed !== null && isGeneratableArtifactKey(parsed)) {
			seen.add(key);
			keys.push(key);
		}
	}
	for (const key of includes) {
		const parsed = parseCalendarArtifactKey(key);
		if (!parsed || !isGeneratableArtifactKey(parsed)) {
			throw new Error(
				`--include key "${key}" is not a valid month:YYYYMM|year:YYYY|cycle:N`,
			);
		}
		if (!seen.has(key)) {
			seen.add(key);
			keys.push(key);
		}
	}
	return keys;
}

function loadCacheIndex(dir: string): CalendarPdfCacheIndex | null {
	const path = join(dir, "cache-state.json");
	if (!existsSync(path)) {
		return null;
	}
	const parsed = parseCalendarPdfCacheIndex(readFileSync(path, "utf8"));
	if (!parsed.ok) {
		console.warn(
			`Ignoring corrupt cache index (${parsed.reason}); regenerating fresh`,
		);
		return null;
	}
	return parsed.index;
}

function desiredInputShas(
	keys: string[],
	renderFingerprint: string,
): Map<string, string> {
	const desired = new Map<string, string>();
	const cellsCache: MonthCellsCache = new Map();
	for (const key of keys) {
		const input = buildCalendarPdfInput(key, cellsCache);
		if (input === null) {
			throw new Error(`Key ${key} cannot be rendered`);
		}
		desired.set(key, calendarArtifactInputSha(renderFingerprint, key, input));
	}
	return desired;
}

async function renderKey(
	key: string,
	dir: string | null,
	inputSha: string,
	cellsCache?: MonthCellsCache,
): Promise<CalendarPdfCacheArtifact> {
	const input = buildCalendarPdfInput(key, cellsCache);
	if (input === null) {
		throw new Error(`Key ${key} cannot be rendered`);
	}
	const bytes = await generateCalendarPdf(input);
	const sha256 = sha256Bytes(bytes);
	const objectName = `${sha256}.pdf`;
	// Verification renders stay in memory, including when interrupted.
	if (dir !== null) {
		const objectsDir = join(dir, "objects");
		mkdirSync(objectsDir, { recursive: true });
		const objectPath = join(objectsDir, objectName);
		// Content-addressed: identical bytes already on disk need no rewrite.
		if (!existsSync(objectPath)) {
			writeFileSync(objectPath, bytes);
		}
	}
	const parsed = parseCalendarArtifactKey(key);
	if (parsed === null) {
		throw new Error(`Key ${key} is not canonical`);
	}
	return {
		inputSha,
		object: `generated/calendar-pdf/objects/${objectName}`,
		sha256,
		bytes: bytes.byteLength,
		filename: calendarArtifactFilename(parsed, key),
	};
}

async function main(): Promise<void> {
	const args = parseArgs(process.argv.slice(2));
	const started = Date.now();

	// The package command prepares the catalog before imports load schedule data.
	// Verification uses the installed catalog and never writes to disk.
	const fingerprint = computeCalendarPdfFingerprint();
	const renderFingerprint = computeCalendarPdfRenderFingerprint();
	const bounds = getCalendarArtifactBounds();

	// The cache loads before resolving keys: previously published out-of-band
	// keys carry forward so regular publishes never drop them.
	const cache = loadCacheIndex(args.dir);
	const keys = resolveKeys(args.includes, cache);
	const objectPresent = (sha256: string) =>
		existsSync(join(args.dir, "objects", `${sha256}.pdf`));

	if (args.check) {
		// Verify mode: no writes to the cache. When the global fingerprint is
		// unchanged, every cached artifact is fresh by construction — input shas
		// cannot change without an input file changing — so the check is
		// O(keys), not O(rendered months). On a fingerprint change, input shas
		// are computed for a strided sample only; the publish workflow owns the
		// full (re)generation.
		const cellsCache: MonthCellsCache = new Map();
		const fpMatch = cache?.fingerprint === fingerprint;
		const planStarted = Date.now();
		let fresh: string[];
		let stale: string[];
		if (fpMatch && cache) {
			fresh = keys.filter(
				(key) =>
					cache.artifacts[key] !== undefined &&
					objectPresent(cache.artifacts[key].sha256),
			);
			stale = keys.filter(
				(key) =>
					cache.artifacts[key] === undefined ||
					!objectPresent(cache.artifacts[key].sha256),
			);
		} else {
			// Inputs changed — measure drift on a deterministic strided sample
			// (bounded work; the artifacts workflow does the full plan).
			const stride = Math.max(1, Math.floor(keys.length / 25));
			const sample = keys.filter((_, i) => i % stride === 0).slice(0, 25);
			const desired = desiredInputShas(sample, renderFingerprint);
			const plan = planCalendarPdfGeneration(desired, cache, objectPresent);
			fresh = plan.fresh;
			stale = plan.regenerate;
		}
		const planMs = Date.now() - planStarted;

		let verified = 0;
		let smoke = 0;
		const mismatches: string[] = [];
		const freshSet = new Set(fresh);
		// Strided render sample: a cycle, years and months — not just the
		// heaviest keys at the front of the list.
		const renderStride = Math.max(1, Math.floor(keys.length / args.sample));
		const renderSample = keys
			.filter((_, i) => i % renderStride === 0)
			.slice(0, args.sample);
		for (const key of renderSample) {
			const expected = cache?.artifacts[key];
			const rendered = await renderKey(
				key,
				null,
				"", // input sha is unused for verification renders
				cellsCache,
			);
			// Byte-compare only entries proven fresh: a stale entry may render
			// different bytes legitimately when its inputs changed.
			if (freshSet.has(key) && expected !== undefined) {
				if (rendered.sha256 === expected.sha256) {
					verified += 1;
				} else {
					mismatches.push(key);
				}
			} else {
				smoke += 1;
			}
		}
		const report = {
			mode: "check",
			fingerprint,
			cacheFingerprintMatch: fpMatch,
			total: keys.length,
			fresh: fresh.length,
			regeneratePending: stale.length,
			sampled: !fpMatch,
			sampleVerified: verified,
			sampleSmokeOnly: smoke,
			sampleMismatched: mismatches,
			planMs,
			elapsedMs: Date.now() - started,
		};
		console.log(JSON.stringify(report));
		if (mismatches.length > 0) {
			console.error(
				`Non-deterministic render detected for: ${mismatches.join(", ")}`,
			);
			process.exitCode = 1;
		}
		return;
	}

	const planStarted = Date.now();
	const desired = desiredInputShas(keys, renderFingerprint);
	const plan = planCalendarPdfGeneration(desired, cache, objectPresent);
	const planMs = Date.now() - planStarted;

	mkdirSync(join(args.dir, "objects"), { recursive: true });
	const renderStarted = Date.now();
	const artifacts: Record<string, CalendarPdfCacheArtifact> = {
		...plan.reused,
	};
	for (const key of plan.regenerate) {
		artifacts[key] = await renderKey(key, args.dir, desired.get(key) ?? "");
	}
	const renderMs = Date.now() - renderStarted;

	// Evict unreferenced object files so the persisted cache stays bounded.
	const liveObjects = new Set(
		Object.values(artifacts).map((a) => `${a.sha256}.pdf`),
	);
	for (const file of readdirSync(join(args.dir, "objects"))) {
		if (/^[a-f0-9]{64}\.pdf$/.test(file) && !liveObjects.has(file)) {
			rmSync(join(args.dir, "objects", file));
		}
	}

	const cacheIndex: CalendarPdfCacheIndex = {
		version: 1,
		fingerprint,
		artifacts,
	};
	const manifest = buildCalendarPdfManifest({
		fingerprint,
		bounds,
		artifacts,
		generatedAt: new Date().toISOString(),
	});
	writeFileSync(
		join(args.dir, "cache-state.json"),
		`${JSON.stringify(cacheIndex)}\n`,
	);
	writeFileSync(
		join(args.dir, "manifest.json"),
		`${JSON.stringify(manifest)}\n`,
	);

	console.log(
		JSON.stringify({
			mode: "generate",
			fingerprint,
			total: keys.length,
			fresh: plan.fresh.length,
			regenerated: plan.regenerate.length,
			planMs,
			renderMs,
			elapsedMs: Date.now() - started,
		}),
	);
}

main().catch((error) => {
	console.error(error instanceof Error ? error.message : error);
	process.exitCode = 1;
});
