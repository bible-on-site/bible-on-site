import { spawn } from "node:child_process";
import { mkdirSync, openSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url); // get the resolved path to the file
const __dirname = path.dirname(__filename); // get the name of the directory

try {
	main();
} catch (err) {
	console.error(err);
	process.exit(1);
}

function main() {
	process.chdir(path.resolve(__dirname, ".."));
	const logDir = path.resolve(__dirname, ".log");
	mkdirSync(logDir, { recursive: true });
	const out = openSync(path.resolve(logDir, "api.log"), "w");
	const shouldMeasureCov = process.argv.includes("--measure-cov");
	const coverageFilePath = path.resolve(
		__dirname,
		"../.coverage/e2e/lcov.info",
	);

	if (shouldMeasureCov) {
		rmSync(coverageFilePath, { force: true });
	}

	const cargo = spawn(
		"cargo",
		["make", shouldMeasureCov ? "run-for-coverage" : "run-for-tests"],
		{ detached: true, stdio: ["ignore", out, out] },
	);
	cargo.unref();
}
