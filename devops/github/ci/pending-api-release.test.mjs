import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import {
	apiTagVersion,
	compareVersions,
	latestPublishedApiRelease,
	main,
	normalizeApiCargo,
	pendingApiRelease,
	publishedReleaseCommit,
} from "./pending-api-release.mjs";

const baselineSha = "a".repeat(40);
const headSha = "b".repeat(40);
const repo = "test/repo";
const tag = "api-v0.1.93";
const published = (name = tag) => ({
	tag_name: name,
	draft: false,
	prerelease: false,
	published_at: "2026-10-28T00:00:00Z",
});
const manifest = (version) =>
	`[package]\nname = "bible-on-site-api"\nversion = "${version}" # own version\n\n[dependencies]\nsea-orm = "2.0"\n`;
const lock = (version) =>
	`version = 4\n\n[[package]]\nname = "bible-on-site-api"\nversion = "${version}"\ndependencies = ["sea-orm"]\n\n[[package]]\nname = "bible-on-site-api"\nversion = "0.1.93"\nsource = "registry+https://example.invalid/index"\n\n[[package]]\nname = "sea-orm"\nversion = "2.0.0"\nsource = "registry+https://example.invalid/index"\n`;
const files = (version) =>
	new Map([
		["web/api/Cargo.toml", manifest(version)],
		["web/api/Cargo.lock", lock(version)],
		["web/api/src/main.rs", "fn main() {}\n"],
		["web/api/entities/src/article.rs", "pub struct Article;\n"],
		["web/api/Dockerfile", "FROM scratch\n"],
	]);

function fixture({
	before = files("0.1.93"),
	after = files("0.1.94"),
	beforeModes = {},
	afterModes = {},
	release = published(),
} = {}) {
	const calls = [];
	const request = (endpoint) => {
		if (endpoint.endsWith("/releases?per_page=100&page=1")) return [release];
		if (endpoint.endsWith(`/git/ref/tags/${tag}`))
			return {
				ref: `refs/tags/${tag}`,
				object: { type: "commit", sha: baselineSha },
			};
		throw new Error(`Unexpected API request: ${endpoint}`);
	};
	const git = (args) => {
		calls.push(args);
		if (args[0] === "fetch") return "";
		if (args[0] === "rev-parse")
			return args[1] === "HEAD" ? headSha : baselineSha;
		const beforeRef =
			args[args[0] === "ls-tree" ? 3 : 1].startsWith(baselineSha);
		const source = beforeRef ? before : after;
		if (args[0] === "show") return source.get(args[1].slice(41));
		if (args[0] === "ls-tree") {
			const modes = beforeRef ? beforeModes : afterModes;
			return [...source]
				.map(
					([file, content]) =>
						`${modes[file] ?? "100644"} blob ${createHash("sha1").update(content).digest("hex")}\t${file}\0`,
				)
				.join("");
		}
		throw new Error(`Unexpected Git operation: ${args}`);
	};
	return { repo, headSha, request, git, calls };
}

test("published baseline selection paginates and excludes drafts, prereleases and noncanonical tags", () => {
	const calls = [];
	const latest = latestPublishedApiRelease(repo, (endpoint) => {
		calls.push(endpoint);
		if (endpoint.endsWith("page=1"))
			return [
				{ ...published("api-v10.0.0"), draft: true },
				{ ...published("api-v9.0.0"), prerelease: true },
				published("api-v01.0.0"),
				published("api-v8.0.0-canary"),
				...Array.from({ length: 96 }, () => published("app-v100.0.0")),
			];
		return [
			published("api-v0.1.99"),
			published("api-v0.2.0"),
			published("api-v0.1.93"),
		];
	});
	assert.equal(latest.tag_name, "api-v0.2.0");
	assert.equal(calls.length, 2);
	for (const invalid of [
		"api-v1.0",
		"api-v1.00.0",
		"api-v1.0.0+build",
		"v1.0.0",
		"api-v1.0.0-cache",
	])
		assert.equal(apiTagVersion(invalid), undefined);
});

