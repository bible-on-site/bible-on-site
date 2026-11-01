import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import {
	copyLocalFlipBook,
	resolveLocalFlipBook,
} from "./copy-local-flip-book.mjs";
import { prepareDevDependencies } from "./predev-deps.mjs";
import { fixture } from "./test-support/flip-book-fixture.mjs";
import {
	NPM_VERSION,
	toggleFlipBookDependency,
} from "./toggle-flip-book-dep.mjs";

test("fixture filesystem helpers reject paths outside their temporary root", (t) => {
	const f = fixture(t);
	const outside = path.resolve(
		f.project,
		"..",
		"..",
		"..",
		"..",
		"outside-fixture.js",
	);
	assert.throws(
		() => f.write(outside, "must not be written"),
		/must stay inside/,
	);
	assert.throws(() => f.read(outside), /must stay inside/);
	assert.throws(() => f.junction(f.react, outside), /must stay inside/);
});

test("automatic local override keeps the published fix when a stale sibling is older", (t) => {
	const f = fixture(t, { localVersion: "0.0.0-alpha.51" });
	t.mock.method(console, "warn", () => {});
	assert.equal(resolveLocalFlipBook(f.project, {}, true), null);
	prepareDevDependencies(f.project, { env: {}, run: f.run });
	assert.deepEqual(
		f.commands.map((call) => call.command),
		["bun install --prefer-offline"],
	);
	assert.equal(
		f.read(path.join(f.target, "dist", "flip-book.js"), "utf8"),
		"published build",
	);
	assert.match(console.warn.mock.calls[0].arguments[0], /local 0.0.0-alpha.51/);
});

test("explicit opt-in allows older branches, and renamed package folders work in a sibling worktree", (t) => {
	const f = fixture(t, {
		localVersion: "0.0.0-alpha.51",
		folderNames: ["html-flip-book-react", "html-flip-book-base"],
	});
	const local = resolveLocalFlipBook(f.project, { USE_LOCAL_FLIP_BOOK: "1" });
	assert.equal(local.reactSrc, f.react);
	assert.equal(copyLocalFlipBook(f.project, { local, run: f.run }), true);
	assert.equal(
		f.read(path.join(f.target, "dist", "flip-book.js"), "utf8"),
		"fresh source",
	);
});

test("unchanged startup skips installs and builds; source, config, lock and dist changes rebuild", (t) => {
	const f = fixture(t);
	const options = { env: {}, run: f.run };
	prepareDevDependencies(f.project, options);
	assert.equal(f.commands[0].env.USE_LOCAL_FLIP_BOOK, "0");
	assert.deepEqual(
		f.commands.map((call) => call.command),
		[
			"bun install --prefer-offline",
			"bun run build",
			"bun install --production",
		],
	);
	f.commands.length = 0;
	prepareDevDependencies(f.project, options);
	assert.deepEqual(f.commands, []);
	for (const file of [
		path.join(f.react, "src", "index.ts"),
		path.join(f.repo, "vite.config.ts"),
		path.join(f.repo, "bun.lock"),
		path.join(f.base, "dist", "flipbook.js"),
	]) {
		f.write(file, "changed build input or artifact");
		prepareDevDependencies(f.project, options);
	}
	assert.deepEqual(
		f.commands.map((call) => call.command),
		Array(4).fill("bun run build"),
	);
	assert.equal(
		f.read(path.join(f.target, "dist", "flip-book.js"), "utf8"),
		"changed build input or artifact",
	);
});

