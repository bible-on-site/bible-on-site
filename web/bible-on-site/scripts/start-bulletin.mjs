/**
 * Starts the bulletin Lambda (Rust PDF service) in local dev mode.
 *
 * - Checks if cargo (Rust) is installed
 * - Builds the bulletin binary with --features local
 * - Starts it in the background on port 9000
 * - Waits for the health endpoint to respond
 * - Stores the PID so it can be cleaned up on exit
 *
 * Opt out by setting SKIP_BULLETIN=1.
 */
import { spawn, execSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { writeFileSync, existsSync, readFileSync, unlinkSync } from "node:fs";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const webDir = resolve(__dirname, "..");
const bulletinDir = resolve(__dirname, "../../bulletin");
const pidFile = resolve(bulletinDir, ".dev-pid");
const port = process.env.BULLETIN_PORT ?? "9000";
const healthUrl = `http://127.0.0.1:${port}/health`;

/**
 * Load key env vars from .dev.env — needed because predev runs before
 * dotenv-cli loads .dev.env for the dev script.
 */
function loadDevEnv() {
	const devEnvPath = resolve(webDir, ".dev.env");
	const env = {};
	try {
		const content = readFileSync(devEnvPath, "utf8");
		for (const line of content.split("\n")) {
			const trimmed = line.trim();
			if (!trimmed || trimmed.startsWith("#")) continue;
			const eqIdx = trimmed.indexOf("=");
			if (eqIdx > 0) {
				env[trimmed.slice(0, eqIdx).trim()] = trimmed.slice(eqIdx + 1).trim();
			}
		}
	} catch {
		// .dev.env missing — not fatal
	}
	return env;
}

if (process.env.SKIP_BULLETIN === "1") {
	console.info("  start-bulletin: SKIP_BULLETIN=1, skipping");
	process.exit(0);
}

function isPortInUse() {
	try {
		const response = execSync(`curl -s --max-time 2 ${healthUrl}`, {
			encoding: "utf-8",
			timeout: 5000,
		});
		return response.includes("bulletin");
	} catch {
		return false;
	}
}

function killExistingProcess() {
	if (existsSync(pidFile)) {
		const pid = readFileSync(pidFile, "utf-8").trim();
		if (pid && /^\d+$/.test(pid)) {
			try {
				if (process.platform === "win32") {
					execSync(`taskkill /PID ${pid} /F`, {
						stdio: "ignore",
						timeout: 5000,
					});
				} else {
					execSync(`kill ${pid} 2>/dev/null`, {
						stdio: "ignore",
						timeout: 5000,
					});
				}
				console.info(`  start-bulletin: killed previous instance (PID ${pid})`);
			} catch {
				/* already dead */
			}
		}
		unlinkSync(pidFile);
	}
}

function checkCargoInstalled() {
	try {
		execSync("cargo --version", { stdio: "ignore", timeout: 5000 });
		return true;
	} catch {
		return false;
	}
}

async function waitForHealth(maxWaitMs = 120_000) {
	const start = Date.now();
	const interval = 2000;
	while (Date.now() - start < maxWaitMs) {
		if (isPortInUse()) return true;
		await new Promise((r) => setTimeout(r, interval));
	}
	return false;
}

async function main() {
	// Already running?
	if (isPortInUse()) {
		console.info(`  start-bulletin: already running on port ${port}`);
		return;
	}

	if (!checkCargoInstalled()) {
		console.warn(
			"  start-bulletin: Rust/cargo not installed — bulletin service won't be available.\n" +
				"  PDF download will not work. Install Rust from https://rustup.rs/",
		);
		return;
	}

	killExistingProcess();

	console.info("  start-bulletin: building & starting bulletin service...");

	// Load .dev.env so bulletin gets DB_URL and other config
	const devEnv = loadDevEnv();

	// Use cargo run with --features local — it builds and runs in one step
	const child = spawn(
		"cargo",
		["run", "--features", "local"],
		{
			cwd: bulletinDir,
			stdio: ["ignore", "pipe", "pipe"],
			shell: true,
			detached: false,
			env: {
				...process.env,
				...devEnv,
				RUST_LOG: "info",
				BULLETIN_PORT: port,
				FONTS_DIR: resolve(bulletinDir, "fonts"),
			},
		},
	);

	if (child.pid) {
		writeFileSync(pidFile, String(child.pid));
	}

	// Log output for debugging
	child.stdout?.on("data", (data) => {
		const line = data.toString().trim();
		if (line) console.info(`  [bulletin] ${line}`);
	});
	child.stderr?.on("data", (data) => {
		const line = data.toString().trim();
		if (line) console.info(`  [bulletin] ${line}`);
	});

	child.on("exit", (code) => {
		if (code !== 0 && code !== null) {
			console.error(`  start-bulletin: process exited with code ${code}`);
		}
	});

	// Don't let the bulletin server prevent Node from exiting
	child.unref();

	// Wait for it to be healthy
	const ready = await waitForHealth();
	if (ready) {
		console.info(`  start-bulletin: ready on http://127.0.0.1:${port}`);
	} else {
		console.warn(
			"  start-bulletin: timed out waiting for health check. The service may still be compiling.\n" +
				"  It will be available shortly — first build takes longer.",
		);
	}
}

main().catch((err) => {
	console.error("start-bulletin:", err);
	// Don't exit with error — dev server should still start
});
