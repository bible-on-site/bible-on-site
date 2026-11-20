import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import {
	configureUbuntuAptMirrors,
	preferUbuntuArchives,
	selectUbuntuArchives,
} from "./ubuntu-apt-mirrors.mjs";

const archive = "https://archive.ubuntu.com/ubuntu/";
const kernel = "https://mirrors.kernel.org/ubuntu/";
const azure = "https://azure.archive.ubuntu.com/ubuntu/";
const umich = "https://mirror.its.umich.edu/ubuntu/";
const security = "https://security.ubuntu.com/ubuntu/";
const mirrors =
	"http://azure.archive.ubuntu.com/ubuntu/\tpriority:1\n" +
	"https://archive.ubuntu.com/ubuntu/\tpriority:2\n" +
	"https://security.ubuntu.com/ubuntu/\tpriority:3\n";
// Mirrors list an uncompressed index in signed checksums but only serve the
// compressed payloads — the probe must select and fetch the gzip index.
const signedMetadata =
	"-----BEGIN PGP SIGNED MESSAGE-----\n" +
	"Hash: SHA512\n\n" +
	"SHA256:\n " +
	"0".repeat(64) +
	" 1234 main/binary-amd64/Packages\n" +
	" " +
	"1".repeat(64) +
	" 678 main/binary-amd64/Packages.gz\n" +
	" " +
	"2".repeat(64) +
	" 20 main/debian-installer/binary-amd64/Packages\n";
const packageIndex =
	"Package: example\n" +
	"Priority: optional\n" +
	"Filename: pool/main/e/example/example_1.0_amd64.deb\n";
const compressedIndex = gzipSync(packageIndex);
const healthyArchive = (url) => {
	if (url.endsWith("/InRelease")) return new Response(signedMetadata);
	if (url.endsWith("/binary-amd64/Packages.gz"))
		return new Response(compressedIndex);
	if (url.includes("/pool/")) return new Response("deb-bytes");
	return new Response("missing", { status: 404 });
};
const options = {
	codename: "noble",
	fetchMetadata: healthyArchive,
};

test("fills archive slots with the verified mirrors and drops unverified candidates", () => {
	assert.equal(
		preferUbuntuArchives(mirrors, [azure, umich]),
		`${azure}\tpriority:1\n${umich}\tpriority:2\n`,
	);
	assert.equal(
		preferUbuntuArchives(mirrors, [azure]),
		`${azure}\tpriority:1\n`,
	);
});

test("keeps preference order across more verified mirrors than image slots", () => {
	assert.equal(
		preferUbuntuArchives(mirrors, [archive, kernel, azure, umich, security]),
		`${archive}\tpriority:1\n` +
			`${kernel}\tpriority:2\n` +
			`${azure}\tpriority:3\n` +
			`${umich}\tpriority:4\n` +
			`${security}\tpriority:5\n`,
	);
});

test("preserves unprobed archive entries behind the verified mirrors", () => {
	const contents = `${mirrors}https://mirror.example.org/ubuntu/\tpriority:9\n`;
	assert.equal(
		preferUbuntuArchives(contents, [azure, umich]),
		`${azure}\tpriority:1\n` +
			`${umich}\tpriority:2\n` +
			`https://mirror.example.org/ubuntu/\tpriority:3\n`,
	);
});

test("preserves comments, ports archives and line endings", () => {
	const untouched =
		"# https://azure.archive.ubuntu.com/ubuntu/\r\n" +
		"http://ports.ubuntu.com/ubuntu-ports/\tpriority:2\r\n" +
		"\r\n";
	assert.equal(
		preferUbuntuArchives(
			`http://azure.archive.ubuntu.com/ubuntu/\tpriority:1\r\n${untouched}`,
			[azure],
		),
		`${azure}\tpriority:1\r\n${untouched}`,
	);
});

