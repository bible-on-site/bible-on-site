import assert from "node:assert/strict";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import path from "node:path";
import { test } from "node:test";
import {
	copyLocalFlipBook,
	resolveLocalFlipBook,
} from "./copy-local-flip-book.mjs";
import { prepareDevDependencies } from "./predev-deps.mjs";
import { fixture } from "./test-support/flip-book-fixture.mjs";

test("Windows publication renames only a link when copied trees cannot be moved", (t) => {
	const f = fixture(t);
	f.run("bun install --prefer-offline", { cwd: f.project });
	const local = resolveLocalFlipBook(f.project, {}, true);
	const rename = fs.renameSync;
	t.mock.method(fs, "renameSync", (source, destination) => {
		if (
			path.basename(source) === "next" &&
			!fs.lstatSync(source).isSymbolicLink()
		) {
			throw Object.assign(
				new Error("Copied tree is held by a Windows scanner"),
				{ code: "EPERM" },
			);
		}
		return rename(source, destination);
	});
	copyLocalFlipBook(f.project, { local, run: f.run, platform: "win32" });
	assert.equal(f.isLink(f.target), true);
	const firstSnapshot = fs.realpathSync(f.target);
	f.write(path.join(f.react, "src", "page.tsx"), "second source");
	copyLocalFlipBook(f.project, { local, run: f.run, platform: "win32" });
	assert.notEqual(fs.realpathSync(f.target), firstSnapshot);
	assert.equal(f.exists(firstSnapshot), false);
	assert.equal(
		f.read(path.join(f.target, "dist", "flip-book.js"), "utf8"),
		"fresh source",
	);
});

test("failed Windows link promotion restores the previous package", (t) => {
	const f = fixture(t);
	f.run("bun install --prefer-offline", { cwd: f.project });
	const rename = fs.renameSync;
	t.mock.method(fs, "renameSync", (source, destination) => {
		if (path.basename(source) === "link")
			throw new Error("link promotion failed");
		return rename(source, destination);
	});
	assert.throws(
		() =>
			copyLocalFlipBook(f.project, {
				local: resolveLocalFlipBook(f.project, {}, true),
				run: f.run,
				platform: "win32",
			}),
		/link promotion failed/,
	);
	assert.equal(
		f.read(path.join(f.target, "dist", "flip-book.js"), "utf8"),
		"published build",
	);
	assert.ok(
		!f
			.entries(path.join(f.project, "node_modules"))
			.some((name) => name.startsWith(".flip-book-local-")),
	);
});

test("a rollback failure keeps its recovery copy instead of deleting it", (t) => {
	const f = fixture(t);
	f.run("bun install --prefer-offline", { cwd: f.project });
	const rename = fs.renameSync;
	t.mock.method(fs, "renameSync", (source, destination) => {
		if (["link", "previous"].includes(path.basename(source)))
			throw new Error("promotion/rollback locked");
		return rename(source, destination);
	});
	assert.throws(
		() =>
			copyLocalFlipBook(f.project, {
				local: resolveLocalFlipBook(f.project, {}, true),
				run: f.run,
				platform: "win32",
			}),
		/previous package retained/,
	);
	const backup = f
		.entries(path.join(f.project, "node_modules"))
		.find((name) => name.startsWith(".flip-book-local-"));
	assert.ok(backup);
	assert.equal(
		f.read(
			path.join(
				f.project,
				"node_modules",
				backup,
				"previous",
				"dist",
				"flip-book.js",
			),
			"utf8",
		),
		"published build",
	);
});

test("registry restoration retires its owned Windows snapshot", (t) => {
	const f = fixture(t);
	copyLocalFlipBook(f.project, {
		local: resolveLocalFlipBook(f.project, {}, true),
		run: f.run,
		platform: "win32",
	});
	const snapshot = path.dirname(fs.realpathSync(f.target));
	prepareDevDependencies(f.project, {
		env: { USE_LOCAL_FLIP_BOOK: "0" },
		run: f.run,
	});
	assert.equal(f.exists(snapshot), false);
	assert.equal(
		f.read(path.join(f.target, "dist", "flip-book.js"), "utf8"),
		"published build",
	);
});

test("failed registry rollback keeps the last working package for recovery", (t) => {
	const f = fixture(t);
	prepareDevDependencies(f.project, { env: {}, run: f.run });
	const rename = fs.renameSync;
	t.mock.method(fs, "renameSync", (source, destination) => {
		if (path.basename(source) === "previous")
			throw new Error("registry rollback locked");
		return rename(source, destination);
	});
	syncBuiltinESMExports();
	t.after(() => {
		t.mock.restoreAll();
		syncBuiltinESMExports();
	});
	assert.throws(
		() =>
			prepareDevDependencies(f.project, {
				env: { USE_LOCAL_FLIP_BOOK: "0" },
				run: (command, options) => {
					f.run(command, options);
					throw new Error("registry unavailable");
				},
			}),
		/previous package retained/,
	);
	const backup = f
		.entries(path.join(f.project, "node_modules"))
		.find((name) => name.startsWith(".flip-book-registry-"));
	assert.ok(backup);
	assert.equal(
		f.read(
			path.join(
				f.project,
				"node_modules",
				backup,
				"previous",
				"dist",
				"flip-book.js",
			),
			"utf8",
		),
		"fresh source",
	);
});
