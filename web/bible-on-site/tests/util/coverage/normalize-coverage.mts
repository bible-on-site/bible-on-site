import { existsSync, readFileSync, writeFileSync } from "node:fs";

interface LcovSection {
	filePath: string;
	lines: string[];
	functions: Array<{ line: number; name: string }>;
}

interface BranchEntry {
	line: number;
	block: number;
	branch: number;
	count: number;
	/** Index of this BRDA line in section.lines */
	lineIndex: number;
}

/**
 * Normalizes an LCOV file:
 * 1. Renames anonymous functions to use line-based naming (anonymous_L{line})
 *    so Jest and Playwright coverage can be merged despite different numbering.
 * 2. Fixes incomplete branch data from swc-plugin-coverage-instrument, which
 *    sometimes emits only one branch for a two-way conditional (ternary).
 *    When a line has DA > 0 but all BRDA entries have count 0, the missing
 *    complementary branch is added so lcov doesn't reject the data as
 *    inconsistent.
 *
 * @param inputPath - Path to the input LCOV file
 * @param outputPath - Path to write the normalized LCOV file
 * @returns The number of function names that were renamed
 */
export function normalizeLcovFile(
	inputPath: string,
	outputPath: string,
): number {
	if (!existsSync(inputPath)) {
		console.log(`Skipping normalization: ${inputPath} not found`);
		return 0;
	}

	const content = readFileSync(inputPath, "utf8");
	const sections = parseLcovSections(content);

	let renamedCount = 0;

	for (const section of sections.values()) {
		renamedCount += normalizeFunctionNames(section);
		fixInconsistentBranches(section);
	}

	const normalizedContent = Array.from(sections.values())
		.map((section) => section.lines.join("\n"))
		.join("\n");
	writeFileSync(outputPath, normalizedContent, "utf8");

	return renamedCount;
}

function normalizeFunctionNames(section: LcovSection): number {
	// Build rename map: old name -> new line-based name
	const renameMap = new Map<string, string>();
	for (const fn of section.functions) {
		// Only rename anonymous functions
		if (fn.name.startsWith("(anonymous_")) {
			const newName = `(anonymous_L${fn.line})`;
			if (fn.name !== newName) {
				renameMap.set(fn.name, newName);
			}
		}
	}

	if (renameMap.size === 0) {
		return 0;
	}

	let renamedCount = 0;

	// Apply renames to the section's raw lines
	section.lines = section.lines.map((line) => {
		// FN:lineNum,funcName or FNDA:count,funcName
		const fnMatch = line.match(/^(FN:\d+,|FNDA:\d+,)(.+)$/);
		if (fnMatch) {
			const [, prefix, funcName] = fnMatch;
			const newName = renameMap.get(funcName);
			if (newName) {
				renamedCount++;
				return `${prefix}${newName}`;
			}
		}
		return line;
	});

	return renamedCount;
}

/**
 * Fix inconsistent branch data produced by swc-plugin-coverage-instrument.
 *
 * SWC sometimes emits only one BRDA entry (branch 0) for a two-way branch
 * (ternary/conditional). When the code always takes the *other* path, the
 * single tracked branch has count 0 while DA shows the line was hit.
 * lcov rejects this as inconsistent ("line is hit but no branches evaluated").
 *
 * Fix: for each line where DA > 0 and ALL BRDA entries have count 0, find
 * single-branch blocks and add the missing complementary branch whose count
 * equals the DA count (since if branch 0 was taken 0 times out of N
 * executions, branch 1 was taken N times).
 */
function fixInconsistentBranches(section: LcovSection): void {
	// Collect DA counts per line
	const daCounts = new Map<number, number>();
	for (const line of section.lines) {
		const m = line.match(/^DA:(\d+),(\d+)/);
		if (m) daCounts.set(Number(m[1]), Number(m[2]));
	}

	// Collect BRDA entries with their position in section.lines
	const branchEntries: BranchEntry[] = [];
	for (let i = 0; i < section.lines.length; i++) {
		const m = section.lines[i].match(/^BRDA:(\d+),(\d+),(\d+),(\d+)/);
		if (m) {
			branchEntries.push({
				line: Number(m[1]),
				block: Number(m[2]),
				branch: Number(m[3]),
				count: Number(m[4]),
				lineIndex: i,
			});
		}
	}

	// Group by source line
	const byLine = new Map<number, BranchEntry[]>();
	for (const entry of branchEntries) {
		if (!byLine.has(entry.line)) byLine.set(entry.line, []);
		byLine.get(entry.line)?.push(entry);
	}

	// Find and fix inconsistent lines
	const insertions: Array<{ afterIndex: number; content: string }> = [];

	for (const [line, entries] of byLine) {
		const da = daCounts.get(line) ?? 0;
		if (da === 0) continue; // line not hit, no inconsistency possible

		const allZero = entries.every((e) => e.count === 0);
		if (!allZero) continue; // at least one branch taken, consistent

		// Group entries by block
		const byBlock = new Map<number, BranchEntry[]>();
		for (const e of entries) {
			if (!byBlock.has(e.block)) byBlock.set(e.block, []);
			byBlock.get(e.block)?.push(e);
		}

		for (const [block, blockEntries] of byBlock) {
			// Only fix blocks with a single branch (missing complementary branch)
			if (blockEntries.length !== 1) continue;
			const existing = blockEntries[0];
			// Add the missing branch: if branch 0 was taken 0 times out of
			// DA executions, branch 1 was taken DA times.
			const missingBranch = existing.branch === 0 ? 1 : 0;
			const missingCount = da - existing.count;
			insertions.push({
				afterIndex: existing.lineIndex,
				content: `BRDA:${line},${block},${missingBranch},${missingCount}`,
			});
			console.log(
				`normalize-coverage: fixed incomplete branch block at ${section.filePath}:${line} ` +
					`(block ${block}): added branch ${missingBranch} with count ${missingCount})`,
			);
		}
	}

	// Also update BRF (branches found) count for any insertions
	if (insertions.length > 0) {
		// Insert in reverse order to preserve indices
		insertions.sort((a, b) => b.afterIndex - a.afterIndex);
		for (const ins of insertions) {
			section.lines.splice(ins.afterIndex + 1, 0, ins.content);
		}

		// Update BRF count
		for (let i = 0; i < section.lines.length; i++) {
			const m = section.lines[i].match(/^BRF:(\d+)/);
			if (m) {
				const newCount = Number(m[1]) + insertions.length;
				section.lines[i] = `BRF:${newCount}`;
			}
		}
	}
}

function parseLcovSections(content: string): Map<string, LcovSection> {
	const sections = new Map<string, LcovSection>();
	const lines = content.split(/\r?\n/);

	let currentSection: LcovSection | null = null;

	for (const line of lines) {
		if (line.startsWith("SF:")) {
			const filePath = line.slice(3);
			currentSection = { filePath, lines: [line], functions: [] };
			sections.set(filePath, currentSection);
			continue;
		}

		if (!currentSection) continue;

		currentSection.lines.push(line);

		// Parse function declarations: FN:lineNum,funcName
		const fnMatch = line.match(/^FN:(\d+),(.+)$/);
		if (fnMatch) {
			currentSection.functions.push({
				line: Number.parseInt(fnMatch[1], 10),
				name: fnMatch[2],
			});
		}

		if (line === "end_of_record") {
			currentSection = null;
		}
	}

	return sections;
}
