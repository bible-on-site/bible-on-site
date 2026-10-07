import { spawn, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";
import { setTimeout as delay } from "node:timers/promises";

const directory = dirname(fileURLToPath(import.meta.url));
const apiDirectory = resolve(directory, "../web/api");
const args = process.argv.slice(2);
if (args.includes("--help")) {
	console.log(
		"npm run backend [-- --native]\nStarts the local API on port 3003. Docker uses the existing development MySQL database; --native uses Cargo directly. Existing healthy servers are reused.",
	);
	process.exit(0);
}
if (args.some((arg) => arg !== "--native"))
	throw new Error("Only --native and --help are supported.");

async function healthy() {
	try {
		// Loopback health check contains no credentials and never leaves this computer.
		// nosemgrep: typescript.react.security.react-insecure-request.react-insecure-request
		const response = await fetch("http://127.0.0.1:3003/health", {
			signal: AbortSignal.timeout(2000),
		});
		return response.ok && (await response.json()).status === "ok";
	} catch {
		return false;
	}
}

function run(command, arguments_, options = {}) {
	const result = spawnSync(command, arguments_, {
		cwd: directory,
		windowsHide: true,
		...options,
	});
	if (result.error || result.status !== 0)
		throw new Error(
			`${command} failed. ${result.error?.message ?? "See output above."}`,
		);
}

async function waitForApi(child) {
	const deadline = Date.now() + 600_000;
	while (Date.now() < deadline) {
		if (await healthy()) {
			console.log(
				"Backend ready: http://localhost:3003 (Android emulator: http://10.0.2.2:3003)",
			);
			return;
		}
		if (child && child.exitCode !== null)
			throw new Error(
				"API exited before becoming ready. Check the database connection and output above.",
			);
		await delay(1000);
	}
	throw new Error("The backend did not become ready within ten minutes.");
}

if (await healthy()) {
	console.log(
		"Backend already ready: http://localhost:3003 (Android emulator: http://10.0.2.2:3003)",
	);
} else if (args.includes("--native")) {
	console.log(
		"Starting the API with the installed MySQL service. First compilation may take a few minutes.",
	);
	const child = spawn("cargo", ["run", "--locked"], {
		cwd: apiDirectory,
		windowsHide: true,
		stdio: "inherit",
		env: { ...process.env, PROFILE: "dev" },
	});
	let startupError;
	const exited = new Promise((resolveExit) => {
		child.once("exit", (code) => resolveExit(code ?? 1));
		child.once("error", (error) => {
			startupError = error;
			resolveExit(1);
		});
	});
	const stop = () => {
		if (child.exitCode !== null || !child.pid) return;
		if (process.platform === "win32")
			spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], {
				windowsHide: true,
				stdio: "ignore",
			});
		else child.kill("SIGTERM");
	};
	process.on("SIGINT", stop);
	process.on("SIGTERM", stop);
	try {
		await Promise.race([
			waitForApi(child),
			exited.then(() => {
				throw startupError ?? new Error("API exited before becoming ready.");
			}),
		]);
	} catch (error) {
		stop();
		throw error;
	}
	process.exitCode = await exited;
} else {
	const ready = () =>
		spawnSync("docker", ["info", "--format", "{{.ServerVersion}}"], {
			timeout: 3000,
			windowsHide: true,
			stdio: "ignore",
		}).status === 0;
	if (!ready()) {
		console.log("Starting Docker Desktop...");
		run("docker", ["desktop", "start", "--detach"], {
			timeout: 30_000,
			stdio: "inherit",
		});
		const deadline = Date.now() + 60_000;
		while (!ready() && Date.now() < deadline) await delay(2000);
		if (!ready())
			throw new Error(
				"Docker Engine is unavailable. Inspect the Docker Desktop error, or use npm run backend -- --native with the installed MySQL service. No Docker data has been reset.",
			);
	}
	const local = {
		...parseEnv(readFileSync(resolve(apiDirectory, ".dev.env"), "utf8")),
		...process.env,
	};
	const database = new URL(local.DB_URL);
	if (["localhost", "127.0.0.1", "[::1]"].includes(database.hostname))
		database.hostname = "host.docker.internal";
	const environment = { ...process.env, LOCAL_BACKEND_DB_URL: database.href };
	run(
		"docker",
		[
			"compose",
			"--profile",
			"backend",
			"up",
			"--build",
			"--detach",
			"--wait",
			"--wait-timeout",
			"120",
			"api",
		],
		{ env: environment, stdio: "inherit" },
	);
	await waitForApi();
}
