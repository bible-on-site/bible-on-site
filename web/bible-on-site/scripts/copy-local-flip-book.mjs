/**
 * html-flip-book-react is installed from npm (CI/production). For local dev
 * with the repo alongside, set USE_LOCAL_FLIP_BOOK=1 and run this script
 * (or postinstall) to overwrite node_modules with the local build.
 * When dependency was file:, this script copied from that path; now it only
 * runs when USE_LOCAL_FLIP_BOOK=1 and the default local path exists.
 * In CI (npm version), any error is ignored so postinstall never breaks npm ci.
 */
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

function run() {
	const __dirname = path.dirname(fileURLToPath(import.meta.url));
	const projectRoot = path.resolve(__dirname, "..");
	const pkgPath = path.join(projectRoot, "package.json");
	const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
	const dep = pkg.dependencies?.["html-flip-book-react"];

	// Resolve source: file: dependency, or optional local path for dev (USE_LOCAL_FLIP_BOOK=1)
	let reactSrc;
	let baseSrc;
	// The sibling html-flip-book repo renamed its package folders after the
	// alpha.46 layout (react/, base/) to coherent names — resolve whichever
	// exists next to the react package.
	function siblingBaseDir(reactDir) {
		for (const name of ["base", "html-flip-book-base", "vanilla"]) {
			const candidate = path.resolve(reactDir, "..", name);
			// nosemgrep -- fixed local directory list, no user input
			if (fs.existsSync(path.join(candidate, "package.json"))) {
				return candidate;
			}
		}
		return path.resolve(reactDir, "..", "base");
	}

	if (dep?.startsWith("file:")) {
		const rel = dep.slice("file:".length).replace(/^\.\//, "");
		reactSrc = path.resolve(projectRoot, rel);
		baseSrc = siblingBaseDir(reactSrc);
	} else if (process.env.USE_LOCAL_FLIP_BOOK === "1") {
		// Default location when bible-on-site and html-flip-book are siblings
		const repoDir = path.resolve(
			projectRoot,
			"..",
			"..",
			"..",
			"html-flip-book",
		);
		reactSrc = ["react", "html-flip-book-react"]
			.map((name) => path.join(repoDir, name))
			.find((candidate) =>
				// nosemgrep -- fixed local directory list, no user input
				fs.existsSync(path.join(candidate, "package.json")),
			);
		if (!reactSrc) {
			console.warn(
				`copy-local-flip-book: no react package found under ${repoDir}`,
			);
			process.exit(0);
			return;
		}
		baseSrc = siblingBaseDir(reactSrc);
	} else {
		process.exit(0);
		return;
	}

	if (!fs.existsSync(path.join(reactSrc, "dist", "flip-book.js"))) {
		console.warn(
			"copy-local-flip-book: react dist not found; run npm run build in html-flip-book first.",
		);
		process.exit(0);
		return;
	}

	const targetReact = path.join(
		projectRoot,
		"node_modules",
		"html-flip-book-react",
	);
	const targetVanilla = path.join(
		targetReact,
		"node_modules",
		"html-flip-book-vanilla",
	);

	function copyDir(src, dest) {
		fs.mkdirSync(dest, { recursive: true });
		for (const name of fs.readdirSync(src)) {
			const s = path.join(src, name);
			const d = path.join(dest, name);
			if (fs.statSync(s).isDirectory()) {
				copyDir(s, d);
			} else {
				fs.copyFileSync(s, d);
			}
		}
	}

	// A file: dependency leaves a symlink; remove the link itself without
	// following it (rming `dist` through it would empty the source repo's dist).
	// A real directory keeps its node_modules so the nested install below runs
	// once per checkout instead of on every refresh.
	try {
		// nosemgrep -- target under this checkout's node_modules, fixed path
		if (fs.lstatSync(targetReact).isSymbolicLink()) fs.unlinkSync(targetReact);
	} catch {
		// doesn't exist — fine
	}
	// nosemgrep -- target under this checkout's node_modules, fixed path
	fs.rmSync(path.join(targetReact, "dist"), { recursive: true, force: true });
	fs.mkdirSync(targetVanilla, { recursive: true });

	fs.copyFileSync(
		path.join(reactSrc, "package.json"),
		path.join(targetReact, "package.json"),
	);
	copyDir(path.join(reactSrc, "dist"), path.join(targetReact, "dist"));

	fs.rmSync(path.join(targetVanilla, "dist"), {
		recursive: true,
		force: true,
	});
	fs.copyFileSync(
		path.join(baseSrc, "package.json"),
		path.join(targetVanilla, "package.json"),
	);
	copyDir(path.join(baseSrc, "dist"), path.join(targetVanilla, "dist"));

	// Install vanilla's dependencies (hammerjs, throttle-debounce, etc.) so the bundler can resolve them
	// nosemgrep -- target under this checkout's node_modules, fixed path
	if (!fs.existsSync(path.join(targetVanilla, "node_modules"))) {
		execSync("npm install --omit=dev", {
			cwd: targetVanilla,
			stdio: "inherit",
		});
	}

	console.log(
		"copy-local-flip-book: copied local html-flip-book-react into node_modules",
	);
}

try {
	run();
} catch (err) {
	// In CI (npm version) or when local path is missing, do not fail npm install
	console.warn("copy-local-flip-book:", err?.message ?? err);
	process.exit(0);
}
