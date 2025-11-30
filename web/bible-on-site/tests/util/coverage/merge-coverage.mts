import { execSync } from "node:child_process";
import {
	copyFileSync,
	existsSync,
	mkdirSync,
	readFileSync,
	writeFileSync,
} from "node:fs";

const COVERAGE_DIR = `${process.env.npm_config_local_prefix}/.coverage`;

const DEBUG_TARGET_FILE = "SeferComposite.tsx";
const DEBUG_DIR = `${COVERAGE_DIR}/debug`;
const DEBUG_TARGETS = [
	{ label: "unit", path: `${COVERAGE_DIR}/unit/lcov.info` },
	{ label: "e2e", path: `${COVERAGE_DIR}/e2e/lcov.info` },
];

mkdirSync(`${COVERAGE_DIR}/merged`, { recursive: true });
sanitizeLcovFiles();
dumpTargetCoverage();
mergeCoverage();

function mergeCoverage(): void {
	const cmd = `docker run --rm -t -v ${COVERAGE_DIR}:/.coverage lcov-cli:0.0.2 --rc branch_coverage=1 -a /.coverage/unit/lcov.info -a /.coverage/e2e/lcov.info -o /.coverage/merged/lcov.info`;

	const out = runCommand(cmd);
	if (out) console.log(formatOutput(out));
}

function dumpTargetCoverage(): void {
	mkdirSync(DEBUG_DIR, { recursive: true });

	for (const target of DEBUG_TARGETS) {
		const snippet = extractCoverageSection(target.path, DEBUG_TARGET_FILE);
		const outputPath = `${DEBUG_DIR}/${DEBUG_TARGET_FILE.replace(/\W+/g, "_")}.${target.label}.txt`;
		const content =
			snippet ??
			`Coverage snippet for ${target.label} missing ${DEBUG_TARGET_FILE}\n`;
		copyCoverageFile(target.path, `${DEBUG_DIR}/${target.label}.lcov.info`);
		writeFileSync(outputPath, content, "utf8");
		console.log(`Debug snippet for ${target.label} written to ${outputPath}`);
	}
}

function extractCoverageSection(
	filePath: string,
	targetFile: string,
): string | undefined {
	if (!existsSync(filePath)) {
		return undefined;
	}

	const lines = readFileSync(filePath, "utf8").split(/\r?\n/);
	const sections = [];
	let capturing = false;
	let buffer = [];

	for (const line of lines) {
		if (line.startsWith("SF:")) {
			if (capturing && buffer.length) {
				sections.push(buffer.join("\n"));
				buffer = [];
			}

			capturing = line.includes(targetFile);
			if (capturing) {
				buffer.push(line);
			}
			continue;
		}

		if (capturing) {
			buffer.push(line);
			if (line === "end_of_record") {
				sections.push(buffer.join("\n"));
				buffer = [];
				capturing = false;
			}
		}
	}

	if (capturing && buffer.length) {
		sections.push(buffer.join("\n"));
	}

	return sections.length ? sections.join("\n\n") : undefined;
}

function copyCoverageFile(source: string, destination: string): void {
	if (!existsSync(source)) {
		console.log(`Coverage file not found: ${source}`);
		return;
	}

	copyFileSync(source, destination);
	console.log(`Copied coverage file to ${destination}`);
}

function sanitizeLcovFiles(): void {
	for (const target of DEBUG_TARGETS) {
		sanitizeLcovFile(target.path);
	}
}

function sanitizeLcovFile(filePath: string): void {
	if (!existsSync(filePath)) {
		return;
	}

	const original = readFileSync(filePath, "utf8");
	const sanitized = sanitizeLcovContent(original);
	if (sanitized !== original) {
		writeFileSync(filePath, sanitized, "utf8");
		console.log(`Sanitized LCOV file ${filePath}`);
	}
}

function sanitizeLcovContent(content: string): string {
	const lines = content.split(/\r?\n/);
	const records: string[][] = [];
	let current: string[] = [];
	for (const line of lines) {
		if (line === "end_of_record") {
			current.push("end_of_record");
			records.push(current);
			current = [];
			continue;
		}
		current.push(line);
	}
	if (current.length) {
		records.push(current);
	}

	let changed = false;
	const sanitizedRecords = records.map((record) => {
		if (!record.length) return record;
		const updated = sanitizeLcovRecord(record);
		if (updated !== record) changed = true;
		return updated;
	});

	if (!changed) return content;
	return sanitizedRecords.map((record) => record.join("\n")).join("\n");
}

