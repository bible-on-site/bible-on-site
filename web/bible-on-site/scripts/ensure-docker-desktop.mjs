/**
 * Ensures Docker Desktop is running before dev scripts that need it.
 * If Docker daemon is not reachable, attempts to start Docker Desktop
 * and waits until the daemon is ready (up to ~60 seconds).
 */
import { execSync, spawn } from "node:child_process";

const MAX_WAIT_SECONDS = 60;
const POLL_INTERVAL_MS = 3000;

function isDockerRunning() {
	try {
		execSync("docker info", { stdio: "ignore", timeout: 10_000 });
		return true;
	} catch {
		return false;
	}
}

async function startDockerDesktop() {
	const platform = process.platform;
	if (platform === "win32") {
		spawn("cmd.exe", ["/c", "start", "", "C:\\Program Files\\Docker\\Docker\\Docker Desktop.exe"], {
			detached: true,
			stdio: "ignore",
		}).unref();
	} else if (platform === "darwin") {
		spawn("open", ["-a", "Docker"], { detached: true, stdio: "ignore" }).unref();
	} else {
		// Linux: systemctl or direct dockerd — assume user handles it
		console.warn("  Cannot auto-start Docker on Linux. Please start Docker manually.");
		process.exit(1);
	}
}

async function waitForDocker() {
	const deadline = Date.now() + MAX_WAIT_SECONDS * 1000;
	while (Date.now() < deadline) {
		if (isDockerRunning()) return true;
		await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
	}
	return false;
}

async function main() {
	if (isDockerRunning()) {
		return; // already running, nothing to do
	}

	console.info("Docker Desktop is not running. Starting it...");
	await startDockerDesktop();

	process.stdout.write("Waiting for Docker daemon");
	const ready = await waitForDocker();
	console.info(""); // newline after dots

	if (!ready) {
		console.error(`Docker Desktop did not start within ${MAX_WAIT_SECONDS}s. Please start it manually.`);
		process.exit(1);
	}
	console.info("Docker Desktop is ready.");
}

main();
