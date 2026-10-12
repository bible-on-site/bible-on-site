/**
 * Deterministic E2E impact evidence for the Playwright suites (#2085).
 *
 * One shared module serves every Playwright E2E suite (website, admin, API):
 *
 * - `E2eImpactReporter` — a Playwright reporter registered by each suite
 *   config when `MEASURE_COV=1`. `onBegin` writes `discovered.json` (the exact
 *   runtime test list the devops selector consumes through `--list` too);
 *   `onTestEnd`/`onEnd` write `test-results.json` with per-test outcomes.
 * - `dumpImpactCoverage` — called by the website/admin browser fixtures with
 *   the istanbul map drained for the current test; writes one JSON event per
 *   call under `coverage/` tagged with the realm that produced it.
 *
 * The API suite needs no fixture integration: Rust has no per-test coverage
 * channel, so its devops collector attributes endpoints to sources
 * statically and consumes only this reporter's discovered/results JSON.
 *
 * Nothing writes unless `E2E_IMPACT_DIR` is set (the suite config sets it to
 * `<package>/.coverage/e2e-impact` when measuring coverage), so ordinary
 * `test:e2e` runs stay untouched.
 *
 * Test identity is `<testDir-relative file> :: <describe/test titles>` — the
 * same string comes out of discovery, the reporter and the fixture dumps,
 * so evidence joins deterministically. The project (`titlePath[1]`) is NOT
 * part of the identity: a selection cannot split a test across projects —
 * `--grep` runs it on every project — so per-test coverage unions across
 * Desktop/Mobile runs of the same test.
 */
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const EVIDENCE_DIR_ENV = "E2E_IMPACT_DIR";

export function impactEvidenceDir() {
	const dir = process.env[EVIDENCE_DIR_ENV];
	return dir === undefined || dir === "" ? null : dir;
}

const normalizeSlashes = (value) => value.replace(/\\/g, "/");

/**
 * The canonical parts of a test identity: titlePath element 1 is the project
 * name, element 2 the testDir-relative file, elements 3+ the describe/test
 * titles.
 * @param {string[]} titlePath
 */
export function impactIdParts(titlePath) {
	return {
		project: titlePath[1] ?? "",
		file: normalizeSlashes(titlePath[2] ?? ""),
		titlePath: titlePath.slice(3),
	};
}

/**
 * `<file> :: <describe> :: <title>` — stable test identity. The file and
 * titles are titlePath elements 2+, so element 1 (the project) is skipped.
 */
export function impactTestId(titlePath) {
	return titlePath
		.slice(2)
		.filter((part) => part !== "")
		.map(normalizeSlashes)
		.join(" :: ");
}

const shortHash = (id) =>
	createHash("sha256").update(id).digest("hex").slice(0, 16);

const writeJson = (dir, segments, value) => {
	const file = path.join(dir, ...segments);
	mkdirSync(path.dirname(file), { recursive: true });
	writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
	return file;
};

/** Per-process sequence so several dumps of one test stay distinct. */
const coverageSeq = new Map();

/**
 * Persists one istanbul coverage map attributed to the current test.
 * `realm` is `"browser"` for `window.__coverage__` (per-context, exact) or
 * `"server"` for the dev-server `/api/dev/coverage` drain (shared process —
 * may include a parallel worker's hits, so the collector widens with it).
 * @param {import("@playwright/test").TestInfo} testInfo
 */
export function dumpImpactCoverage(testInfo, realm, coverage) {
	const dir = impactEvidenceDir();
	if (dir === null || !coverage || Object.keys(coverage).length === 0) return;
	const { file, titlePath, project } = impactIdParts(testInfo.titlePath);
	const id = impactTestId(testInfo.titlePath);
	const seq = coverageSeq.get(id) ?? 0;
	coverageSeq.set(id, seq + 1);
	// The filename stays unique across every writer that can produce a dump
	// for this identity: `project` separates Desktop/Mobile workers running
	// the test concurrently, `workerIndex` separates worker processes (each
	// has its own `coverageSeq`), and `retry` separates attempts — a retried
	// test on a fresh worker must never overwrite an earlier attempt's
	// evidence. None of these enter the identity: coverage unions across
	// projects and retries.
	writeJson(
		dir,
		[
			"coverage",
			`${shortHash(id)}-${project}-w${testInfo.workerIndex}-r${testInfo.retry}-${seq}.json`,
		],
		{ id, project, file, titlePath, realm, coverage },
	);
}

const outcomeOf = (test, result) => {
	try {
		return test.outcome();
	} catch {
		return result.status;
	}
};

/**
 * Playwright reporter that persists discovery and outcome evidence.
 * In `--list` mode `onBegin` still runs, so the devops discovery command
 * reuses the exact same identity computation as a live run.
 */
export default class E2eImpactReporter {
	constructor() {
		this.results = [];
		this.dir = impactEvidenceDir();
	}

	onBegin(config, suite) {
		if (this.dir === null) return;
		const tests = suite
			.allTests()
			.map((test) => {
				const titlePath = test.titlePath();
				const { file, titlePath: titles, project } =
					impactIdParts(titlePath);
				return {
					id: impactTestId(titlePath),
					project,
					file,
					titlePath: titles,
				};
			})
			.sort((a, b) => a.id.localeCompare(b.id));
		writeJson(this.dir, ["discovered.json"], {
			schema: "e2e-impact-discovery/1",
			rootDir: normalizeSlashes(config.rootDir),
			tests,
		});
	}

	onTestEnd(test, result) {
		const titlePath = test.titlePath();
		const { file, project } = impactIdParts(titlePath);
		this.results.push({
			id: impactTestId(titlePath),
			project,
			file,
			retry: result.retry,
			status: result.status,
			outcome: outcomeOf(test, result),
		});
	}

	onEnd() {
		if (this.dir === null || this.results.length === 0) return;
		this.results.sort((a, b) => a.id.localeCompare(b.id) || a.retry - b.retry);
		writeJson(this.dir, ["test-results.json"], {
			schema: "e2e-impact-results/1",
			tests: this.results,
		});
	}
}
