import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
	configureUbuntuAptMirrors,
	preferUbuntuArchive,
	selectUbuntuArchive,
} from "./ubuntu-apt-mirrors.mjs";

const mirrors =
	"http://azure.archive.ubuntu.com/ubuntu/\tpriority:1\n" +
	"https://archive.ubuntu.com/ubuntu/\tpriority:2\n" +
	"https://security.ubuntu.com/ubuntu/\tpriority:3\n";
const primary = "https://archive.ubuntu.com/ubuntu/";
const signedMetadata = "-----BEGIN PGP SIGNED MESSAGE-----\nHash: SHA512\n";
const options = {
	codename: "noble",
	fetchMetadata: async () => new Response(signedMetadata),
};
const mirrored =
	"https://archive.ubuntu.com/ubuntu/\tpriority:1\n" +
	"https://archive.ubuntu.com/ubuntu/\tpriority:2\n" +
	"https://security.ubuntu.com/ubuntu/\tpriority:3\n";

test("uses the verified primary while retaining every mirror priority", () => {
	assert.equal(preferUbuntuArchive(mirrors, primary), mirrored);
	assert.equal(preferUbuntuArchive(mirrored, primary), mirrored);
});

test("replaces only exact Azure URLs and preserves fallback URLs, comments and line endings", () => {
	const untouched =
		"# http://azure.archive.ubuntu.com/ubuntu/\r\n" +
		"https://azure.archive.ubuntu.com.example.org/ubuntu/ priority:4\r\n" +
		"https://archive.ubuntu.com/ubuntu/\tpriority:2\r\n";
	assert.equal(
		preferUbuntuArchive(
			"  http://azure.archive.ubuntu.com/ubuntu priority:1\r\n" +
				"https://azure.archive.ubuntu.com/ubuntu/ priority:1\r\n" +
				untouched,
			primary,
		),
		"  https://archive.ubuntu.com/ubuntu/ priority:1\r\n" +
			"https://archive.ubuntu.com/ubuntu/ priority:1\r\n" +
			untouched,
	);
});

test("preserves direct ports archives and empty mirror lists", () => {
	for (const contents of ["", "http://ports.ubuntu.com/ubuntu-ports/\n"]) {
		assert.equal(preferUbuntuArchive(contents, primary), contents);
	}
});

test("keeps a sole Azure entry and upgrades HTTP delivery to HTTPS", () => {
	for (const uri of [
		"http://azure.archive.ubuntu.com/ubuntu",
		"https://azure.archive.ubuntu.com/ubuntu/",
	]) {
		assert.equal(
			preferUbuntuArchive(`${uri}\tpriority:1\n`, primary),
			"https://archive.ubuntu.com/ubuntu/\tpriority:1\n",
		);
	}
});

test("repairs the previously selected kernel primary without touching lookalike hosts", () => {
	const contents =
		"https://mirrors.kernel.org/ubuntu/\tpriority:1\n" +
		"https://mirrors.kernel.org.example/ubuntu/\tpriority:2\n";
	assert.equal(
		preferUbuntuArchive(contents, primary),
		`${primary}\tpriority:1\nhttps://mirrors.kernel.org.example/ubuntu/\tpriority:2\n`,
	);
});

