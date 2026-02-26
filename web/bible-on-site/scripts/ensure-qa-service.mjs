/**
 * Build and start the QA service (Rust) as a background process.
 * Skips if the service is already listening on its port.
 * Opt out by setting SKIP_QA_SERVICE=1.
 *
 * Usage:  node scripts/ensure-qa-service.mjs
 */
import { spawn, execSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createConnection } from "node:net";

if (process.env.SKIP_QA_SERVICE === "1") {
	process.exit(0);
}

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const qaServiceDir = resolve(__dirname, "../../qa-service");
const QA_HOST = process.env.QA_HOST ?? "127.0.0.1";
const QA_PORT = Number.parseInt(process.env.QA_PORT ?? "3004", 10);

function isPortOpen(host, port, timeoutMs = 2000) {
	return new Promise((resolveP) => {
		const sock = createConnection({ host, port, timeout: timeoutMs });
		sock.on("connect", () => {
			sock.destroy();
			resolveP(true);
		});
		sock.on("error", () => resolveP(false));
		sock.on("timeout", () => {
			sock.destroy();
			resolveP(false);
		});
	});
}

async function main() {
	if (await isPortOpen(QA_HOST, QA_PORT)) {
		console.info(`  qa-service already running on ${QA_HOST}:${QA_PORT}`);
		return;
	}

	console.info("  Building qa-service (cargo build --release)...");
	try {
		execSync("cargo build --release", {
			cwd: qaServiceDir,
			stdio: "inherit",
			shell: true,
		});
	} catch {
		console.warn("  qa-service build failed — QA widget will be unavailable");
		return;
	}

	console.info(`  Starting qa-service on ${QA_HOST}:${QA_PORT}...`);
	const child = spawn("cargo", ["run", "--release"], {
		cwd: qaServiceDir,
		stdio: "ignore",
		detached: true,
		shell: true,
		env: {
			...process.env,
			QA_BIND: `${QA_HOST}:${QA_PORT}`,
		},
	});
	child.unref();

	for (let i = 0; i < 15; i++) {
		await new Promise((r) => setTimeout(r, 1000));
		if (await isPortOpen(QA_HOST, QA_PORT)) {
			console.info(`  qa-service ready on ${QA_HOST}:${QA_PORT}`);
			return;
		}
	}
	console.warn("  qa-service did not become ready in 15s — QA widget may be unavailable");
}

main().catch((err) => {
	console.warn("ensure-qa-service:", err);
});
