/**
 * Prints per-file uncovered line/branch numbers from an lcov report.
 *
 * Usage: bun run coverage:gaps [-- <path-substring> ...]
 * Reads .coverage/unit/lcov.info (run `bun run coverage:unit` first).
 * With no arguments, lists every file that has uncovered lines.
 */
import fs from "node:fs";

const LCOV_PATH = ".coverage/unit/lcov.info";

if (!fs.existsSync(LCOV_PATH)) {
	console.error(
		`${LCOV_PATH} not found — run \`bun run coverage:unit\` first.`,
	);
	process.exit(1);
}

const filters = process.argv.slice(2);
const txt = fs.readFileSync(LCOV_PATH, "utf8");
let shown = 0;

for (const block of txt.split(/^end_of_record\r?$/m)) {
	const sf = /^SF:(.*)$/m.exec(block);
	if (!sf) continue;
	const file = sf[1].replace(/\\/g, "/");
	const rel = file.split("web/bible-on-site/")[1] ?? file;
	if (filters.length > 0 && !filters.some((f) => rel.includes(f))) continue;

	const linesFound = +(/^LF:(\d+)\r?$/m.exec(block)?.[1] ?? 0);
	const linesHit = +(/^LH:(\d+)\r?$/m.exec(block)?.[1] ?? 0);
	const missedLines = [
		...new Set(
			[...block.matchAll(/^DA:(\d+),0(?:,[^\r\n]*)?\r?$/gm)].map((m) => +m[1]),
		),
	].sort((a, b) => a - b);
	// LCOV uses '-' when the branch expression was never evaluated.
	const missedBranchLines = [
		...new Set(
			[...block.matchAll(/^BRDA:(\d+),\d+,\d+,(?:0|-)\r?$/gm)].map(
				(m) => +m[1],
			),
		),
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
