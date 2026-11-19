import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const MIRROR_LIST = "/etc/apt/apt-mirrors.txt";
const managedArchive =
	/^https?:\/\/(?:azure\.archive\.ubuntu\.com|mirrors\.kernel\.org)\/ubuntu\/?$/;
const candidates = [
	"https://archive.ubuntu.com/ubuntu/",
	"https://mirrors.kernel.org/ubuntu/",
	"https://azure.archive.ubuntu.com/ubuntu/",
	"https://mirror.its.umich.edu/ubuntu/",
];
const networkCodes = new Set([
	"ENOTFOUND",
	"EAI_AGAIN",
	"ETIMEDOUT",
	"ECONNRESET",
	"ECONNREFUSED",
	"ENETUNREACH",
	"EHOSTUNREACH",
	"UND_ERR_CONNECT_TIMEOUT",
	"UND_ERR_HEADERS_TIMEOUT",
	"UND_ERR_BODY_TIMEOUT",
	"CERT_HAS_EXPIRED",
	"DEPTH_ZERO_SELF_SIGNED_CERT",
	"UNABLE_TO_VERIFY_LEAF_SIGNATURE",
	"ERR_TLS_CERT_ALTNAME_INVALID",
]);

function failureCodes(error) {
	const codes = new Set();
	const pending = [error];
	for (let index = 0; index < pending.length && index < 12; index++) {
		const current = pending[index];
		if (!current || typeof current !== "object") continue;
		if (networkCodes.has(current.code)) codes.add(current.code);
		if (current.cause) pending.push(current.cause);
		if (Array.isArray(current.errors))
			pending.push(...current.errors.slice(0, 8));
	}
	return [...codes].join(",") || "request_failed";
}
const address = (line) => line.trimStart().split(/\s+/)[0];
const managedPrimary = (line) =>
	managedArchive.test(address(line)) &&
	line.trim().split(/\s+/).slice(1).includes("priority:1");

/** Preserve signed APT sources and fallback priorities; replace only our primary. */
export function preferUbuntuArchive(contents, mirror) {
	return contents
		.split(/(?<=\n)/)
		.map((line) => {
			const uri = address(line);
			return managedPrimary(line) ? line.replace(uri, mirror) : line;
		})
		.join("");
}

/** Probe every suite once in parallel before committing a primary mirror. */
export async function selectUbuntuArchive(codename, fetchMetadata = fetch) {
	if (typeof codename !== "string" || !/^[a-z][a-z0-9]*$/.test(codename)) {
		throw new Error("Cannot determine the runner's Ubuntu codename");
	}
	const started = performance.now();
	const unused = new AbortController();
	const signal = AbortSignal.any([AbortSignal.timeout(5_000), unused.signal]);
	const failures = [];
	const probes = candidates.map(async (mirror) => {
		const suites = [
			codename,
			`${codename}-updates`,
			`${codename}-backports`,
			`${codename}-security`,
		];
		const results = await Promise.allSettled(
			suites.map(async (suite) => {
				let phase = "headers",
					status;
				try {
					const response = await fetchMetadata(
						`${mirror}dists/${suite}/InRelease`,
						{ signal },
					);
					status = response.status;
					phase = "body";
					const metadata = await response.text();
					phase = response.ok ? "signature" : "http_status";
					if (
						!response.ok ||
						!metadata.startsWith("-----BEGIN PGP SIGNED MESSAGE-----")
					) {
						throw new Error("Invalid release metadata");
					}
				} catch (error) {
					const reason = signal.aborted
						? signal.reason?.name === "TimeoutError"
							? "deadline"
							: "cancelled"
						: phase === "http_status" || phase === "signature"
							? "invalid_metadata"
							: failureCodes(error);
					failures.push({
						url: `${mirror}dists/${suite}/InRelease`,
						phase,
						status,
						reason,
						elapsedMs: Math.round(performance.now() - started),
					});
					throw error;
				}
			}),
		);
		return results.every((result) => result.status === "fulfilled")
			? mirror
			: null;
	});
	// Preserve preference order, but do not spend the rest of the deadline on
	// an unused fallback after the preferred mirror has fully passed. Join the
	// cancelled probes so no request remains active when configuration changes.
	let mirror;
	for (const probe of probes) {
		mirror = await probe;
		if (mirror) {
			unused.abort();
			await Promise.all(probes);
			break;
		}
	}
	if (!mirror) {
		throw new Error(
			"No Ubuntu primary mirror served all signed release metadata within five seconds",
			{
				cause: new AggregateError(
					failures
						.sort((a, b) => a.url.localeCompare(b.url))
						.map(
							(failure) =>
								new Error(
									`${failure.url} phase=${failure.phase} http=${failure.status ?? "none"} reason=${failure.reason} elapsed=${failure.elapsedMs}ms`,
								),
						),
					"Ubuntu release metadata probe failures",
				),
			},
		);
	}
	return mirror;
}

export async function configureUbuntuAptMirrors(
	file = MIRROR_LIST,
	options = {},
) {
	let contents;
	try {
		contents = await readFile(file, "utf8");
	} catch (error) {
		if (error.code !== "ENOENT") {
			console.error("Failed to read runner APT mirror list");
			throw error;
		}
		console.warn(
			"Runner APT mirror list is absent; keeping existing package sources",
		);
		return false;
	}
	if (!contents.split(/\r?\n/).some(managedPrimary)) return false;
	const osRelease = options.codename
		? null
		: await readFile("/etc/os-release", "utf8");
	const codename =
		options.codename ??
		osRelease.match(/^VERSION_CODENAME=["']?([a-z0-9]+)["']?$/m)?.[1];
	const mirror = await selectUbuntuArchive(codename, options.fetchMetadata);
	const next = preferUbuntuArchive(contents, mirror);
	if (next === contents) return false;
	await writeFile(file, next);
	console.log(`Runner APT primary verified: ${mirror}`);
	return true;
}

if (
	process.argv[1] &&
	resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
	await configureUbuntuAptMirrors(process.argv[2]);
}
