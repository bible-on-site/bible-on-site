import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
	copyLocalFlipBook,
	resolveLocalFlipBook,
} from "./copy-local-flip-book.mjs";
import { prepareDevDependencies } from "./predev-deps.mjs";
import {
	NPM_VERSION,
	toggleFlipBookDependency,
} from "./toggle-flip-book-dep.mjs";

function fixture(
	t,
	{
		localVersion = "0.0.0-alpha.94",
		publishedVersion = "0.0.0-alpha.93",
		folderNames = ["react", "base"],
	} = {},
) {
	const directory = fs.mkdtempSync(path.join(os.tmpdir(), "flip-book-dev-"));
	t.after(() => {
		assert.equal(path.dirname(directory), os.tmpdir());
		assert.ok(path.basename(directory).startsWith("flip-book-dev-"));
		fs.rmSync(directory, { recursive: true, force: true });
	});
	const project = path.join(directory, "bible-on-site", "web", "bible-on-site");
	const repo = path.join(directory, "html-flip-book");
	const react = path.join(repo, folderNames[0]);
	const base = path.join(repo, folderNames[1]);
	const target = path.join(project, "node_modules", "html-flip-book-react");
	function within(file) {
		const resolved = path.resolve(file);
		const relative = path.relative(directory, resolved);
		assert.ok(
			relative &&
				relative !== ".." &&
				!relative.startsWith(`..${path.sep}`) &&
				!path.isAbsolute(relative),
			"Fixture path must stay inside its temporary root",
		);
		return resolved;
	}
	function mkdir(file) {
		const resolved = within(file);
		// nosemgrep -- asserted inside this fixture's fresh mkdtemp root; fixed test paths only.
		fs.mkdirSync(resolved, { recursive: true });
	}
	function write(file, content) {
		const resolved = within(file);
		mkdir(path.dirname(resolved));
		// nosemgrep -- resolved is contained in the fresh fixture root; content is test data.
		fs.writeFileSync(resolved, content);
	}
	function read(file, encoding) {
		const resolved = within(file);
		// nosemgrep -- contained fixture path, never a path from external input.
		return fs.readFileSync(resolved, encoding);
	}
	function exists(file) {
		const resolved = within(file);
		// nosemgrep -- existence check is confined to this test's temporary root.
		return fs.existsSync(resolved);
	}
	function entries(file) {
		const resolved = within(file);
		// nosemgrep -- enumerates only the contained fixture's node_modules directory.
		return fs.readdirSync(resolved);
	}
	function junction(source, destination) {
		const from = within(source);
		const to = within(destination);
		// nosemgrep -- both junction ends are asserted inside the same fresh fixture root.
		fs.symlinkSync(from, to, "junction");
	}
	function isLink(file) {
		const resolved = within(file);
		// nosemgrep -- inspects the fixture junction itself at a contained path.
		return fs.lstatSync(resolved).isSymbolicLink();
	}
	function json(file, content) {
		write(file, JSON.stringify(content));
	}
	json(path.join(project, "package.json"), {
		dependencies: { "html-flip-book-react": publishedVersion },
	});
	write(path.join(project, "bun.lock"), "website lock");
	json(path.join(repo, "package.json"), { version: localVersion });
	write(path.join(repo, "bun.lock"), "library lock");
	write(path.join(repo, "vite.config.ts"), "initial config");
	for (const [source, main] of [
		[react, "flip-book.js"],
		[base, "flipbook.js"],
	]) {
		json(path.join(source, "package.json"), {
			version: localVersion,
			main: `./dist/${main}`,
			types: "./dist/index.d.ts",
			exports: { ".": `./dist/${main}`, "./styles.css": "./dist/style.css" },
			dependencies: { hammerjs: "2.0.8" },
		});
		write(path.join(source, "src", "index.ts"), "fresh source");
	}
	const commands = [];
	function run(command, options) {
		commands.push({ command, ...options });
		if (options.cwd === project) {
			mkdir(path.join(project, "node_modules", ".bin"));
			json(path.join(target, "package.json"), { version: publishedVersion });
			write(path.join(target, "dist", "flip-book.js"), "published build");
		} else if (command === "bun run build") {
			for (const [source, main] of [
				[react, "flip-book.js"],
				[base, "flipbook.js"],
			]) {
				write(
					path.join(source, "dist", main),
					read(path.join(source, "src", "index.ts")),
				);
				write(path.join(source, "dist", "index.d.ts"), "declarations");
				write(path.join(source, "dist", "style.css"), "styles");
			}
		} else {
			write(
				path.join(options.cwd, "node_modules", "hammerjs", "index.js"),
				"dependency",
			);
		}
	}
	return {
		project,
		repo,
		react,
		base,
		target,
		write,
		read,
		exists,
		entries,
		mkdir,
		junction,
		isLink,
		json,
		run,
		commands,
	};
}

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
	assert.equal(f.isLink(f.target), false);
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