test("upgrades verified entries to HTTPS and gives every filled slot an explicit priority", () => {
	assert.equal(
		preferUbuntuArchives("http://azure.archive.ubuntu.com/ubuntu", [kernel]),
		`${kernel}\tpriority:1`,
	);
	// A missing priority ranks last for APT, so appended fallbacks would
	// otherwise outrank the preferred mirror on a bare slot.
	assert.equal(
		preferUbuntuArchives("http://azure.archive.ubuntu.com/ubuntu", [
			kernel,
			azure,
		]),
		`${kernel}\tpriority:1\n${azure}\tpriority:2\n`,
	);
	assert.equal(
		preferUbuntuArchives("http://ports.ubuntu.com/ubuntu-ports/", []),
		"http://ports.ubuntu.com/ubuntu-ports/",
	);
});

test("leaves an empty mirror list and a list without archive entries untouched", () => {
	for (const contents of ["", "http://ports.ubuntu.com/ubuntu-ports/\n"]) {
		assert.equal(preferUbuntuArchives(contents, [azure]), contents);
	}
});

test("is idempotent once the file already lists the verified mirrors", () => {
	const once = preferUbuntuArchives(mirrors, [azure, umich, security]);
	assert.equal(preferUbuntuArchives(once, [azure, umich, security]), once);
});

async function fixture(t) {
	const directory = await mkdtemp(join(tmpdir(), "ubuntu-apt-mirrors-"));
	t.after(async () => {
		const target = resolve(directory);
		assert.equal(dirname(target), resolve(tmpdir()));
		assert.ok(basename(target).startsWith("ubuntu-apt-mirrors-"));
		await rm(target, { recursive: true, force: true });
	});
	return directory;
}

test("writes every verified mirror, preserves permissions and skips repeated writes", async (t) => {
	const directory = await fixture(t);
	const file = join(directory, "apt-mirrors.txt");
	const sources = join(directory, "ubuntu.sources");
	const signedSources =
		"URIs: mirror+file:/etc/apt/apt-mirrors.txt\n" +
		"Suites: noble noble-updates noble-backports noble-security\n" +
		"Signed-By: /usr/share/keyrings/ubuntu-archive-keyring.gpg\n";
	await writeFile(file, mirrors, { mode: 0o644 });
	await writeFile(sources, signedSources);
	const before = await stat(file);
	const logs = [];
	t.mock.method(console, "log", (...args) => logs.push(args));
	const expected =
		`${archive}\tpriority:1\n` +
		`${kernel}\tpriority:2\n` +
		`${azure}\tpriority:3\n` +
		`${umich}\tpriority:4\n` +
		`${security}\tpriority:5\n`;
	assert.equal(await configureUbuntuAptMirrors(file, options), true);
	assert.equal(await readFile(file, "utf8"), expected);
	assert.equal((await stat(file)).mode, before.mode);
	const modified = (await stat(file)).mtimeMs;
	assert.equal(await configureUbuntuAptMirrors(file, options), false);
	assert.equal((await stat(file)).mtimeMs, modified);
	assert.equal(await readFile(sources, "utf8"), signedSources);
	assert.deepEqual(logs, [
		[
			`Runner APT mirrors verified: ${archive}, ${kernel}, ${azure}, ${umich}, ${security}`,
		],
	]);
});

test("keeps package sources unchanged when the runner has no mirror file", async (t) => {
	const directory = await fixture(t);
	const warnings = [];
	t.mock.method(console, "warn", (...args) => warnings.push(args));
	const file = join(directory, "missing-mirrors.txt");
	assert.equal(await configureUbuntuAptMirrors(file, options), false);
	await assert.rejects(readFile(file), { code: "ENOENT" });
	assert.deepEqual(warnings, [
		["Runner APT mirror list is absent; keeping existing package sources"],
	]);
});

test("reports unexpected read failures without replacing the mirror configuration", async (t) => {
	const directory = await fixture(t);
	const errors = [];
	t.mock.method(console, "error", (...args) => errors.push(args));
	await assert.rejects(configureUbuntuAptMirrors(directory));
	assert.deepEqual(errors, [["Failed to read runner APT mirror list"]]);
});

