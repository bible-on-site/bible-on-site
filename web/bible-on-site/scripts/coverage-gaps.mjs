/**
 * Prints per-file uncovered line/branch numbers from an lcov report.
 *
 * Usage: npm run coverage:gaps [-- <path-substring> ...]
 * Reads .coverage/unit/lcov.info (run `npm run coverage:unit` first).
 * With no arguments, lists every file that has uncovered lines.
 */
import fs from "node:fs";

const LCOV_PATH = ".coverage/unit/lcov.info";

if (!fs.existsSync(LCOV_PATH)) {
	console.error(`${LCOV_PATH} not found — run \`npm run coverage:unit\` first.`);
	process.exit(1);
}

const filters = process.argv.slice(2);
const txt = fs.readFileSync(LCOV_PATH, "utf8");
let shown = 0;

for (const block of txt.split("end_of_record")) {
	const sf = /SF:(.*)/.exec(block);
	if (!sf) continue;
	const file = sf[1].replace(/\\/g, "/");
	const rel = file.split("web/bible-on-site/")[1] ?? file;
	if (filters.length > 0 && !filters.some((f) => rel.includes(f))) continue;

	const linesFound = +(/LF:(\d+)/.exec(block)?.[1] ?? 0);
	const linesHit = +(/LH:(\d+)/.exec(block)?.[1] ?? 0);
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
}