test("preserves an independent managed fallback and only replaces priority one", () => {
	const contents =
		"http://azure.archive.ubuntu.com/ubuntu/\tpriority:1\n" +
		"https://mirrors.kernel.org/ubuntu/\tpriority:2\n";
	assert.equal(
		preferUbuntuArchive(contents, primary),
		`${primary}\tpriority:1\nhttps://mirrors.kernel.org/ubuntu/\tpriority:2\n`,
	);
	for (const metadata of [
		"",
		"\tpriority:2",
		"\tpriority:10",
		"\tpriority:1x",
	]) {
		const fallback = `https://mirrors.kernel.org/ubuntu/${metadata}\n`;
		assert.equal(preferUbuntuArchive(fallback, primary), fallback);
	}
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

test("updates only the mirror file, preserves permissions and skips repeated writes", async (t) => {
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
	assert.equal(await configureUbuntuAptMirrors(file, options), true);
	assert.equal(await readFile(file, "utf8"), mirrored);
	assert.equal((await stat(file)).mode, before.mode);
	const modified = (await stat(file)).mtimeMs;
	assert.equal(await configureUbuntuAptMirrors(file, options), false);
	assert.equal((await stat(file)).mtimeMs, modified);
	assert.equal(await readFile(sources, "utf8"), signedSources);
	assert.deepEqual(logs, [
		["Runner APT primary verified: https://archive.ubuntu.com/ubuntu/"],
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

test("rejects a stalled kernel mirror and selects complete Ubuntu metadata", async () => {
	const calls = [];
	const result = await selectUbuntuArchive("noble", async (url, { signal }) => {
		calls.push({ url, signal });
		if (new URL(url).hostname === "mirrors.kernel.org")
			throw new Error("connection timed out");
		return new Response(signedMetadata);
	});
	assert.equal(result, primary);
	assert.equal(calls.length, 16);
	assert.equal(new Set(calls.map((call) => call.signal)).size, 1);
	assert.deepEqual(
		calls.slice(0, 4).map((call) => new URL(call.url).pathname),
		[
			"/ubuntu/dists/noble/InRelease",
			"/ubuntu/dists/noble-updates/InRelease",
			"/ubuntu/dists/noble-backports/InRelease",
			"/ubuntu/dists/noble-security/InRelease",
		],
	);
});

test("uses the independent fallback when Ubuntu DNS fails", async () => {
	assert.equal(
		await selectUbuntuArchive("noble", async (url) => {
			if (new URL(url).hostname === "archive.ubuntu.com")
				throw new Error("ENOTFOUND");
			return new Response(signedMetadata);
		}),
		"https://mirrors.kernel.org/ubuntu/",
	);
});

test("uses a verified fallback when archive metadata and the kernel mirror fail", async () => {
	const azure = "https://azure.archive.ubuntu.com/ubuntu/";
	const michigan = "https://mirror.its.umich.edu/ubuntu/";
	for (const expected of [azure, michigan]) {
		const mirror = await selectUbuntuArchive("resolute", async (url) => {
			const host = new URL(url).hostname;
			if (host === "archive.ubuntu.com" && url.includes("-backports/")) {
				throw Object.assign(new Error("Header timeout"), {
					code: "UND_ERR_HEADERS_TIMEOUT",
				});
			}
			if (
				host === "mirrors.kernel.org" ||
				(host === "azure.archive.ubuntu.com" && expected === michigan)
			) {
				throw Object.assign(new Error("Network unreachable"), {
					code: "ENETUNREACH",
				});
			}
			return new Response(signedMetadata);
		});
		assert.equal(mirror, expected);
	}
});

test("joins cancelled fallback probes as soon as the preferred mirror is complete", async () => {
	let active = 0,
		cancelled = 0,
		completed = false;
	const selection = selectUbuntuArchive("noble", async (url, { signal }) => {
		if (new URL(url).hostname === "archive.ubuntu.com")
			return new Response(signedMetadata);
		active++;
		try {
			await new Promise((_resolve, reject) =>
				signal.addEventListener(
					"abort",
					() => {
						cancelled++;
						reject(signal.reason);
					},
					{ once: true },
				),
			);
		} finally {
			active--;
		}
	}).then((result) => {
		completed = true;
		return result;
	});
	await new Promise((resolve) => setImmediate(resolve));
	const completedBeforeAnotherEventLoopTurn = completed;
	assert.equal(await selection, primary);
	assert.equal(completedBeforeAnotherEventLoopTurn, true);
	assert.equal(active, 0);
	assert.equal(cancelled, 12);
});

test("a faster healthy fallback does not change the preferred mirror", async () => {
	let finish;
	const pending = new Promise((resolve) => {
		finish = resolve;
	});
	let complete = false;
	const selection = selectUbuntuArchive("noble", async (url) => {
		if (new URL(url).hostname === "archive.ubuntu.com") await pending;
		return new Response(signedMetadata);
	}).then((result) => {
		complete = true;
		return result;
	});
	await new Promise((resolve) => setImmediate(resolve));
	assert.equal(complete, false);
	finish();
	assert.equal(await selection, primary);
});

test("failed selection exposes bounded request stages and network causes without remote bodies or raw errors", async () => {
	await assert.rejects(
		selectUbuntuArchive("noble", async (url) => {
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
			assert.equal(error.cause.errors.length, 16);
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
		async () => new Response("<html>sign in</html>"),
		async (url) =>
			url.includes("-security/")
				? new Response("missing", { status: 404 })
				: new Response(signedMetadata),
	]) {
		await writeFile(file, mirrors);
		await assert.rejects(
			configureUbuntuAptMirrors(file, { codename: "noble", fetchMetadata }),
			/No Ubuntu primary mirror/,
		);
		assert.equal(await readFile(file, "utf8"), mirrors);
	}
});

test("joins every parallel suite probe before choosing a fallback", async () => {
	let finish;
	const pending = new Promise((resolve) => {
		finish = resolve;
	});
	let completed = false;
	const selection = selectUbuntuArchive("noble", async (url) => {
		if (new URL(url).hostname === "archive.ubuntu.com") {
			if (url.includes("-updates/")) throw new Error("mirror incomplete");
			await pending;
		}
		return new Response(signedMetadata);
	}).then((result) => {
		completed = true;
		return result;
	});
	await new Promise((resolve) => setImmediate(resolve));
	assert.equal(completed, false);
	finish();
	assert.equal(await selection, "https://mirrors.kernel.org/ubuntu/");
});

test("rejects missing or malformed codenames before any network request", async () => {
	for (const codename of [undefined, "", "noble/../../", "noble\n"]) {
		await assert.rejects(
			selectUbuntuArchive(codename, () =>
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
					return { ok: true, status: 200, text: () => waitForDeadline(signal) };
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
		8,
	);
	assert.equal(
		details.filter((message) =>
			message.includes("phase=body http=200 reason=deadline"),
		).length,
		8,
	);
});