test("CLI preserves unrelated package sources without probing the network", async (t) => {
	const directory = await fixture(t);
	const file = join(directory, "apt-mirrors.txt");
	const contents = "http://ports.ubuntu.com/ubuntu-ports/\n";
	await writeFile(file, contents);
	const script = fileURLToPath(
		new URL("./ubuntu-apt-mirrors.mjs", import.meta.url),
	);
	const result = spawnSync(process.execPath, [script, file], {
		encoding: "utf8",
	});
	assert.equal(result.status, 0, result.stderr);
	assert.equal(result.stdout, "");
	assert.equal(result.stderr, "");
	assert.equal(await readFile(file, "utf8"), contents);
});

test("returns every verified mirror in preference order", async () => {
	const calls = [];
	const result = await selectUbuntuArchives("noble", async (url, { signal }) => {
		calls.push({ url, signal });
		if (new URL(url).hostname === "mirrors.kernel.org")
			throw new Error("connection timed out");
		return healthyArchive(url);
	});
	assert.deepEqual(result, [archive, azure, umich, security]);
	assert.equal(new Set(calls.map((call) => call.signal)).size, 1);
	const archiveCalls = calls
		.filter((call) => call.url.startsWith(archive))
		.map((call) => new URL(call.url).pathname);
	assert.deepEqual(archiveCalls.slice(0, 4), [
		"/ubuntu/dists/noble/InRelease",
		"/ubuntu/dists/noble-updates/InRelease",
		"/ubuntu/dists/noble-backports/InRelease",
		"/ubuntu/dists/noble-security/InRelease",
	]);
	assert.deepEqual(archiveCalls.slice(4), [
		"/ubuntu/dists/noble/main/binary-amd64/Packages.gz",
		"/ubuntu/pool/main/e/example/example_1.0_amd64.deb",
	]);
});

test("rejects a mirror whose signed metadata works while package downloads fail", async () => {
	const verified = await selectUbuntuArchives("noble", async (url) => {
		if (
			new URL(url).hostname === "archive.ubuntu.com" &&
			url.includes("/pool/")
		) {
			throw Object.assign(new Error("Network unreachable"), {
				code: "ENETUNREACH",
			});
		}
		return healthyArchive(url);
	});
	assert.deepEqual(verified, [kernel, azure, umich, security]);
});

test("rejects a mirror whose package index is unavailable or lists no pool package", async () => {
	for (const broken of [
		(url) =>
			url.endsWith("/binary-amd64/Packages.gz")
				? new Response("missing", { status: 404 })
				: healthyArchive(url),
		(url) =>
			url.endsWith("/binary-amd64/Packages.gz")
				? new Response(gzipSync("Package: example\nPriority: optional\n"))
				: healthyArchive(url),
		// Signed metadata with no package index entry at all.
		(url) =>
			url.endsWith("/InRelease")
				? new Response(
						signedMetadata.replace(/ +[0-9a-f]{64} +\d+ +\S+\n/g, ""),
					)
				: healthyArchive(url),
	]) {
		const verified = await selectUbuntuArchives("noble", async (url) =>
			new URL(url).hostname === "archive.ubuntu.com"
				? broken(url)
				: healthyArchive(url),
		);
		assert.deepEqual(verified, [kernel, azure, umich, security]);
	}
});

test("accepts a mirror that lists and serves only an uncompressed index", async () => {
	// Unrelated checksum entries precede the package index and must not be
	// mistaken for it.
	const uncompressedOnly =
		"-----BEGIN PGP SIGNED MESSAGE-----\nHash: SHA512\n\nSHA256:\n " +
		"9".repeat(64) +
		" 500 main/Contents-amd64.gz\n " +
		"0".repeat(64) +
		" 1234 main/binary-amd64/Packages\n";
	const verified = await selectUbuntuArchives("noble", async (url) => {
		if (new URL(url).hostname !== "archive.ubuntu.com")
			return healthyArchive(url);
		if (url.endsWith("/InRelease")) return new Response(uncompressedOnly);
		if (url.endsWith("/binary-amd64/Packages"))
			return new Response(packageIndex);
		return healthyArchive(url);
	});
	assert.equal(verified[0], archive);
});

