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
} from "./ubuntu-apt-mirrors.mjs";

const mirrors =
	"http://azure.archive.ubuntu.com/ubuntu/\tpriority:1\n" +
	"https://archive.ubuntu.com/ubuntu/\tpriority:2\n" +
	"https://security.ubuntu.com/ubuntu/\tpriority:3\n";
const mirrored =
	"https://mirrors.kernel.org/ubuntu/\tpriority:1\n" +
	"https://archive.ubuntu.com/ubuntu/\tpriority:2\n" +
	"https://security.ubuntu.com/ubuntu/\tpriority:3\n";

test("uses an independent Ubuntu mirror while retaining every mirror priority", () => {
	assert.equal(preferUbuntuArchive(mirrors), mirrored);
	assert.equal(preferUbuntuArchive(mirrored), mirrored);
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
		),
		"  https://mirrors.kernel.org/ubuntu/ priority:1\r\n" +
			"https://mirrors.kernel.org/ubuntu/ priority:1\r\n" +
			untouched,
	);
});

test("preserves direct ports archives and empty mirror lists", () => {
	for (const contents of ["", "http://ports.ubuntu.com/ubuntu-ports/\n"]) {
		assert.equal(preferUbuntuArchive(contents), contents);
	}
});

test("keeps a sole Azure entry and upgrades HTTP delivery to HTTPS", () => {
	for (const uri of [
		"http://azure.archive.ubuntu.com/ubuntu",
		"https://azure.archive.ubuntu.com/ubuntu/",
	]) {
		assert.equal(
			preferUbuntuArchive(`${uri}\tpriority:1\n`),
			"https://mirrors.kernel.org/ubuntu/\tpriority:1\n",
		);
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
	assert.equal(await configureUbuntuAptMirrors(file), true);
	assert.equal(await readFile(file, "utf8"), mirrored);
	assert.equal((await stat(file)).mode, before.mode);
	const modified = (await stat(file)).mtimeMs;
	assert.equal(await configureUbuntuAptMirrors(file), false);
	assert.equal((await stat(file)).mtimeMs, modified);
	assert.equal(await readFile(sources, "utf8"), signedSources);
	assert.deepEqual(logs, [
		["Runner APT now prefers the kernel.org Ubuntu mirror"],
	]);
});

test("keeps package sources unchanged when the runner has no mirror file", async (t) => {
	const directory = await fixture(t);
	const warnings = [];
	t.mock.method(console, "warn", (...args) => warnings.push(args));
	const file = join(directory, "missing-mirrors.txt");
	assert.equal(await configureUbuntuAptMirrors(file), false);
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

test("configures the mirror list through the same CLI used by CI", async (t) => {
	const directory = await fixture(t);
	const file = join(directory, "apt-mirrors.txt");
	await writeFile(file, mirrors);
	const script = fileURLToPath(
		new URL("./ubuntu-apt-mirrors.mjs", import.meta.url),
	);
	const result = spawnSync(process.execPath, [script, file], {
		encoding: "utf8",
	});
	assert.equal(result.status, 0, result.stderr);
	assert.equal(result.stderr, "");
	assert.equal(
		result.stdout.trim(),
		"Runner APT now prefers the kernel.org Ubuntu mirror",
	);
	assert.equal(await readFile(file, "utf8"), mirrored);
});
