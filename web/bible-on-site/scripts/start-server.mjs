import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { constants } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** Log only the image loader, so deployment evidence can confirm lazy loading. */
export async function reportImageSnapshotter({
	uri = process.env.ECS_CONTAINER_METADATA_URI_V4,
	request = fetch,
	log = console.log,
} = {}) {
	if (!uri) return false;
	try {
		const url = new URL(uri);
		if (
			url.protocol !== "http:" ||
			url.hostname !== "169.254.170.2" ||
			url.port ||
			url.username ||
			url.password ||
			url.search ||
			url.hash ||
			!/^\/v4\/[a-zA-Z0-9-]+$/.test(url.pathname)
		)
			return false;
		const response = await request(url, {
			signal: AbortSignal.timeout(2_000),
			redirect: "error",
		});
		if (!response.ok || !response.body) return false;
		const chunks = [];
		let size = 0;
		for await (const chunk of response.body) {
			size += chunk.length;
			if (size > 64 * 1024) return false;
			chunks.push(Buffer.from(chunk));
		}
		const { Snapshotter } = JSON.parse(Buffer.concat(chunks).toString("utf8"));
		if (Snapshotter !== "soci" && Snapshotter !== "overlayfs") return false;
		log(JSON.stringify({ websiteImageSnapshotter: Snapshotter }));
		return true;
	} catch {
		return false;
	}
}

// /proc/net/tcp states that can still receive a request or complete a response.
// Dying half-close states and TIME_WAIT are intentionally absent: their bytes
// are already exchanged, so they must not hold the drain open.
const LIVE_STATES = new Set(["01", "03", "08"]); // ESTABLISHED, SYN_RECV, CLOSE_WAIT

/**
 * /proc stores IPv4 little-endian (127.0.0.1 appears as 0100007F), so the
 * first dotted octet is the last hex pair. IPv6 appears as four little-endian
 * words; ::1 ends in 01000000 and v4-mapped addresses carry FFFF0000 in the
 * third word. Same-host clients (container health checks, exec sessions) are
 * loopback remotes and do not need DNS-drain protection: nothing can reach
 * them once the task stops anyway.
 */
function isLoopback(hexAddress) {
	const hex = hexAddress.toUpperCase();
	if (hex.length === 8) return hex.slice(6, 8) === "7F";
	if (hex.length === 32) {
		if (hex === "00000000000000000000000001000000") return true;
		if (
			hex.slice(0, 16) === "0000000000000000" &&
			hex.slice(16, 24) === "FFFF0000"
		)
			return isLoopback(hex.slice(24));
	}
	return false;
}

function countLiveInbound(text, portHex) {
	let count = 0;
	for (const line of text.split("\n")) {
		const fields = line.trim().split(/\s+/);
		if (fields.length < 4) continue;
		const separator = fields[1].lastIndexOf(":");
		if (
			separator < 0 ||
			fields[1].slice(separator + 1).toUpperCase() !== portHex ||
			!LIVE_STATES.has(fields[3])
		)
			continue;
		const remote = fields[2].slice(0, fields[2].lastIndexOf(":"));
		if (isLoopback(remote)) continue;
		count += 1;
	}
	return count;
}

/**
 * Count non-loopback sockets still serving bytes on the server port, read
 * from the task's own network namespace via procfs. The router opens a fresh
 * connection per proxied request (no upstream keepalive), so a nonzero count
 * means a cached-DNS client is still being served. Throws when the table is
 * unreadable so callers can fail closed on platforms without procfs.
 */
export async function inboundConnections(
	port,
	{
		read = readFile,
		files = [
			{ path: "/proc/net/tcp", optional: false },
			{ path: "/proc/net/tcp6", optional: true }, // absent when IPv6 is disabled
		],
	} = {},
) {
	if (!Number.isSafeInteger(port) || port < 0 || port > 65_535)
		throw new RangeError("Website port must be between 0 and 65535");
	const portHex = port.toString(16).toUpperCase().padStart(4, "0");
	let total = 0;
	for (const { path: table, optional } of files) {
		let text;
		try {
			text = await read(table, "utf8");
		} catch (error) {
			if (optional && error?.code === "ENOENT") continue;
			throw error;
		}
		total += countLiveInbound(text, portHex);
	}
	return total;
}

const READINESS_PATH = "/api/health/ready";

/**
 * Fire the canonical warm-up as soon as the listener accepts instead of
 * waiting for the first scheduled container check: the Docker
 * `--start-interval` delays that check several seconds after the socket is
 * already queueing requests, so the whole readiness warm-up (canonical data,
 * search indexes, recitation package, page renderers) otherwise starts late.
 * The endpoint is single-flight and authoritative — the probe is simply an
 * early client of the same warm the health check drives, and its first
 * response doubles as startup timing evidence in the container log.
 * Connection refusals while the listener boots are retried; any HTTP
 * response — ready or not — ends the probe because the warm was triggered.
 * `stop` aborts a pending request so the wrapper never outlives its child.
 */
