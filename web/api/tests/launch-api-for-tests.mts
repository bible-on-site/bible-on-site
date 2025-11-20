import { fork } from "node:child_process";
import { mkdirSync, openSync } from "node:fs";
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
	process.chdir(path.resolve(__dirname, ".."));
	const logDir = path.resolve(__dirname, ".log");
	mkdirSync(logDir, { recursive: true });
	const out = openSync(path.resolve(logDir, "api_launcher.log"), "w");

	// Fork with tsx loader via Node's --import flag
	// TODO: find a way without this ugly wrapper.
	// The original issue was that when the tests are finished, a signal is sent to this process which then kills the API as well.
	// The workaround is to have this wrapper process detached from the launcher process.
	const wrapper = fork(
		path.resolve(__dirname, "cargo_wrapper.mts"),
		process.argv.slice(2),
		{
			cwd: __dirname,
			detached: true,
			execArgv: ["--no-deprecation", "--trace-deprecation", "--import", "tsx"],
			silent: true,
			stdio: ["ignore", out, out, "ipc"],
		},
	);

	wrapper.unref();

	// Keep the process alive by monitoring in an infinite loop
	while (true) {
		await new Promise((resolve) => setTimeout(resolve, 1000));
	}
}
