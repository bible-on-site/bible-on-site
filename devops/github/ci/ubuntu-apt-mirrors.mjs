import { readFile, writeFile } from "node:fs/promises";
import https from "node:https";
import { resolve } from "node:path";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import { createGunzip } from "node:zlib";

const MIRROR_LIST = "/etc/apt/apt-mirrors.txt";
const ubuntuArchive = /^https?:\/\/[^/\s]+\/ubuntu\/?$/;
const candidates = [
	"https://archive.ubuntu.com/ubuntu/",
	"https://mirrors.kernel.org/ubuntu/",
	"https://azure.archive.ubuntu.com/ubuntu/",
	"https://mirror.its.umich.edu/ubuntu/",
	"https://security.ubuntu.com/ubuntu/",
];
const signedMetadataHeader = "-----BEGIN PGP SIGNED MESSAGE-----";
// A bounded slice of a package index is enough to reach the first Filename
// field, and a bounded slice of the package proves the pool path serves bytes.
const packageIndexCap = 256 * 1024;
const packageDownloadCap = 4 * 1024;
const redirectStatuses = new Set([301, 302, 303, 307, 308]);
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

const probeFailure = (message, probeReason) =>
	Object.assign(new Error(message), { probeReason });
// Candidates and file entries differ in scheme (the image lists the Azure
// archive over HTTP while the verified list uses HTTPS), so compare only
// the archive host and path.
const normalizeAddress = (url) =>
	url.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/+$/, "");
const candidateAddresses = new Set(candidates.map(normalizeAddress));
const address = (line) => line.trimStart().split(/\s+/)[0];
const ubuntuArchiveEntry = (line) => ubuntuArchive.test(address(line));

/**
 * Fill every Ubuntu archive slot with the verified mirrors in preference
 * order. Unprobed entries keep a lower-priority place; unverified candidate
 * slots are dropped so APT never waits on a dead fallback.
 */
export function preferUbuntuArchives(contents, mirrors) {
	const lines = contents.split(/(?<=\n)/);
	if (!lines.some(ubuntuArchiveEntry)) return contents;
	const preserved = lines
		.filter(ubuntuArchiveEntry)
		.map((line) => address(line))
		.filter((uri) => !candidateAddresses.has(normalizeAddress(uri)));
	const fills = [...mirrors, ...preserved];
	const out = [];
	let cursor = 0;
	for (const line of lines) {
		if (!ubuntuArchiveEntry(line)) {
			out.push(line);
			continue;
		}
		if (cursor >= fills.length) continue;
		// APT ranks a missing priority last, so every filled slot carries an
		// explicit priority matching the verified order; unrelated trailing
		// fields are preserved.
		const fill = fills[cursor];
		const eol = line.endsWith("\n") ? "\n" : "";
		const body = line.slice(0, line.length - eol.length);
		const tail = body
			.slice(body.indexOf(address(line)) + address(line).length)
			.replace(/\s*priority:\d+/, "");
		out.push(`${fill}\tpriority:${++cursor}${tail}${eol}`);
	}
	while (cursor < fills.length) {
		if (out.length && !out[out.length - 1].endsWith("\n"))
			out[out.length - 1] += "\n";
		out.push(`${fills[cursor]}\tpriority:${++cursor}\n`);
	}
	return out.join("");
}

/** Read at most `cap` bytes of a response, then release the stream. */
async function readSlice(response, cap) {
	const stream = response.body;
	if (!stream?.getReader) return new Uint8Array();
	const reader = stream.getReader();
	const chunks = [];
	let size = 0;
	try {
		while (size < cap) {
			const { done, value } = await reader.read();
			if (done) break;
			chunks.push(value);
			size += value.byteLength;
		}
	} finally {
		// Cancellation releases the socket; a body that errored mid-read may
		// reject here, which is already covered by the failed read.
		await reader.cancel().catch(() => {});
	}
	const data = new Uint8Array(Math.min(size, cap));
	let offset = 0;
	for (const chunk of chunks) {
		if (offset >= data.length) break;
		data.set(chunk.subarray(0, data.length - offset), offset);
		offset += chunk.byteLength;
	}
	return data;
}

