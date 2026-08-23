/**
 * Launch every local dev server (website, API, admin) from one place.
 *
 * Usage:
 *   npm run dev --prefix devops                  # everything that is down
 *   npm run dev --prefix devops -- --only api    # a subset
 *   npm run dev --prefix devops -- --skip admin  # everything but one
 *   npm run dev --prefix devops -- --restart     # restart even if already up
 *
 * Modules already listening are left alone, so this is safe to re-run.
 */

import { type ChildProcess, execFile, spawn } from "node:child_process";
import net from "node:net";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";

const execFileAsync = promisify(execFile);

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const IS_WINDOWS = process.platform === "win32";

interface DevModule {
	readonly name: string;
	readonly dir: string;
	/** Full shell command; spawned with `shell: true` so npm/cargo resolve on every OS. */
	readonly command: string;
	readonly port: number;
	readonly color: string;
	/** Slow first-boot steps (DB sync, docker, installs) need a generous window. */
	readonly readyTimeoutMs: number;
}

const RESET = "\x1b[0m";

const MODULES: readonly DevModule[] = [
	{
		name: "website",
		dir: "web/bible-on-site",
		command: "npm run dev",
		port: 3001,
		color: "\x1b[36m",
		readyTimeoutMs: 300_000,
	},
	{
		name: "api",
		dir: "web/api",
		command: "cargo make run-api-dev",
		port: 3003,
		color: "\x1b[35m",
		readyTimeoutMs: 600_000,
	},
	{
		name: "admin",
		dir: "web/admin",
		command: "npm run dev",
		port: 3101,
		color: "\x1b[33m",
		readyTimeoutMs: 300_000,
	},
];

/** Dev servers here bind IPv6 localhost, so an IPv4-only probe reports a live port as free. */
function canConnect(host: string, port: number): Promise<boolean> {
	return new Promise((resolve) => {
		const socket = net.createConnection({ host, port });
		const settle = (open: boolean) => {
			socket.destroy();
			resolve(open);
		};
		socket.setTimeout(1_000);
		socket.once("connect", () => settle(true));
		socket.once("timeout", () => settle(false));
		socket.once("error", () => settle(false));
	});
}

async function isPortOpen(port: number): Promise<boolean> {
	const results = await Promise.all(
		["127.0.0.1", "::1"].map((host) => canConnect(host, port)),
	);
	return results.some(Boolean);
}

function label(mod: DevModule): string {
	return `${mod.color}[${mod.name.padEnd(7)}]${RESET}`;
}

function pipeOutput(mod: DevModule, child: ChildProcess): void {
	for (const stream of [child.stdout, child.stderr]) {
		if (!stream) continue;
		let buffered = "";
		stream.setEncoding("utf8");
		stream.on("data", (chunk: string) => {
			buffered += chunk;
			const lines = buffered.split(/\r?\n/);
			buffered = lines.pop() ?? "";
			for (const line of lines) {
				console.log(`${label(mod)} ${line}`);
			}
		});
	}
}

/** Windows needs an explicit tree kill; npm/cargo spawn grandchildren that outlive the parent. */
function killTree(child: ChildProcess): void {
	if (child.pid === undefined || child.exitCode !== null) return;
	if (IS_WINDOWS) {
		spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], {
			stdio: "ignore",
		});
	} else {
		child.kill("SIGTERM");
	}
}

async function waitForPort(
	mod: DevModule,
	child: ChildProcess,
): Promise<boolean> {
	const deadline = Date.now() + mod.readyTimeoutMs;
	while (Date.now() < deadline) {
		if (await isPortOpen(mod.port)) return true;
		if (child.exitCode !== null) return false;
		await new Promise((resolve) => setTimeout(resolve, 500));
	}
	return false;
}

/** PIDs of whatever currently listens on `port`, regardless of who started it. */
async function listenerPids(port: number): Promise<string[]> {
	try {
		if (IS_WINDOWS) {
			/* No `-p TCP` filter: it hides TCPv6 rows, and these servers bind [::1]. */
			const { stdout } = await execFileAsync("netstat", ["-ano"]);
			const pids = stdout
				.split(/\r?\n/)
				.map((line) => line.trim().split(/\s+/))
				.filter(
					(cols) =>
						cols.length >= 5 &&
						cols[0] === "TCP" &&
						cols[3] === "LISTENING" &&
						cols[1].endsWith(`:${port}`),
				)
				.map((cols) => cols[4]);
			return [...new Set(pids)];
		}
		const { stdout } = await execFileAsync("lsof", [
			"-nP",
			`-iTCP:${port}`,
			"-sTCP:LISTEN",
			"-t",
		]);
		return [...new Set(stdout.split(/\r?\n/).filter(Boolean))];
	} catch {
		/* No listener (lsof exits non-zero) or the tool is unavailable. */
		return [];
	}
}

