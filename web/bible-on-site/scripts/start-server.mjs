import { spawn } from "node:child_process";
import { Resolver } from "node:dns/promises";
import { readFile } from "node:fs/promises";
import net from "node:net";
import { constants, networkInterfaces } from "node:os";
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
 * One bare TCP handshake against the listener — the timestamp separates
 * "first listening socket" from the initialization and warm-up work the HTTP
 * request then queues behind. The socket is closed immediately; the server's
 * backlog already proved the listener is up.
 */
function socketAccept(port, signal) {
	return new Promise((resolve, reject) => {
		const socket = net.connect({ port, host: "127.0.0.1" });
		function done(error) {
			// Each refused retry re-registers; the listener must not outlive
			// its own attempt or refused cold starts accumulate handlers on the
			// shared signal.
			signal?.removeEventListener("abort", onAbort);
			socket.destroy();
			if (error) reject(error);
			else resolve();
		}
		const onAbort = () => done(signal?.reason ?? new Error("aborted"));
		if (signal?.aborted) return done(signal.reason);
		socket.once("connect", () => done());
		socket.once("error", (error) => done(error));
		signal?.addEventListener("abort", onAbort);
	});
}

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
 *
 * With the real `request` (or an injected `connect`) a bare handshake first
 * marks when the socket itself starts accepting, so listener-accept and the
 * initialization+warm response are separately measurable in CloudWatch —
 * the split the handover issue asks for. An injected `request` without a
 * `connect` runs the request loop alone, unchanged.
 */
