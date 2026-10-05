import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { publishVersionBumps } from "./bump-module-versions.ts";

function fixture(t: { after: (fn: () => void) => void }) {
	const root = mkdtempSync(join(tmpdir(), "version-publish-"));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	const remote = join(root, "remote.git");
	const a = join(root, "a");
	const b = join(root, "b");
	const git = (cwd: string, ...args: string[]) =>
		execFileSync("git", args, {
			cwd,
			encoding: "utf8",
			stdio: ["ignore", "pipe", "pipe"],
		}).trim();
	git(root, "init", "--bare", remote);
	git(root, "init", "-b", "master", a);
	const configure = (cwd: string) => {
		git(cwd, "config", "user.name", "Test");
		git(cwd, "config", "user.email", "test@example.invalid");
		git(cwd, "config", "core.autocrlf", "false");
	};
	configure(a);
	const setVersion = (cwd: string, version: string) => {
		mkdirSync(join(cwd, "web/bible-on-site"), { recursive: true });
		writeFileSync(
			join(cwd, "web/bible-on-site/package.json"),
			JSON.stringify({ name: "website", version }),
		);
		writeFileSync(
			join(cwd, "web/bible-on-site/package-lock.json"),
			JSON.stringify({ version, packages: { "": { version } } }),
		);
	};
	setVersion(a, "1.0.0");
	git(a, "add", ".");
	git(a, "commit", "-m", "source");
	git(a, "remote", "add", "origin", remote);
	git(a, "tag", "website-v1.0.0");
	git(a, "push", "--tags", "origin", "master");
	git(root, "clone", remote, b);
	configure(b);
	return { a, b, git, setVersion };
}

const released = {
	release_website: { result: "success", outputs: { released: "true" } },
};
const retry = {
	release_website: { result: "success", outputs: { needs_bump: "true" } },
};

test("a competing release bump is recomputed and not overwritten", (t) => {
	const { a, b, git, setVersion } = fixture(t);
	let attempts = 0;
	publishVersionBumps(released, "released", a, undefined, () => {
		attempts++;
		setVersion(b, "1.0.2");
		writeFileSync(join(b, "content.txt"), "new merged content");
		git(b, "add", ".");
		git(b, "commit", "-m", "competing merge and newer version");
		git(b, "push", "origin", "master");
	});
	assert.equal(attempts, 1);
	assert.equal(
		JSON.parse(readFileSync(join(a, "web/bible-on-site/package.json"), "utf8"))
			.version,
		"1.0.2",
	);
	assert.equal(
		readFileSync(join(a, "content.txt"), "utf8"),
		"new merged content",
	);
	assert.equal(git(a, "status", "--porcelain"), "");
});

test("a retry refreshes master and tags after a rejected push", (t) => {
	const { a, b, git, setVersion } = fixture(t);
	writeFileSync(join(a, "feature.txt"), "unreleased feature");
	git(a, "add", ".");
	git(a, "commit", "-m", "new feature");
	git(a, "push", "origin", "master");
	const source = git(a, "rev-parse", "HEAD");
	publishVersionBumps(retry, "retry", a, source, (attempt) => {
		if (attempt !== 1) return;
		git(b, "fetch", "origin");
		git(b, "reset", "--hard", "origin/master");
		setVersion(b, "1.0.2");
		git(b, "commit", "-am", "new reserved version");
		// The new tag belongs to the original code, so it does not cover source.
		git(b, "tag", "website-v1.0.2", "HEAD~2");
		git(b, "push", "--tags", "origin", "master");
	});
	assert.equal(
		JSON.parse(readFileSync(join(a, "web/bible-on-site/package.json"), "utf8"))
			.version,
		"1.0.3",
	);
	assert.doesNotMatch(git(a, "log", "-1", "--format=%s"), /skip ci/);
	assert.equal(
		git(a, "rev-parse", "HEAD"),
		git(b, "ls-remote", "origin", "refs/heads/master").split(/\s/)[0],
	);
});

test("a late retry does not bump code already covered by a release", (t) => {
	const { a, git } = fixture(t);
	const source = git(a, "rev-parse", "HEAD");
	publishVersionBumps(retry, "retry", a, source);
	assert.equal(git(a, "rev-parse", "HEAD"), source);
});

test("normal release bumps are idempotent and skip CI", (t) => {
	const { a, git } = fixture(t);
	publishVersionBumps(released, "released", a);
	const head = git(a, "rev-parse", "HEAD");
	assert.match(git(a, "log", "-1", "--format=%s"), /\[skip ci\]/);
	publishVersionBumps(released, "released", a);
	assert.equal(git(a, "rev-parse", "HEAD"), head);
});

test("publishing refuses unrelated working tree edits", (t) => {
	const { a } = fixture(t);
	writeFileSync(join(a, "user.txt"), "user edits");
	assert.throws(
		() => publishVersionBumps(released, "released", a),
		/clean checkout/,
	);
	assert.equal(readFileSync(join(a, "user.txt"), "utf8"), "user edits");
});

test("three overlapping collision requests coalesce into one retry CI commit", (t) => {
	const { a, git } = fixture(t);
	writeFileSync(join(a, "feature.txt"), "merged code");
	git(a, "add", ".");
	git(a, "commit", "-m", "feature");
	git(a, "push", "origin", "master");
	const source = git(a, "rev-parse", "HEAD");
	publishVersionBumps(retry, "all", a, source);
	const scheduled = git(a, "rev-parse", "HEAD");
	for (let request = 0; request < 3; request++)
		publishVersionBumps(retry, "all", a, source);
	assert.equal(git(a, "rev-parse", "HEAD"), scheduled);
	assert.doesNotMatch(git(a, "log", "-1", "--format=%s"), /skip ci/);
});

test("one publication combines normal releases and collision retries", (t) => {
	const { a, git } = fixture(t);
	mkdirSync(join(a, "web/admin"), { recursive: true });
	const version = "1.0.0";
	writeFileSync(
		join(a, "web/admin/package.json"),
		JSON.stringify({ name: "admin", version }),
	);
	writeFileSync(
		join(a, "web/admin/package-lock.json"),
		JSON.stringify({ version, packages: { "": { version } } }),
	);
	git(a, "add", ".");
	git(a, "commit", "-m", "admin feature");
	git(a, "tag", "admin-v1.0.0", "HEAD~1");
	git(a, "push", "--tags", "origin", "master");
	const source = git(a, "rev-parse", "HEAD");
	publishVersionBumps(
		{
			...released,
			release_admin: { result: "success", outputs: { needs_bump: "true" } },
		},
		"all",
		a,
		source,
	);
	assert.equal(git(a, "rev-parse", "HEAD~1"), source);
	assert.equal(
		JSON.parse(readFileSync(join(a, "web/admin/package.json"), "utf8")).version,
		"1.0.1",
	);
	assert.equal(
		JSON.parse(readFileSync(join(a, "web/bible-on-site/package.json"), "utf8"))
			.version,
		"1.0.1",
	);
	assert.doesNotMatch(git(a, "log", "-1", "--format=%s"), /skip ci/);
});

test("combined publication still skips CI for normal releases", (t) => {
	const { a, git } = fixture(t);
	publishVersionBumps(released, "all", a);
	assert.match(git(a, "log", "-1", "--format=%s"), /skip ci/);
});
