import { execSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

const COVERAGE_DIR = `${process.env.npm_config_local_prefix}/.coverage`;

mkdirSync(`${COVERAGE_DIR}/merged`, { recursive: true });
sanitizeCoverage();
mergeCoverage();

function sanitizeCoverage(): void {
	const unitCoveragePath = `${COVERAGE_DIR}/unit/lcov.info`;
	const e2eCoveragePath = `${COVERAGE_DIR}/e2e/lcov.info`;
	for (const coveragePath of [unitCoveragePath, e2eCoveragePath]) {
		const sanitizedCoveragePath = `${coveragePath}.sanitized`;

		try {
			const content = awaitReadFileSafe(coveragePath);
			const filtered = content
				.split(/\r?\n/)
				.filter(
					(line) =>
						!/^FN:0,/.test(line) &&
						!/^DA:0,/.test(line) &&
						!/^BRDA:0,/.test(line),
				)
				.join("\n");
			mkdirSync(dirname(sanitizedCoveragePath), {
				recursive: true,
			});
			writeFileSync(sanitizedCoveragePath, filtered);
			console.log(`Wrote sanitized coverage: ${sanitizedCoveragePath}`);
		} catch (err) {
			console.error(`Failed to sanitize coverage file ${coveragePath}:`, err);
			process.exit(1);
		}
	}
}

function awaitReadFileSafe(path: string): string {
	try {
		return readFileSync(path, "utf8");
	} catch (e) {
		const msg = e instanceof Error ? e.message : String(e);
		throw new Error(`Unable to read file ${path}: ${msg}`);
	}
}

function mergeCoverage(): void {
	const cmd = `docker run --rm -t -v ${COVERAGE_DIR}:/.coverage lcov-cli:0.0.2 --rc branch_coverage=1 -a /.coverage/unit/lcov.info -a /.coverage/e2e/lcov.info -o /.coverage/merged/lcov.info`;

	const out = runCommand(cmd);
	if (out) console.log(formatOutput(out));
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