export function startReadinessProbe({
	port,
	request = fetch,
	connect,
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
	// `connect: null` disables the accept check explicitly; a test that injects
	// `request` without `connect` has no real socket to accept against.
	const connector =
		connect === null
			? null
			: (connect ?? (request === fetch ? socketAccept : null));
	const controller = new AbortController();
	const startedAt = now();
	const reported = new Set();
	let stopped = false;
	const stop = () => {
		stopped = true;
		controller.abort();
	};
	const report = (error) => {
		// Listener-boot refusals are the expected retry; report each distinct
		// failure once so a stuck warm-up stays visible in the container log
		// without flooding it every 250ms.
		const signature = `${error} ${error?.cause ?? ""}`;
		if (!reported.has(signature)) {
			reported.add(signature);
			warn("Website readiness probe attempt failed:", error);
		}
	};
	const run = async () => {
		const url = `http://127.0.0.1:${port}${READINESS_PATH}`;
		let accepted = false;
		while (!stopped) {
			if (connector && !accepted) {
				try {
					await connector(port, controller.signal);
					accepted = true;
					log(
						`Website listener accepting connections after ${now() - startedAt}ms`,
					);
				} catch (error) {
					if (stopped) return;
					report(error);
					await sleep(retryDelayMs);
					continue;
				}
			}
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
				report(error);
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

/** The task's own non-loopback IPv4 addresses — its service-discovery answer. */
function taskAddresses() {
	return Object.values(networkInterfaces())
		.flat()
		.filter((row) => row && row.family === "IPv4" && !row.internal)
		.map((row) => row.address);
}

const boundedDelay = (ms) =>
	new Promise((resolve) => {
		setTimeout(resolve, ms).unref();
	});

/**
 * Keep accepting requests while Cloud Map removal reaches cached DNS answers.
 * The floor is measured, not guessed: the task resolves its own discovery
 * name through the same VPC resolver the router uses, and quiet termination
 * is allowed once this task's address has been absent from answers for the
 * router's full `valid=10s` cache window (`routerCacheMs`) — a cached answer
 * naming the removed address can be at most that old. When no discovery read
 * succeeds, `minDrainMs` remains the unconditional floor, exactly as before:
 * a zero socket count cannot prove the old address is out of answers, and a
 * missing answer cannot either. Slow removal that outlasts the old floor keeps
 * the drain serving toward the same `drainMs` deadline instead of dropping
 * clients the fixed estimate was protecting.
 */
export function startServer({
	drainMs = 90_000,
	minDrainMs = 45_000,
	quietMs = 30_000,
	pollMs = 500,
	routerCacheMs = 10_000,
	dnsTimeoutMs = 1_000,
	port = Number(process.env.PORT) || 3000,
	cwd = process.cwd(),
	measure = () => inboundConnections(port),
	resolve,
	serviceName = process.env.WEBSITE_DISCOVERY_NAME ??
		"website.bible-on-site.local",
	ownAddresses = taskAddresses,
	now = Date.now,
	log = console.log,
	warn = console.warn,
} = {}) {
	for (const [name, value] of [
		["drain", drainMs],
		["minimum drain", minDrainMs],
		["quiet window", quietMs],
		["router cache", routerCacheMs],
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
	if (
		!Number.isSafeInteger(dnsTimeoutMs) ||
		dnsTimeoutMs < 1 ||
		dnsTimeoutMs > 90_000
	)
		throw new RangeError(
			"Website discovery timeout must be between 1 and 90000 milliseconds",
		);
	if (!Number.isSafeInteger(port) || port < 0 || port > 65_535)
		throw new RangeError("Website port must be between 0 and 65535");
	// The default resolver self-bounds each query so a stalled VPC resolver
	// cannot hold the event loop open; `cancel` tears anything in-flight down
	// with the child. Injected resolvers keep their own behavior — the drain
	// race still bounds them.
	const resolver =
		resolve === undefined
			? new Resolver({ timeout: dnsTimeoutMs, tries: 1 })
			: null;
	const resolveName = resolve ?? ((name) => resolver.resolve4(name));
	let child;
	let stopProbe = () => {};
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
			`Website draining cached DNS requests: forwarding SIGTERM after ${quietMs}ms without inbound connections, once this task has been out of discovery answers for ${routerCacheMs}ms (${minDrainMs}ms when discovery is unreadable), or ${drainMs}ms at most`,
		);
		const startedAt = now();
		let lastBusy = startedAt;
		// The latest moment the address could still have been in answers: the
		// last "listed" read, or — when no read ever saw it — the first
		// "absent" read, the earliest point absence is provable. The floor is
		// one full router-cache window after that.
		let lastListedAt = startedAt;
		let discoveryReadable = false;
		let removalObserved = false;
		let polling = false;
		const finish = (reason) => {
			if (stopping) return;
			log(
				`Website drain ${reason} after ${now() - startedAt}ms; forwarding SIGTERM to server.js`,
			);
			forward("SIGTERM");
		};
		// "listed" only when an answer actually contains a task address;
		// unknown own addresses cannot prove anything — like a failed read.
		const discover = async () => {
			if (!serviceName) return null;
			const own = ownAddresses();
			if (own.length === 0) return null;
			const answer = await Promise.race([
				resolveName(serviceName),
				boundedDelay(dnsTimeoutMs).then(() => {
					throw new Error("discovery resolve timed out");
				}),
			]);
			if (!Array.isArray(answer)) return null;
			return answer.some((address) => own.includes(address))
				? "listed"
				: "absent";
		};
		// Resolver failures must not silently downgrade the drain to its fixed
		// floor: report each distinct failure once per drain.
		const reported = new Set();
		const report = (error) => {
			const signature = `${error}`;
			if (!reported.has(signature)) {
				reported.add(signature);
				warn(
					"Website discovery read failed; fixed minimum drain floor applies:",
					error,
				);
			}
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
			}
			let listing;
			try {
				listing = await discover();
			} catch (error) {
				if (!stopping) report(error);
				listing = null;
			} finally {
				polling = false;
			}
			const at = now();
			// Only an exact zero is quiet; errors and junk fail closed.
			if (!Number.isFinite(inbound) || inbound !== 0) lastBusy = at;
			if (listing !== null) {
				discoveryReadable = true;
				if (listing === "listed") {
					lastListedAt = at;
				} else if (!removalObserved) {
					removalObserved = true;
					lastListedAt = at;
					log(`Website task left discovery answers after ${at - startedAt}ms`);
				}
			}
			if (at - startedAt >= drainMs) return finish("reached the deadline");
			// Once absence is proven, the floor is the router's full cache
			// window after the last moment the answer could still have named
			// this task. While a readable answer still lists the task the floor
			// stays open toward the deadline — quiet clients can reconnect at
			// an advertised address. With no successful read at all, the fixed
			// minimum covers removal propagation exactly as before.
			const floorCleared = removalObserved
				? at - lastListedAt >= routerCacheMs
				: !discoveryReadable && at - startedAt >= minDrainMs;
			if (floorCleared && at - lastBusy >= quietMs)
				return finish("saw no inbound connections");
		};
		void check();
		drainTimer = setInterval(() => void check(), pollMs);
		drainTimer.unref();
	};
	const interrupt = () => forward("SIGINT");
	const cleanup = () => {
		stopProbe();
		resolver?.cancel();
		clearTimeout(drainTimer);
		process.off("SIGTERM", terminate);
		process.off("SIGINT", interrupt);
	};
	process.on("SIGTERM", terminate);
	process.on("SIGINT", interrupt);
	// Register shutdown handling before the child can become ready or fetch
	// initializes its client synchronously during the first readiness probe.
	try {
		child = spawn(process.execPath, ["server.js"], {
			cwd,
			stdio: "inherit",
		});
	} catch (error) {
		cleanup();
		throw error;
	}
	child.once("error", (error) => {
		cleanup();
		console.error("Website server could not start:", error);
		process.exitCode = 1;
	});
	child.once("exit", (code, signal) => {
		cleanup();
		process.exitCode = code ?? 128 + (constants.signals[signal] ?? 0);
	});
	// Port 0 selects an ephemeral listener the probe cannot address; production
	// always binds the configured port.
	if (port > 0) stopProbe = startReadinessProbe({ port, log });
	return child;
}

if (path.resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
	startServer();
	void reportImageSnapshotter();
}