test("drops a metadata-only mirror from the written fallback list", async (t) => {
	const directory = await fixture(t);
	const file = join(directory, "apt-mirrors.txt");
	await writeFile(file, mirrors);
	const fetchMetadata = async (url) => {
		if (
			new URL(url).hostname === "archive.ubuntu.com" &&
			url.includes("/pool/")
		) {
			throw Object.assign(new Error("connection reset"), {
				code: "ECONNRESET",
			});
		}
		return healthyArchive(url);
	};
	assert.equal(
		await configureUbuntuAptMirrors(file, { codename: "noble", fetchMetadata }),
		true,
	);
	assert.equal(
		await readFile(file, "utf8"),
		`${kernel}\tpriority:1\n` +
			`${azure}\tpriority:2\n` +
			`${umich}\tpriority:3\n` +
			`${security}\tpriority:4\n`,
	);
});

test("uses the independent fallback when Ubuntu DNS fails", async () => {
	const verified = await selectUbuntuArchives("noble", async (url) => {
		if (new URL(url).hostname === "archive.ubuntu.com")
			throw new Error("ENOTFOUND");
		return healthyArchive(url);
	});
	assert.deepEqual(verified, [kernel, azure, umich, security]);
});

test("uses a verified fallback when archive metadata and earlier candidates fail", async () => {
	let blocked = new Set();
	const verify = () =>
		selectUbuntuArchives("resolute", async (url) => {
			const host = new URL(url).hostname;
			if (host === "archive.ubuntu.com" && url.includes("-backports/")) {
				throw Object.assign(new Error("Header timeout"), {
					code: "UND_ERR_HEADERS_TIMEOUT",
				});
			}
			if (host === "mirrors.kernel.org" || blocked.has(host)) {
				throw Object.assign(new Error("Network unreachable"), {
					code: "ENETUNREACH",
				});
			}
			return healthyArchive(url);
		});
	assert.equal((await verify())[0], azure);
	blocked = new Set(["azure.archive.ubuntu.com"]);
	assert.equal((await verify())[0], umich);
	blocked = new Set(["azure.archive.ubuntu.com", "mirror.its.umich.edu"]);
	assert.deepEqual(await verify(), [security]);
});

test("orders the verified list by preference, not probe speed", async () => {
	let finish;
	const pending = new Promise((resolve) => {
		finish = resolve;
	});
	let complete = false;
	const selection = selectUbuntuArchives("noble", async (url) => {
		if (new URL(url).hostname === "archive.ubuntu.com") await pending;
		return healthyArchive(url);
	}).then((result) => {
		complete = true;
		return result;
	});
	await new Promise((resolve) => setImmediate(resolve));
	assert.equal(complete, false);
	finish();
	const verified = await selection;
	assert.equal(verified[0], archive);
	assert.deepEqual(verified, [archive, kernel, azure, umich, security]);
});

test("probes every candidate even after the preferred mirror completes", async () => {
	const hosts = new Set();
	await selectUbuntuArchives("noble", async (url) => {
		hosts.add(new URL(url).hostname);
		return healthyArchive(url);
	});
	assert.deepEqual([...hosts].sort(), [
		"archive.ubuntu.com",
		"azure.archive.ubuntu.com",
		"mirror.its.umich.edu",
		"mirrors.kernel.org",
		"security.ubuntu.com",
	]);
});