function sanitizeLcovRecord(record: string[]): string[] {
	const lastLine = record[record.length - 1];
	if (lastLine !== "end_of_record") {
		return record;
	}

	const body = record.slice(0, -1);
	const otherLines: string[] = [];
	const branchDetailLines: string[] = [];
	const branchSummaryLines: string[] = [];
	const daHits = new Map<number, number>();
	const daOrder: number[] = [];
	let hasBranches = false;

	for (const line of body) {
		if (line.startsWith("DA:")) {
			const parsed = parseDaLine(line);
			if (parsed) {
				const { lineNumber, hits } = parsed;
				daHits.set(lineNumber, hits);
				daOrder.push(lineNumber);
			}
			continue;
		}
		if (line.startsWith("BRDA:")) {
			hasBranches = true;
			branchDetailLines.push(line);
			continue;
		}
		if (line.startsWith("BRF:") || line.startsWith("BRH:")) {
			branchSummaryLines.push(line);
			continue;
		}
		if (line.startsWith("LF:") || line.startsWith("LH:")) {
			continue;
		}
		otherLines.push(line);
	}

	if (!hasBranches) {
		return record;
	}

	let changed = false;
	for (const line of branchDetailLines) {
		const parsed = parseBrdaLine(line);
		if (!parsed) continue;
		const { lineNumber, hits } = parsed;
		const current = daHits.get(lineNumber);
		if (typeof current === "undefined") {
			daHits.set(lineNumber, hits);
			changed = true;
		} else if (hits > current) {
			daHits.set(lineNumber, hits);
			changed = true;
		}
	}

	if (!changed) {
		return record;
	}

	const orderedLines: number[] = [];
	const seen = new Set<number>();
	for (const lineNumber of daOrder) {
		if (!seen.has(lineNumber) && daHits.has(lineNumber)) {
			orderedLines.push(lineNumber);
			seen.add(lineNumber);
		}
	}
	const additionalLines = Array.from(daHits.keys())
		.filter((lineNumber) => !seen.has(lineNumber))
		.sort((a, b) => a - b);
	orderedLines.push(...additionalLines);

	const rebuiltDaLines = orderedLines.map((lineNumber) => {
		const hits = daHits.get(lineNumber) ?? 0;
		return `DA:${lineNumber},${hits}`;
	});
	const lf = daHits.size;
	const lh = Array.from(daHits.values()).filter((hits) => hits > 0).length;

	const rebuiltRecord = [
		...otherLines,
		...rebuiltDaLines,
		`LF:${lf}`,
		`LH:${lh}`,
		...branchDetailLines,
		...branchSummaryLines,
		"end_of_record",
	];
	return rebuiltRecord;
}

function parseDaLine(line: string): { lineNumber: number; hits: number } | undefined {
	const [, payload] = line.split("DA:");
	if (!payload) return undefined;
	const [lineStr, hitStr] = payload.split(",");
	const lineNumber = Number(lineStr);
	const hits = Number(hitStr);
	if (!Number.isFinite(lineNumber) || lineNumber <= 0) return undefined;
	return { lineNumber, hits: Number.isFinite(hits) ? hits : 0 };
}

function parseBrdaLine(line: string): { lineNumber: number; hits: number } | undefined {
	const parts = line.split(",");
	if (parts.length < 4) return undefined;
	const lineNumber = Number(parts[0].replace("BRDA:", ""));
	const takenRaw = parts[3];
	const taken = takenRaw === "-" ? 0 : Number(takenRaw);
	if (!Number.isFinite(lineNumber) || lineNumber <= 0) return undefined;
	return { lineNumber, hits: Number.isFinite(taken) ? taken : 0 };
}

function runCommand(cmd: string): Buffer | undefined {
	try {
		return execSync(cmd);
	} catch (e: unknown) {
		printExecError(cmd, e);
		process.exit(1);
	}
}

function formatOutput(value: unknown): string {
	if (typeof value === "undefined" || value === null) return "";
	if (Buffer.isBuffer(value)) return value.toString();
	return String(value);
}

function printExecError(cmd: string, error: unknown): void {
	console.error("\nError merging coverage");
	console.error("Command :", cmd);

	if (typeof error === "object" && error !== null) {
		const err = error as {
			status?: number;
			stdout?: unknown;
			stderr?: unknown;
			message?: unknown;
			stack?: unknown;
		};

		if (typeof err.status !== "undefined")
			console.error("Exit code :", err.status);

		if (typeof err.stdout !== "undefined")
			console.error("Stdout   :", formatOutput(err.stdout));

		if (typeof err.stderr !== "undefined")
			console.error("Stderr   :", formatOutput(err.stderr));

		if (err.message && !err.stderr)
			console.error("Message  :", String(err.message));

		if (err.stack) console.error("Stack    :", String(err.stack));
	} else {
		console.error("Error    :", String(error));
	}
}