test("release metadata and lookup failures never fall back to local tags", () => {
	for (const error of [new Error("HTTP 403"), new Error("connection reset")]) {
		let calls = 0;
		assert.throws(
			() =>
				latestPublishedApiRelease(repo, () => {
					calls++;
					throw error;
				}),
			error,
		);
		assert.equal(calls, 1);
	}
	assert.throws(
		() => latestPublishedApiRelease(repo, () => ({ message: "forbidden" })),
		/Invalid release listing/,
	);
	assert.throws(
		() => latestPublishedApiRelease(repo, () => []),
		/No published canonical/,
	);
	assert.throws(
		() =>
			latestPublishedApiRelease(repo, () => [
				{ ...published(), draft: undefined },
			]),
		/publication state/,
	);
	assert.throws(
		() =>
			latestPublishedApiRelease(repo, () => [
				{ ...published(), published_at: null },
			]),
		/publication time/,
	);
});

test("published annotated tags are pinned and delivery metadata must match the tag commit", () => {
	const annotatedSha = "c".repeat(40);
	const release = {
		...published(),
		target_commitish: "master",
		body: `<!-- release-delivery:${JSON.stringify({ module_name: "api", module_version: "0.1.93", ref: baselineSha, ci_run_id: "10", ci_run_attempt: "1" })} -->`,
	};
	const request = (endpoint) =>
		endpoint.includes("/git/ref/")
			? { ref: `refs/tags/${tag}`, object: { type: "tag", sha: annotatedSha } }
			: { object: { type: "commit", sha: baselineSha } };
	assert.equal(publishedReleaseCommit(repo, release, request), baselineSha);
	assert.throws(
		() =>
			publishedReleaseCommit(
				repo,
				{ ...release, body: release.body.replace(baselineSha, headSha) },
				request,
			),
		/delivery source differs/,
	);
	assert.throws(
		() =>
			publishedReleaseCommit(repo, release, () => ({
				ref: `refs/tags/${tag}`,
				object: { type: "tag", sha: annotatedSha },
			})),
		/annotated API tag chain|does not resolve/,
	);
	assert.throws(
		() =>
			publishedReleaseCommit(repo, release, () => ({
				ref: "refs/heads/master",
			})),
		/another ref/,
	);
});