test("build and nested install failures preserve the previously installed package", (t) => {
	const f = fixture(t);
	f.run("bun install --prefer-offline", { cwd: f.project });
	const local = resolveLocalFlipBook(f.project, {}, true);
	assert.throws(
		() =>
			copyLocalFlipBook(f.project, {
				local,
				run: () => {
					throw new Error("build failed");
				},
			}),
		/build failed/,
	);
	assert.equal(
		f.read(path.join(f.target, "dist", "flip-book.js"), "utf8"),
		"published build",
	);
	assert.throws(
		() =>
			copyLocalFlipBook(f.project, {
				local,
				run: (command, options) => {
					if (command === "bun install --production")
						throw new Error("install failed");
					f.run(command, options);
				},
			}),
		/install failed/,
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

test("incomplete output fails before the installed package is replaced", (t) => {
	const f = fixture(t);
	f.run("bun install --prefer-offline", { cwd: f.project });
	assert.throws(
		() =>
			copyLocalFlipBook(f.project, {
				local: resolveLocalFlipBook(f.project, {}, true),
				run: () => {},
			}),
		/build is incomplete/,
	);
	assert.equal(
		f.read(path.join(f.target, "dist", "flip-book.js"), "utf8"),
		"published build",
	);
});

test("disabling a copied local build restores the registry even when dependency inputs did not change", (t) => {
	const f = fixture(t);
	prepareDevDependencies(f.project, { env: {}, run: f.run });
	f.commands.length = 0;
	prepareDevDependencies(f.project, {
		env: { USE_LOCAL_FLIP_BOOK: "0" },
		run: f.run,
	});
	assert.deepEqual(
		f.commands.map((call) => call.command),
		["bun install --prefer-offline"],
	);
	assert.equal(
		f.read(path.join(f.target, "dist", "flip-book.js"), "utf8"),
		"published build",
	);
	assert.ok(!f.exists(path.join(f.target, ".local-flip-book")));
});

test("postinstall is inactive by default and file dependencies resolve their actual checkout", (t) => {
	const f = fixture(t);
	assert.equal(copyLocalFlipBook(f.project, { env: {}, run: f.run }), false);
	f.json(path.join(f.project, "package.json"), {
		dependencies: {
			"html-flip-book-react": `file:${path.relative(f.project, f.react).split(path.sep).join("/")}`,
		},
	});
	assert.equal(resolveLocalFlipBook(f.project, {}).reactSrc, f.react);
	assert.equal(copyLocalFlipBook(f.project, { env: {}, run: f.run }), true);
});

test("explicit missing repo fails; unknown prereleases require opt-in", (t) => {
	const f = fixture(t, { localVersion: "0.0.0-experimental.1" });
	t.mock.method(console, "warn", () => {});
	assert.equal(resolveLocalFlipBook(f.project, {}, true), null);
	f.json(path.join(f.project, "package.json"), {
		dependencies: { "html-flip-book-react": "file:missing" },
	});
	assert.throws(
		() => resolveLocalFlipBook(f.project, {}),
		/package is missing/,
	);
});

test("failed registry restoration rolls back the working local copy", (t) => {
	const f = fixture(t);
	prepareDevDependencies(f.project, { env: {}, run: f.run });
	assert.throws(
		() =>
			prepareDevDependencies(f.project, {
				env: { USE_LOCAL_FLIP_BOOK: "0" },
				run: (command, options) => {
					f.run(command, options);
					throw new Error("registry unavailable");
				},
			}),
		/registry unavailable/,
	);
	assert.equal(
		f.read(path.join(f.target, "dist", "flip-book.js"), "utf8"),
		"fresh source",
	);
	assert.ok(f.exists(path.join(f.target, ".local-flip-book")));
});

test("replacing a file dependency junction preserves the sibling build", (t) => {
	const f = fixture(t);
	f.run("bun run build", { cwd: f.repo });
	f.mkdir(path.dirname(f.target));
	f.junction(f.react, f.target);
	copyLocalFlipBook(f.project, {
		local: resolveLocalFlipBook(f.project, {}, true),
		run: f.run,
	});
	assert.equal(f.isLink(f.target), process.platform === "win32");
	assert.equal(
		f.read(path.join(f.react, "dist", "flip-book.js"), "utf8"),
		"fresh source",
	);
});

test("npm mode restores a same-version copied override despite inherited local opt-in", (t) => {
	const f = fixture(t, {
		localVersion: NPM_VERSION,
		publishedVersion: NPM_VERSION,
	});
	prepareDevDependencies(f.project, {
		env: { USE_LOCAL_FLIP_BOOK: "1" },
		run: f.run,
	});
	f.commands.length = 0;
	toggleFlipBookDependency("npm", {
		projectRoot: f.project,
		env: { USE_LOCAL_FLIP_BOOK: "1" },
		run: f.run,
	});
	assert.deepEqual(
		f.commands.map((call) => call.command),
		["bun install --prefer-offline"],
	);
	assert.equal(f.commands[0].env.USE_LOCAL_FLIP_BOOK, "0");
	assert.equal(
		f.read(path.join(f.target, "dist", "flip-book.js"), "utf8"),
		"published build",
	);
	assert.ok(!f.exists(path.join(f.target, ".local-flip-book")));
	assert.equal(
		f.read(path.join(f.react, "dist", "flip-book.js"), "utf8"),
		"fresh source",
	);
});

test("npm mode rolls back a same-version copied override when restoration fails", (t) => {
	const f = fixture(t, {
		localVersion: NPM_VERSION,
		publishedVersion: NPM_VERSION,
	});
	prepareDevDependencies(f.project, {
		env: { USE_LOCAL_FLIP_BOOK: "1" },
		run: f.run,
	});
	assert.throws(
		() =>
			toggleFlipBookDependency("npm", {
				projectRoot: f.project,
				env: {},
				run: (command, options) => {
					f.run(command, options);
					throw new Error("registry unavailable");
				},
			}),
		/registry unavailable/,
	);
	assert.equal(
		f.read(path.join(f.target, "dist", "flip-book.js"), "utf8"),
		"fresh source",
	);
	assert.ok(f.exists(path.join(f.target, ".local-flip-book")));
});

test("npm mode restores same-version legacy junctions and rolls back without altering their source", (t) => {
	const f = fixture(t, {
		localVersion: NPM_VERSION,
		publishedVersion: NPM_VERSION,
	});
	f.run("bun run build", { cwd: f.repo });
	f.mkdir(path.dirname(f.target));
	f.junction(f.react, f.target);
	assert.throws(
		() =>
			toggleFlipBookDependency("npm", {
				projectRoot: f.project,
				env: {},
				run: () => {
					throw new Error("offline");
				},
			}),
		/offline/,
	);
	assert.equal(f.isLink(f.target), true);
	assert.equal(
		f.read(path.join(f.react, "dist", "flip-book.js"), "utf8"),
		"fresh source",
	);
	toggleFlipBookDependency("npm", {
		projectRoot: f.project,
		env: {},
		run: f.run,
	});
	assert.equal(f.isLink(f.target), false);
	assert.equal(
		f.read(path.join(f.target, "dist", "flip-book.js"), "utf8"),
		"published build",
	);
	assert.equal(
		f.read(path.join(f.react, "dist", "flip-book.js"), "utf8"),
		"fresh source",
	);
});
