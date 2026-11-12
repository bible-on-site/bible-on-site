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
		if (url.includes("kernel.org")) throw new Error("connection timed out");
		return new Response(signedMetadata);
	});
	assert.equal(result, primary);
	assert.equal(calls.length, 8);
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
			if (url.startsWith(primary)) throw new Error("ENOTFOUND");
			return new Response(signedMetadata);
		}),
		"https://mirrors.kernel.org/ubuntu/",
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
		if (url.startsWith(primary)) {
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

test("all stalled probes share one five-second cap and leave the source file intact", async (t) => {
	const directory = await fixture(t);
	const file = join(directory, "apt-mirrors.txt");
	await writeFile(file, mirrors);
	let pending = 0;
	// Keep the test process alive; AbortSignal.timeout uses an unref'ed timer.
	const keepAlive = setInterval(() => {}, 100);
	t.after(() => clearInterval(keepAlive));
	await assert.rejects(
		configureUbuntuAptMirrors(file, {
			codename: "noble",
			fetchMetadata: async (_url, { signal }) => {
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
			},
		}),
		/within five seconds/,
	);
	assert.equal(pending, 0);
	assert.equal(await readFile(file, "utf8"), mirrors);
});
