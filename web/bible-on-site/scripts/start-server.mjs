import { spawn } from "node:child_process";
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

/** Keep accepting requests while Cloud Map removal reaches cached DNS answers. */
export function startServer({ drainMs = 90_000, cwd = process.cwd() } = {}) {
	if (!Number.isSafeInteger(drainMs) || drainMs < 0 || drainMs > 90_000)
		throw new RangeError(
			"Website drain must be between 0 and 90000 milliseconds",
		);
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
		console.log(`Website draining cached DNS requests for ${drainMs}ms`);
		drainTimer = setTimeout(() => forward("SIGTERM"), drainMs);
	};
	const interrupt = () => forward("SIGINT");
	const cleanup = () => {
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
	return child;
}

if (path.resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
	startServer();
	void reportImageSnapshotter();
}
