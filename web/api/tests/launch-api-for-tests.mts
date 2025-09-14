import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url); // get the resolved path to the file
const __dirname = path.dirname(__filename); // get the name of the directory

try {
	await main();
} catch (err) {
	console.error(err);
	process.exit(1);
}

async function main() {
	const shouldMeasureCov = process.argv.includes("--measure-cov");
	process.chdir(path.resolve(__dirname, ".."));

	const coverageRun = spawn(
		"cargo",
		["make", shouldMeasureCov ? "run-for-coverage" : "run-for-tests"],
		{ shell: true },
	);

	coverageRun.stdout.on("data", (data) => {
		const str = data.toString();
		process.stdout.write(str);
	});
	coverageRun.stderr.on("data", (data) => {
		const str = data.toString();
		process.stderr.write(str);
	});
	coverageRun.once("close", (code) => {
		if (code !== 0) {
			throw new Error(`API process exited with code ${code}`);
		}
	});
}