/** Inflate a possibly truncated gzip slice; the decoded prefix is enough. */
async function inflatePrefix(compressed) {
	const gunzip = createGunzip();
	let text = "";
	gunzip.on("data", (chunk) => {
		text += chunk;
	});
	return new Promise((resolve) => {
		gunzip.on("end", () => resolve(text));
		gunzip.on("error", () => resolve(text));
		gunzip.write(compressed);
		gunzip.end();
	});
}

/** Pick the package index the signed release metadata lists. */
function packageIndexPath(metadata) {
	let gzip,
		plain;
	for (const match of metadata.matchAll(
		/^ +[0-9a-f]{32,128} +\d+ +(\S+)$/gim,
	)) {
		const path = match[1];
		if (path === "main/binary-amd64/Packages.gz")
			return { path, compressed: true };
		if (path.includes("debian-installer/")) continue;
		const index = /\/binary-[a-z0-9]+\/Packages(\.gz)?$/.exec(path);
		if (!index) continue;
		if (index[1] === ".gz" && !gzip) gzip = { path, compressed: true };
		else if (index[1] === undefined && !plain)
			plain = { path, compressed: false };
	}
	// Ubuntu archives list an uncompressed index in the release checksums but
	// only publish compressed payloads, so prefer gzip for the live fetch.
	return gzip ?? plain;
}

/** First `pool/` package the package index offers for download. */
function packageFilename(index) {
	const filename = index.match(/^Filename: +(\S+)\s*$/m)?.[1];
	return filename?.startsWith("pool/") ? filename : null;
}

// Use HTTPS over HTTP/1.1 for these short, cancellable probes. Node's built-in
// fetch can crash after an HTTP/2 socket idles (nodejs/undici#5936).
async function fetchMirror(url, options, redirects = 5) {
	const response = await new Promise((resolve, reject) => {
		https.get(url, { ...options, agent: false }, resolve).once("error", reject);
	});
	const { statusCode: status, headers } = response;
	if (redirectStatuses.has(status) && headers.location) {
		response.destroy();
		if (redirects === 0) throw new Error("Too many Ubuntu mirror redirects");
		return fetchMirror(new URL(headers.location, url), options, redirects - 1);
	}
	if (status < 200 || status >= 300 || status === 204 || status === 205) {
		response.destroy();
		return new Response(null, { status });
	}
	return new Response(Readable.toWeb(response), { status });
}

