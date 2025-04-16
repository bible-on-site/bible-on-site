import { spawn, type ChildProcess } from "node:child_process";

try {
	await main();
} catch (err) {
	console.error(err);
	process.exit(1);
}

let isAPIRunning = false;
let isTestRunning = false;
async function main() {
	process.chdir("../");
	// run API with coverage collection
	const coverageRun = spawn("cargo", ["make", "coverage-run"], { shell: true });

	coverageRun.stdout.on("data", handleCoverageRunOutput);
	coverageRun.stderr.on("data", handleCoverageRunOutput);
	coverageRun.once("close", (code) => {
		if (code !== 0) {
			if (!isAPIRunning || !isTestRunning) {
				// if both API and test are running let test handle server crash
				throw new Error(`API process exited with code ${code}`);
			}
		}
	});
}

let accumulatedStdout = "";
function handleCoverageRunOutput(chunk: Buffer) {
	const text = chunk.toString();
	process.stdout.write(text);
	if (isAPIRunning) {
		return;
	}
	// Accumulate stdout data until the marker is found
	accumulatedStdout += text;

	const apiRunningIndication = "Running";
	// When the marker appears in the accumulated output, start the test-e2e process
	if (accumulatedStdout.includes(apiRunningIndication)) {
		isAPIRunning = true;
		// run the e2e tests
		const testE2E = spawn("cargo", ["make", "test-e2e"], { shell: true });
		isTestRunning = true;
		testE2E.stdout.on("data", handleTestE2EOutput);
		testE2E.stderr.on("data", handleTestE2EOutput);
		testE2E.once("close", (code) => {
			if (code !== 0) {
				throw new Error(`Test process exited with code ${code}`);
			}
		});
	}
}
function handleTestE2EOutput(chunk: Buffer) {
	const text = chunk.toString();
	process.stdout.write(text);
}
