/**
 * Kills any process listening on the given port (default 3001).
 * Opt out by setting SKIP_KILL_PORT=1.
 *
 * Usage:  node scripts/kill-port.mjs [port]
 */
import { execSync } from "node:child_process";

if (process.env.SKIP_KILL_PORT === "1") {
	process.exit(0);
}

const port = process.argv[2] ?? "3001";

function killOnWindows() {
	try {
		const out = execSync(`netstat -ano | findstr LISTENING | findstr :${port}`, {
			encoding: "utf-8",
			timeout: 5000,
		});
		const pids = new Set();
		for (const line of out.trim().split("\n")) {
			const pid = line.trim().split(/\s+/).pop();
			if (pid && /^\d+$/.test(pid) && pid !== "0") pids.add(pid);
		}
		for (const pid of pids) {
			try {
				execSync(`taskkill /PID ${pid} /F`, { stdio: "ignore", timeout: 5000 });
				console.info(`  Killed PID ${pid} on port ${port}`);
			} catch { /* already dead */ }
		}
	} catch {
		// No process on port — nothing to do
	}
}

function killOnUnix() {
	try {
		execSync(`lsof -ti :${port} | xargs kill -9 2>/dev/null`, {
			stdio: "ignore",
			timeout: 5000,
		});
		console.info(`  Killed process on port ${port}`);
	} catch {
		// No process on port — nothing to do
	}
}

if (process.platform === "win32") {
	killOnWindows();
} else {
	killOnUnix();
}