/** Probe every suite and a real package download before ranking a mirror. */
export async function selectUbuntuArchives(
	codename,
	fetchMetadata = fetchMirror,
) {
	if (typeof codename !== "string" || !/^[a-z][a-z0-9]*$/.test(codename)) {
		throw new Error("Cannot determine the runner's Ubuntu codename");
	}
	const started = performance.now();
	const signal = AbortSignal.timeout(5_000);
	const failures = [];
	const record = (url, phase, status, reason) =>
		failures.push({
			url,
			phase,
			status,
			reason,
			elapsedMs: Math.round(performance.now() - started),
		});
	const reasonOf = (error, phase) =>
		signal.aborted
			? signal.reason?.name === "TimeoutError"
				? "deadline"
				: "cancelled"
			: (error?.probeReason ??
				(phase === "http_status" || phase === "signature"
					? "invalid_metadata"
					: failureCodes(error)));
	const suites = [
		codename,
		`${codename}-updates`,
		`${codename}-backports`,
		`${codename}-security`,
	];
	const probes = candidates.map(async (mirror) => {
		const releases = new Map();
		const release = (suite) => {
			let pending = releases.get(suite);
			if (!pending) {
				pending = (async () => {
					let phase = "headers",
						status;
					const url = `${mirror}dists/${suite}/InRelease`;
					try {
						const response = await fetchMetadata(url, { signal });
						status = response.status;
						phase = "body";
						const metadata = await response.text();
						phase = response.ok ? "signature" : "http_status";
						if (
							!response.ok ||
							!metadata.startsWith(signedMetadataHeader)
						) {
							throw new Error("Invalid release metadata");
						}
						return metadata;
					} catch (error) {
						record(url, phase, status, reasonOf(error, phase));
						throw error;
					}
				})();
				releases.set(suite, pending);
			}
			return pending;
		};
		// Metadata alone cannot prove a mirror serves packages: signed indexes
		// may keep working while pool downloads stall. Resolve a package index
		// from the signed release, then fetch a slice of the package itself.
		const packageDownload = async () => {
			const metadata = await release(codename);
			let phase = "index",
				status,
				url = `${mirror}dists/${codename}/InRelease`;
			try {
				const indexPath = packageIndexPath(metadata);
				if (!indexPath)
					throw probeFailure(
						"Ubuntu release metadata lists no package index",
						"missing_index",
					);
				url = `${mirror}dists/${codename}/${indexPath.path}`;
				const response = await fetchMetadata(url, {
					signal,
					headers: { Range: `bytes=0-${packageIndexCap - 1}` },
				});
				status = response.status;
				if (!response.ok) {
					phase = "http_status";
					throw new Error("Package index unavailable");
				}
				phase = "index_body";
				const index = indexPath.compressed
					? await inflatePrefix(await readSlice(response, packageIndexCap))
					: new TextDecoder().decode(
							await readSlice(response, packageIndexCap),
						);
				const filename = packageFilename(index);
				phase = "pool";
				if (!filename)
					throw probeFailure(
						"Package index lists no downloadable package",
						"missing_package",
					);
				url = `${mirror}${filename}`;
				status = undefined;
				const download = await fetchMetadata(url, {
					signal,
					headers: { Range: `bytes=0-${packageDownloadCap - 1}` },
				});
				status = download.status;
				if (!download.ok) {
					phase = "http_status";
					throw new Error("Package download unavailable");
				}
				phase = "pool_body";
				const bytes = await readSlice(download, packageDownloadCap);
				if (bytes.length === 0)
					throw probeFailure(
						"Package download returned no bytes",
						"empty_download",
					);
			} catch (error) {
				record(url, phase, status, reasonOf(error, phase));
				throw error;
			}
		};
		const checks = suites.map((suite) => release(suite));
		checks.push(packageDownload());
		const results = await Promise.allSettled(checks);
		return results.every((result) => result.status === "fulfilled")
			? mirror
			: null;
	});
	// Every candidate feeds the fallback list, so join all of them inside the
	// same bounded window instead of returning after the preferred mirror.
	const results = await Promise.all(probes);
	const verified = candidates.filter((candidate, index) => results[index]);
	if (!verified.length) {
		throw new Error(
			"No Ubuntu mirror served signed release metadata and a package download within five seconds",
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
	return verified;
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
	if (!contents.split(/\r?\n/).some(ubuntuArchiveEntry)) return false;
	const osRelease = options.codename
		? null
		: await readFile("/etc/os-release", "utf8");
	const codename =
		options.codename ??
		osRelease.match(/^VERSION_CODENAME=["']?([a-z0-9]+)["']?$/m)?.[1];
	const mirrors = await selectUbuntuArchives(codename, options.fetchMetadata);
	const next = preferUbuntuArchives(contents, mirrors);
	if (next === contents) return false;
	await writeFile(file, next);
	console.log(`Runner APT mirrors verified: ${mirrors.join(", ")}`);
	return true;
}

if (
	process.argv[1] &&
	resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
	await configureUbuntuAptMirrors(process.argv[2]);
}
