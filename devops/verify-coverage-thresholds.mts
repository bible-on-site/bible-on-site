import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Enforces the per-flag coverage targets from codecov.yml against the local
 * lcov reports, independent of whether the Codecov upload succeeded.
 *
 * Codecov remains the reporting/dashboard surface, but merge gating must not
 * depend on a third-party upload landing: a failed upload otherwise bypasses
 * the flag thresholds entirely (see docs/devops/codecov-reliability.md).
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const codecovYml = fs.readFileSync(path.resolve(repoRoot, "codecov.yml"), "utf8");

// Flag name -> lcov report produced by that module's CI job.
const FLAG_REPORTS: Record<string, string> = {
	website: "web/bible-on-site/.coverage/merged/lcov.info",
	api: "web/api/.coverage/merged/lcov.info",
	app: "app/.coverage/merged/lcov.info",
	bulletin: "web/bulletin/.coverage/unit/lcov.info",
	admin: "web/admin/.coverage/merged/lcov.info",
	data: "data/.coverage/merged/lcov.info",
};

interface CoverageCheck {
	name: string;
	target: number | null;
	flags: string[];
}

// Parse coverage.status.project.<check> entries (6-space check keys, 8-space
// fields, 10-space flag list items) from codecov.yml.
const checks: CoverageCheck[] = [];
{
	let inProject = false;
	let current: CoverageCheck | null = null;
	for (const line of codecovYml.split(/\r?\n/)) {
		if (/^    project:/.test(line)) {
			inProject = true;
			continue;
		}
		if (!inProject) continue;
		if (/^    \S/.test(line)) break; // left project: block (e.g. patch:)
		const checkMatch = line.match(/^      (\w[\w-]*):/);
		if (checkMatch) {
			current = { name: checkMatch[1], target: null, flags: [] };
			checks.push(current);
			continue;
		}
		const targetMatch = line.match(/^        target:\s*([\d.]+)%/);
		if (targetMatch && current) {
			current.target = Number(targetMatch[1]);
			continue;
		}
		const flagMatch = line.match(/^          -\s*(\w[\w-]*)/);
		if (flagMatch && current) current.flags.push(flagMatch[1]);
	}
}

// Parse flags.<flag>.paths entries (2-space flag keys, 6-space path items).
const flagPaths: Record<string, string[]> = {};
{
	let inFlags = false;
	let flagName: string | null = null;
	for (const line of codecovYml.split(/\r?\n/)) {
		if (/^flags:/.test(line)) {
			inFlags = true;
			continue;
		}
		if (!inFlags) continue;
		if (/^\S/.test(line)) break; // next top-level key
		const flagMatch = line.match(/^  (\w[\w-]*):/);
		if (flagMatch) {
			flagName = flagMatch[1];
			flagPaths[flagName] = [];
			continue;
		}
		const pathMatch = line.match(/^      -\s*(\S+)/);
		if (pathMatch && flagName) flagPaths[flagName].push(pathMatch[1]);
	}
}

interface LcovEntry {
	file: string;
	linesFound: number;
	linesHit: number;
}

function parseLcov(filePath: string): LcovEntry[] {
	const entries: LcovEntry[] = [];
	let current: LcovEntry | null = null;
	for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
		if (line.startsWith("SF:")) {
			current = {
				file: line.slice(3).replace(/\\/g, "/"),
				linesFound: 0,
				linesHit: 0,
			};
		} else if (line.startsWith("LF:") && current) {
			current.linesFound = Number(line.slice(3));
		} else if (line.startsWith("LH:") && current) {
			current.linesHit = Number(line.slice(3));
		} else if (line.startsWith("end_of_record") && current) {
			entries.push(current);
			current = null;
		}
	}
	return entries;
}

function coverageForFlag(flag: string, entries: LcovEntry[]) {
	const prefixes = flagPaths[flag] ?? [];
	// lcov SF paths may be absolute or module-relative; prefer entries matching
	// the flag's path prefixes, and fall back to the whole report when none
	// match (module-scoped reports already only contain that module's files).
	const scoped = prefixes.length
		? entries.filter((e) => prefixes.some((p) => e.file.includes(p)))
		: [];
	const relevant = scoped.length ? scoped : entries;
	const found = relevant.reduce((sum, e) => sum + e.linesFound, 0);
	const hit = relevant.reduce((sum, e) => sum + e.linesHit, 0);
	return { found, hit, pct: found ? (hit / found) * 100 : 0 };
}

let failures = 0;
for (const check of checks) {
	// The unflagged `default` check is informational-only (aggregates dirs
	// outside any flag path at ~0%); only flag-backed checks are enforced.
	if (check.target === null || !check.flags.length) continue;
	for (const flag of check.flags) {
		const report = FLAG_REPORTS[flag];
		if (!report) {
			console.log(`::warning::No lcov report mapping for flag "${flag}" — skipping local threshold`);
			continue;
		}
		const reportPath = path.resolve(repoRoot, report);
		if (!fs.existsSync(reportPath)) {
			console.error(`FAIL ${flag}: coverage report missing at ${report} — cannot enforce the ${check.target}% target`);
			failures++;
			continue;
		}
		const { found, hit, pct } = coverageForFlag(flag, parseLcov(reportPath));
		const status = pct >= check.target ? "PASS" : "FAIL";
		if (status === "FAIL") failures++;
		console.log(
			`${status} ${flag}: ${pct.toFixed(2)}% lines (${hit}/${found}) — target ${check.target}%`,
		);
	}
}

if (failures) {
	console.error(`::error::${failures} coverage flag(s) below their codecov.yml target`);
	process.exit(1);
}
console.log("All flag coverage targets met locally.");
