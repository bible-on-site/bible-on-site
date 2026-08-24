/**
 * Prints per-file uncovered line/branch numbers from an lcov report.
 *
 * Usage: npm run coverage:gaps --prefix devops -- [--lcov <path>] [--root <strip>] [-- <path-substring> ...]
 *
 * Defaults read data/.coverage/unit/lcov.info relative to the repo root and
 * strip the `data/` prefix, so the same script serves any module:
 *   devops:  npm run coverage:gaps -- --lcov ../web/admin/.coverage/unit/lcov.info --root web/admin
 *   data:    cd data && npm run coverage:gaps --prefix ../devops
 *
 * With no path filters, lists every file that has uncovered lines.
 */
import fs from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..");

function argValue(flag) {
	const at = process.argv.indexOf(flag);
	return at !== -1 ? process.argv[at + 1] : undefined;
}

/* npm run passes user args after a bare `--`; without npm, argv holds them directly. */
const separatorAt = process.argv.indexOf("--");
const argv =
	separatorAt !== -1
		? process.argv.slice(separatorAt + 1)
		: process.argv.slice(2);

const lcovFlagAt = argv.indexOf("--lcov");
const rootFlagAt = argv.indexOf("--root");
const lcovPath = resolve(
	REPO_ROOT,
	lcovFlagAt !== -1 ? argv[lcovFlagAt + 1] : "data/.coverage/unit/lcov.info",
);
const rootPrefix = rootFlagAt !== -1 ? argv[rootFlagAt + 1] : "data";
const flagEnd = Math.max(lcovFlagAt, rootFlagAt);
const filters = argv.slice(flagEnd === -1 ? 0 : flagEnd + 2);

if (!fs.existsSync(lcovPath)) {
	console.error(
		`${lcovPath} not found — run the module's coverage task first (data: \`cargo make coverage-unit\`).`,
	);
	process.exit(1);
}

const txt = fs.readFileSync(lcovPath, "utf8");
let shown = 0;
let totalFound = 0;
let totalHit = 0;

for (const block of txt.split("end_of_record")) {
	const sf = /SF:(.*)/.exec(block);
	if (!sf) continue;
	const file = sf[1].replace(/\\/g, "/");
	const rel = file.split(`${rootPrefix}/`)[1] ?? file;
	if (filters.length > 0 && !filters.some((f) => rel.includes(f))) continue;

	const linesFound = +(/LF:(\d+)/.exec(block)?.[1] ?? 0);
	const linesHit = +(/LH:(\d+)/.exec(block)?.[1] ?? 0);
	totalFound += linesFound;
	totalHit += linesHit;
	const missedLines = [
		...new Set([...block.matchAll(/DA:(\d+),0/g)].map((m) => +m[1])),
	].sort((a, b) => a - b);
	const missedBranchLines = [
		...new Set([...block.matchAll(/BRDA:(\d+),\d+,\d+,0/g)].map((m) => +m[1])),
	].sort((a, b) => a - b);

	if (missedLines.length === 0 && missedBranchLines.length === 0) continue;
	shown++;
	console.log(`${rel}  lines ${linesHit}/${linesFound}`);
	if (missedLines.length > 0) {
		console.log(`  missed lines:    ${missedLines.join(", ")}`);
	}
	if (missedBranchLines.length > 0) {
		console.log(`  missed branches: ${missedBranchLines.join(", ")}`);
	}
}

if (shown === 0) {
	console.log(
		filters.length > 0
			? `No uncovered lines in files matching: ${filters.join(", ")}`
			: "No uncovered lines.",
	);
} else {
	const pct = totalFound > 0 ? ((totalHit / totalFound) * 100).toFixed(1) : "0";
	console.log(
		`\n${shown} file(s) with gaps; overall lines ${totalHit}/${totalFound} (${pct}%).`,
	);
}