test("failed selection exposes bounded request stages and network causes without remote bodies or raw errors", async () => {
	await assert.rejects(
		selectUbuntuArchives("noble", async (url) => {
			if (new URL(url).hostname === "mirrors.kernel.org") {
				throw new TypeError("private request failure", {
					cause: new AggregateError([
						Object.assign(new Error("private DNS detail"), {
							code: "ENOTFOUND",
						}),
						Object.assign(new Error("private routing detail"), {
							code: "ENETUNREACH",
						}),
					]),
				});
			}
			if (url.includes("-updates/")) return new Response("private remote body");
			if (url.includes("-security/"))
				return {
					ok: true,
					status: 200,
					text: async () => {
						throw Object.assign(new Error("private body error"), {
							code: "ECONNRESET",
						});
					},
				};
			return new Response(signedMetadata, { status: 503 });
		}),
		(error) => {
			assert.match(error.message, /within five seconds/);
			assert(error.cause instanceof AggregateError);
			assert.equal(error.cause.errors.length, 20);
			const details = error.cause.errors
				.map((probe) => probe.message)
				.join("\n");
			assert.match(
				details,
				/noble-updates\/InRelease phase=signature http=200 reason=invalid_metadata elapsed=\d+ms/,
			);
			assert.match(
				details,
				/noble-security\/InRelease phase=body http=200 reason=ECONNRESET/,
			);
			assert.match(
				details,
				/phase=http_status http=503 reason=invalid_metadata/,
			);
			assert.match(
				details,
				/phase=headers http=none reason=ENOTFOUND,ENETUNREACH/,
			);
			assert(!details.includes("private"));
			return true;
		},
	);
});

test("rejects incomplete mirrors, HTTP errors, and captive HTML without rewriting sources", async (t) => {
	const directory = await fixture(t);
	const file = join(directory, "apt-mirrors.txt");
	for (const fetchMetadata of [
		async () => new Response(signedMetadata, { status: 503 }),
		async (url) =>
			url.endsWith("/InRelease")
				? new Response("<html>sign in</html>")
				: healthyArchive(url),
		async (url) =>
			url.includes("-security/")
				? new Response("missing", { status: 404 })
				: healthyArchive(url),
		// Usable metadata everywhere with no working package download path.
		async (url) =>
			url.includes("/pool/")
				? (() => {
						throw Object.assign(new Error("connection reset"), {
							code: "ECONNRESET",
						});
					})()
				: healthyArchive(url),
	]) {
		await writeFile(file, mirrors);
		await assert.rejects(
			configureUbuntuAptMirrors(file, { codename: "noble", fetchMetadata }),
			/No Ubuntu mirror/,
		);
		assert.equal(await readFile(file, "utf8"), mirrors);
	}
});

test("rejects missing or malformed codenames before any network request", async () => {
	for (const codename of [undefined, "", "noble/../../", "noble\n"]) {
		await assert.rejects(
			selectUbuntuArchives(codename, () =>
				assert.fail("unexpected network request"),
			),
			/codename/,
		);
	}
});

test("stalled headers and bodies share one five-second cap and leave the source file intact", async (t) => {
	const directory = await fixture(t);
	const file = join(directory, "apt-mirrors.txt");
	await writeFile(file, mirrors);
	let pending = 0;
	let failure;
	const waitForDeadline = async (signal) => {
		pending++;
		try {
			await new Promise((_resolve, reject) =>
				signal.addEventListener("abort", () => reject(signal.reason), {
					once: true,
				}),
			);
		} finally {
			pending--;
		}
	};
	// Keep the test process alive; AbortSignal.timeout uses an unref'ed timer.
	const keepAlive = setInterval(() => {}, 100);
	t.after(() => clearInterval(keepAlive));
	await assert.rejects(
		configureUbuntuAptMirrors(file, {
			codename: "noble",
			fetchMetadata: async (url, { signal }) => {
				if (url.includes("-updates/") || url.includes("-security/"))
					return {
						ok: true,
						status: 200,
						text: () => waitForDeadline(signal),
					};
				await waitForDeadline(signal);
			},
		}),
		(error) => {
			failure = error;
			return /within five seconds/.test(error.message);
		},
	);
	assert.equal(pending, 0);
	assert.equal(await readFile(file, "utf8"), mirrors);
	const details = failure.cause.errors.map((error) => error.message);
	assert.equal(
		details.filter((message) =>
			message.includes("phase=headers http=none reason=deadline"),
		).length,
		10,
	);
	assert.equal(
		details.filter((message) =>
			message.includes("phase=body http=200 reason=deadline"),
		).length,
		10,
	);
});