test("normalization masks only package.version and its unique source-less Cargo.lock entry", () => {
	const before = normalizeApiCargo(manifest("0.1.93"), lock("0.1.93"));
	const after = normalizeApiCargo(manifest("0.1.94"), lock("0.1.94"));
	assert.equal(before.manifest, after.manifest);
	assert.equal(before.lock, after.lock);
	assert.match(after.lock, /version = "0.1.93"\nsource = "registry/);
	assert.match(after.manifest, /sea-orm = "2.0"/);
	const changedDependency = lock("0.1.94").replace(
		'version = "2.0.0"',
		'version = "2.0.1"',
	);
	assert.notEqual(
		normalizeApiCargo(manifest("0.1.94"), changedDependency).lock,
		before.lock,
	);
	assert.throws(
		() => normalizeApiCargo(manifest("0.1.94"), lock("0.1.93")),
		/manifest and own lock version differ/,
	);
	assert.throws(
		() =>
			normalizeApiCargo(
				manifest("0.1.94"),
				`${lock("0.1.94")}\n[[package]]\nname = "bible-on-site-api"\nversion = "0.1.94"\n`,
			),
		/one source-less/,
	);
	assert.throws(
		() =>
			normalizeApiCargo(
				manifest("0.1.94").replace("[package]", "[workspace]"),
				lock("0.1.94"),
			),
		/one Cargo \[package\]/,
	);
});

test("a version-only autobump or CI-only followup does not select an API release", () => {
	const input = fixture();
	const result = pendingApiRelease(input);
	assert.equal(result.pending, false);
	assert.deepEqual(result.changedFiles, []);
	assert.equal(result.baselineTag, tag);
	assert.equal(result.baselineSha, baselineSha);
	assert.deepEqual(
		input.calls.find((args) => args[0] === "fetch"),
		["fetch", "--no-tags", "--depth=1", "origin", baselineSha],
	);
});

for (const [name, change] of [
	[
		"API source",
		(after) =>
			after.set("web/api/src/main.rs", 'fn main() { println!("new"); }\n'),
	],
	[
		"entity",
		(after) =>
			after.set(
				"web/api/entities/src/article.rs",
				"pub struct Article { pub id: i32 }\n",
			),
	],
	["Dockerfile", (after) => after.set("web/api/Dockerfile", "FROM alpine\n")],
	[
		"dependency lock",
		(after) =>
			after.set(
				"web/api/Cargo.lock",
				lock("0.1.94").replace('version = "2.0.0"', 'version = "2.0.1"'),
			),
	],
	[
		"addition",
		(after) => after.set("web/api/src/new.rs", "pub const NEW: bool = true;\n"),
	],
	["deletion", (after) => after.delete("web/api/src/main.rs")],
]) {
	test(`unreleased ${name} changes survive own-version normalization`, () => {
		const after = files("0.1.94");
		change(after);
		const result = pendingApiRelease(fixture({ after }));
		assert.equal(result.pending, true);
		assert.equal(result.changedFiles.length, 1);
	});
}

test("Git executable mode changes remain production differences", () => {
	const result = pendingApiRelease(
		fixture({ afterModes: { "web/api/Dockerfile": "100755" } }),
	);
	assert.equal(result.pending, true);
	assert.deepEqual(result.changedFiles, ["web/api/Dockerfile"]);
});

test("stale version, checkout mismatch and fetch errors fail closed", () => {
	const after = files("0.1.93");
	after.set("web/api/src/main.rs", "fn main() { panic!(); }\n");
	assert.throws(() => pendingApiRelease(fixture({ after })), /version newer/);
	const wrongHead = fixture();
	assert.throws(
		() => pendingApiRelease({ ...wrongHead, headSha: "d".repeat(40) }),
		/Checkout differs/,
	);
	const input = fixture();
	assert.throws(
		() =>
			pendingApiRelease({
				...input,
				git: (args) => {
					if (args[0] === "fetch") throw new Error("fetch denied");
					return input.git(args);
				},
			}),
		/fetch denied/,
	);
});

test("CLI skips non-master events and writes the exact workflow output contract", (t) => {
	const temp = mkdtempSync(path.join(os.tmpdir(), "pending-api-output-"));
	t.after(() => rmSync(temp, { recursive: true, force: true }));
	const output = path.join(temp, "output");
	const result = main(
		{
			GITHUB_EVENT_NAME: "workflow_dispatch",
			GITHUB_REF: "refs/heads/master",
			GITHUB_OUTPUT: output,
		},
		{
			request: () => {
				throw new Error("must not request");
			},
		},
	);
	assert.equal(result.pending, false);
	assert.match(
		readFileSync(output, "utf8"),
		/^api_release_pending=false\napi_release_baseline_tag=\napi_release_baseline_sha=\napi_release_reason=not a master push\n$/,
	);
	const failedOutput = path.join(temp, "failed-output");
	assert.throws(
		() =>
			main(
				{
					GITHUB_EVENT_NAME: "push",
					GITHUB_REF: "refs/heads/master",
					GITHUB_REPOSITORY: repo,
					GITHUB_SHA: headSha,
					GITHUB_OUTPUT: failedOutput,
				},
				{
					...fixture(),
					request: () => {
						throw new Error("HTTP 403");
					},
				},
			),
		/HTTP 403/,
	);
	assert.equal(existsSync(failedOutput), false);
});

test("real shallow checkout compares the pinned published commit without editing tracked files", (t) => {
	const temp = mkdtempSync(path.join(os.tmpdir(), "pending-api-git-"));
	t.after(() => rmSync(temp, { recursive: true, force: true }));
	const remote = path.join(temp, "origin"),
		checkout = path.join(temp, "checkout");
	mkdirSync(remote);
	const gitAt = (cwd, args) =>
		execFileSync("git", args, {
			cwd,
			encoding: "utf8",
			stdio: ["ignore", "pipe", "pipe"],
		});
	gitAt(remote, ["init"]);
	gitAt(remote, ["config", "user.name", "Test"]);
	gitAt(remote, ["config", "user.email", "test@example.invalid"]);
	const writeFiles = (entries) => {
		for (const [file, content] of entries) {
			const target = path.join(remote, file);
			mkdirSync(path.dirname(target), { recursive: true });
			writeFileSync(target, content);
		}
	};
	writeFiles(files("0.1.93"));
	gitAt(remote, ["add", "."]);
	gitAt(remote, ["commit", "-m", "published API"]);
	const base = gitAt(remote, ["rev-parse", "HEAD"]).trim();
	gitAt(remote, ["tag", tag]);
	const changed = files("0.1.94");
	changed.set("web/api/src/main.rs", 'fn main() { println!("fixed"); }\n');
	writeFiles(changed);
	gitAt(remote, ["add", "."]);
	gitAt(remote, ["commit", "-m", "pending API"]);
	const head = gitAt(remote, ["rev-parse", "HEAD"]).trim();
	gitAt(temp, ["clone", "--depth=1", pathToFileURL(remote).href, checkout]);
	assert.equal(
		gitAt(checkout, ["rev-parse", "--is-shallow-repository"]).trim(),
		"true",
	);
	const result = pendingApiRelease({
		repo,
		headSha: head,
		git: (args) => gitAt(checkout, args),
		request: (endpoint) =>
			endpoint.includes("/releases?")
				? [published()]
				: { ref: `refs/tags/${tag}`, object: { type: "commit", sha: base } },
	});
	assert.equal(result.pending, true);
	assert.equal(result.baselineSha, base);
	assert.deepEqual(result.changedFiles, ["web/api/src/main.rs"]);
	assert.equal(gitAt(checkout, ["status", "--porcelain"]), "");
});

test("canonical version parsing and lexical numeric ordering handle long hostile inputs", () => {
	const versions = [
		"0.0.0",
		"0.0.9",
		"0.0.10",
		"0.1.0",
		"1.0.0",
		"9.999.1",
		"10.0.0",
	];
	for (let index = 0; index < versions.length; index++) {
		assert.equal(apiTagVersion(`api-v${versions[index]}`), versions[index]);
		assert.equal(compareVersions(versions[index], versions[index]), 0);
		if (index)
			assert.equal(compareVersions(versions[index - 1], versions[index]), -1);
	}
	const long = "9".repeat(200_000);
	const larger = `1${"0".repeat(200_000)}`;
	assert.equal(apiTagVersion(`api-v${long}.0.0`), `${long}.0.0`);
	assert.equal(compareVersions(`${long}.0.0`, `${larger}.0.0`), -1);
	assert.equal(compareVersions(`${long}.0.0`, `8${long.slice(1)}.0.0`), 1);
	for (const invalid of [
		`${long}x.0.0`,
		`${long}.0.0x`,
		`${"0".repeat(200_000)}.0.0`,
		".".repeat(200_000),
		"1.2.3.4",
		"1.02.3",
		"1.2.-3",
		"1.2.3\n",
	]) {
		assert.equal(apiTagVersion(`api-v${invalid}`), undefined);
		assert.throws(
			() => compareVersions(invalid, "1.2.3"),
			/canonical API versions/,
		);
	}
});

test("Cargo header comments, tabs and CRLF retain exact source bytes", () => {
	const withComments = (text, header) =>
		text
			.replaceAll(
				header,
				`${header}\t # comment with [package] and [[package]]`,
			)
			.replaceAll("\n", "\r\n");
	const beforeManifest = withComments(manifest("0.1.93"), "[package]");
	const beforeLock = withComments(lock("0.1.93"), "[[package]]");
	const before = normalizeApiCargo(beforeManifest, beforeLock);
	const after = normalizeApiCargo(
		withComments(manifest("0.1.94"), "[package]"),
		withComments(lock("0.1.94"), "[[package]]"),
	);
	assert.equal(before.manifest, after.manifest);
	assert.equal(before.lock, after.lock);
	assert.equal(
		before.manifest,
		beforeManifest.replace(
			'version = "0.1.93" # own version',
			'version = "<api-version>" # own version',
		),
	);
	assert.equal(
		before.lock,
		beforeLock.replace('version = "0.1.93"', 'version = "<api-version>"'),
	);
	assert.equal(
		normalizeApiCargo(
			manifest("0.1.93").replace("[package]", "[package]#compact comment"),
			lock("0.1.93"),
		).version,
		"0.1.93",
	);
	for (const invalid of [" [package]", "[package]bad", "[package]\f"]) {
		assert.throws(
			() =>
				normalizeApiCargo(
					manifest("0.1.93").replace("[package]", invalid),
					lock("0.1.93"),
				),
			/one Cargo \[package\]/,
		);
	}
});

test("Cargo header scanning handles long comments, indentation and near-matches linearly", () => {
	const comment = `[package]${" \t".repeat(100_000)}#${"[package]".repeat(25_000)}`;
	const decorate = (version) =>
		manifest(version)
			.replace("[package]", comment)
			.replace("[dependencies]", `${" \t".repeat(100_000)}[dependencies]`);
	const before = normalizeApiCargo(decorate("0.1.93"), lock("0.1.93"));
	const after = normalizeApiCargo(decorate("0.1.94"), lock("0.1.94"));
	assert.equal(before.manifest, after.manifest);
	assert.equal(before.lock, after.lock);
	assert.throws(
		() =>
			normalizeApiCargo(
				manifest("0.1.93").replace(
					"[package]",
					`[package]${" \t".repeat(100_000)}!`,
				),
				lock("0.1.93"),
			),
		/one Cargo \[package\]/,
	);
});