export function startReadinessProbe({
	port,
	request = fetch,
	retryDelayMs = 250,
	log = console.log,
	warn = console.warn,
	now = Date.now,
	// unref keeps a pending retry from holding the wrapper open after the
	// child has already exited.
	sleep = (ms) =>
		new Promise((resolve) => {
			setTimeout(resolve, ms).unref();
		}),
} = {}) {
	if (!Number.isSafeInteger(port) || port < 1 || port > 65_535)
		throw new RangeError("Website port must be between 1 and 65535");
	const controller = new AbortController();
	const startedAt = now();
	const reported = new Set();
	let stopped = false;
	const stop = () => {
		stopped = true;
		controller.abort();
	};
	const run = async () => {
		const url = `http://127.0.0.1:${port}${READINESS_PATH}`;
		while (!stopped) {
			try {
				const response = await request(url, {
					signal: controller.signal,
					// One-shot trigger: a pooled keep-alive socket would linger
					// past the child's exit and delay the wrapper's own exit.
					headers: { connection: "close" },
				});
				// Consume the small readiness JSON so the logged duration covers
				// the complete handler, warm-up included.
				await response.text();
				if (stopped) return;
				log(
					`Website readiness probe: HTTP ${response.status} after ${now() - startedAt}ms`,
				);
				return;
			} catch (error) {
				if (stopped) return;
				// Listener-boot refusals are the expected retry; report each
				// distinct failure once so a stuck warm-up stays visible in the
				// container log without flooding it every 250ms.
				const signature = `${error} ${error?.cause ?? ""}`;
				if (!reported.has(signature)) {
					reported.add(signature);
					warn("Website readiness probe attempt failed:", error);
				}
			}
			await sleep(retryDelayMs);
		}
	};
	run().catch((error) => {
		// Best-effort trigger only: a probe defect must never take down the
		// launcher — the container health check still drives the warm-up.
		console.error("Website readiness probe stopped:", error);
	});
	return stop;
}

/**
 * Keep accepting requests while Cloud Map removal reaches cached DNS answers.
 * `minDrainMs` is the floor covering that propagation: quiet termination is
 * allowed only after it elapses, because a zero socket count cannot prove the
 * router has stopped resolving the old address.
 */
export function startServer({
	drainMs = 90_000,
	minDrainMs = 45_000,
	quietMs = 30_000,
	pollMs = 500,
	port = Number(process.env.PORT) || 3000,
	cwd = process.cwd(),
	measure = () => inboundConnections(port),
	now = Date.now,
	log = console.log,
} = {}) {
	for (const [name, value] of [
		["drain", drainMs],
		["minimum drain", minDrainMs],
		["quiet window", quietMs],
	]) {
		if (!Number.isSafeInteger(value) || value < 0 || value > 90_000)
			throw new RangeError(
				`Website ${name} must be between 0 and 90000 milliseconds`,
			);
	}
	if (minDrainMs > drainMs)
		throw new RangeError("Website minimum drain must not exceed the drain");
	if (!Number.isSafeInteger(pollMs) || pollMs < 1 || pollMs > 90_000)
		throw new RangeError(
			"Website drain poll must be between 1 and 90000 milliseconds",
		);
	if (!Number.isSafeInteger(port) || port < 0 || port > 65_535)
		throw new RangeError("Website port must be between 0 and 65535");
	const child = spawn(process.execPath, ["server.js"], {
		cwd,
		stdio: "inherit",
	});
	let drainTimer;
	let stopping = false;
	const forward = (signal) => {
		if (stopping) return;
		stopping = true;
		clearTimeout(drainTimer);
		child.kill(signal);
	};
	const terminate = () => {
		if (stopping || drainTimer) return;
		log(
			`Website draining cached DNS requests: forwarding SIGTERM after ${quietMs}ms without inbound connections, no earlier than ${minDrainMs}ms, or ${drainMs}ms at most`,
		);
		const startedAt = now();
		let lastBusy = startedAt;
		let polling = false;
		const finish = (reason) => {
			if (stopping) return;
			log(
				`Website drain ${reason} after ${now() - startedAt}ms; forwarding SIGTERM to server.js`,
			);
			forward("SIGTERM");
		};
		const check = async () => {
			if (stopping || polling) return;
			polling = true;
			let inbound;
			try {
				inbound = await measure();
			} catch {
				// An unreadable metric keeps the drain serving, identical to
				// the previous unconditional wait — but the deadline still holds.
				inbound = Number.NaN;
			} finally {
				polling = false;
			}
			const at = now();
			// Only an exact zero is quiet; errors and junk fail closed.
			if (!Number.isFinite(inbound) || inbound !== 0) lastBusy = at;
			if (at - startedAt >= drainMs) return finish("reached the deadline");
			if (at - startedAt >= minDrainMs && at - lastBusy >= quietMs)
				return finish("saw no inbound connections");
		};
		void check();
		drainTimer = setInterval(() => void check(), pollMs);
		drainTimer.unref();
	};
	const interrupt = () => forward("SIGINT");
	const cleanup = () => {
		stopProbe();
		clearTimeout(drainTimer);
		process.off("SIGTERM", terminate);
		process.off("SIGINT", interrupt);
	};
	process.on("SIGTERM", terminate);
	process.on("SIGINT", interrupt);
	child.once("error", (error) => {
		cleanup();
		console.error("Website server could not start:", error);
		process.exitCode = 1;
	});
	child.once("exit", (code, signal) => {
		cleanup();
		process.exitCode = code ?? 128 + (constants.signals[signal] ?? 0);
	});
	// The first fetch can synchronously initialize its HTTP client while the
	// child is already listening. Install signal and lifecycle handlers before
	// starting it so an immediate stop still drains and reaps the child.
	// Port 0 selects an ephemeral listener the probe cannot address.
	const stopProbe = port > 0 ? startReadinessProbe({ port, log }) : () => {};
	return child;
}

if (path.resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
	startServer();
	void reportImageSnapshotter();
}
