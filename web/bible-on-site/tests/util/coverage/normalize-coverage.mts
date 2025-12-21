import { existsSync, readFileSync, writeFileSync } from "node:fs";

interface LcovSection {
	filePath: string;
	lines: string[];
	functions: Array<{ line: number; name: string }>;
}

/**
 * Normalizes function names in an LCOV file to use line-based naming.
 * This is needed because Jest and Playwright generate different anonymous function
 * numbering schemes (e.g., anonymous_5 vs anonymous_0 for the same function).
 * We rename all anonymous functions to use a line-based scheme: (anonymous_L{line})
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
		renamedCount += normalizeSection(section);
	}

	const normalizedContent = Array.from(sections.values())
		.map((section) => section.lines.join("\n"))
		.join("\n");
	writeFileSync(outputPath, normalizedContent, "utf8");

	return renamedCount;
}

function normalizeSection(section: LcovSection): number {
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
