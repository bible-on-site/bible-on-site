import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export function fixture(
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
	function realpath(file) {
		const resolved = within(file);
		// nosemgrep -- both the lookup and its resolved junction target stay in this fixture root.
		return within(fs.realpathSync(resolved));
	}
	function rename(source, destination, operation) {
		const from = within(source);
		const to = within(destination);
		return operation(from, to);
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
		realpath,
		rename,
		json,
		run,
		commands,
	};
}