/**
 * Frees `port` before a restart. Without this the new server dies with
 * EADDRINUSE while the stale one keeps the port open — which also makes the
 * readiness probe pass against the old process and report a false success.
 */
async function freePort(mod: DevModule): Promise<boolean> {
	const pids = await listenerPids(mod.port);
	for (const pid of pids) {
		try {
			if (IS_WINDOWS) {
				await execFileAsync("taskkill", ["/pid", pid, "/T", "/F"]);
			} else {
				process.kill(Number(pid), "SIGTERM");
			}
			console.log(`${label(mod)} stopped stale process ${pid} on ${mod.port}`);
		} catch {
			console.log(`${label(mod)} could not stop process ${pid}`);
		}
	}

	/* The PID table is authoritative; a connect probe can still succeed for a
	   moment against a socket that is already tearing down. */
	const deadline = Date.now() + 30_000;
	while (Date.now() < deadline) {
		if ((await listenerPids(mod.port)).length === 0) return true;
		await new Promise((resolve) => setTimeout(resolve, 300));
	}
	return false;
}

const argv = await yargs(hideBin(process.argv))
	.option("only", {
		type: "array",
		string: true,
		describe: "Start only these modules",
		choices: MODULES.map((m) => m.name),
	})
	.option("skip", {
		type: "array",
		string: true,
		describe: "Start everything except these modules",
		choices: MODULES.map((m) => m.name),
	})
	.option("restart", {
		type: "boolean",
		default: false,
		describe: "Restart modules that are already listening",
	})
	.strict()
	.parse();

const selected = MODULES.filter(
	(m) =>
		(!argv.only || argv.only.includes(m.name)) &&
		!(argv.skip ?? []).includes(m.name),
);

const children: ChildProcess[] = [];
let shuttingDown = false;

function shutdown(code: number): never {
	if (!shuttingDown) {
		shuttingDown = true;
		for (const child of children) killTree(child);
	}
	process.exit(code);
}

process.on("SIGINT", () => {
	console.log("\nStopping dev servers…");
	shutdown(0);
});

const started: DevModule[] = [];
const alreadyUp: DevModule[] = [];
const failed: DevModule[] = [];

for (const mod of selected) {
	if (await isPortOpen(mod.port)) {
		if (!argv.restart) {
			alreadyUp.push(mod);
			console.log(`${label(mod)} already listening on ${mod.port} — leaving it`);
			continue;
		}
		if (!(await freePort(mod))) {
			failed.push(mod);
			console.log(`${label(mod)} FAILED — port ${mod.port} is still in use`);
			continue;
		}
	}

	console.log(`${label(mod)} starting: ${mod.command} (in ${mod.dir})`);
	const child = spawn(mod.command, {
		cwd: join(REPO_ROOT, mod.dir),
		shell: true,
		stdio: ["ignore", "pipe", "pipe"],
	});
	children.push(child);
	pipeOutput(mod, child);
	child.on("exit", (code) => {
		if (!shuttingDown && code !== 0) {
			console.log(`${label(mod)} exited with code ${code}`);
		}
	});

	if (await waitForPort(mod, child)) {
		started.push(mod);
		console.log(`${label(mod)} ready on http://localhost:${mod.port}`);
	} else {
		failed.push(mod);
		console.log(`${label(mod)} FAILED to become ready on port ${mod.port}`);
	}
}

console.log("\n=== dev servers ===");
for (const mod of [...started, ...alreadyUp].sort((a, b) => a.port - b.port)) {
	const note = alreadyUp.includes(mod) ? "(was already up)" : "";
	console.log(
		`  ${mod.name.padEnd(7)} http://localhost:${mod.port} ${note}`.trimEnd(),
	);
}
for (const mod of failed) {
	console.log(`  ${mod.name.padEnd(7)} FAILED — see the log above`);
}

if (failed.length > 0) shutdown(1);

if (children.length === 0) {
	console.log("\nNothing to start; every selected module was already running.");
	process.exit(0);
}

console.log("\nStreaming logs. Press Ctrl+C to stop the servers started here.");
