/**
 * When html-flip-book-react is a file: dependency, copy it (and its base dep)
 * into node_modules so Turbopack can resolve it (Turbopack does not follow
 * symlinks on Windows). Run after npm install.
 */
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const pkgPath = path.join(projectRoot, "package.json");
const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
const dep = pkg.dependencies?.["html-flip-book-react"];

if (!dep?.startsWith("file:")) {
	process.exit(0);
}

const rel = dep.slice("file:".length).replace(/^\.\//, "");
const reactSrc = path.resolve(projectRoot, rel);
const baseSrc = path.resolve(reactSrc, "..", "base");
const targetReact = path.join(projectRoot, "node_modules", "html-flip-book-react");
const targetVanilla = path.join(targetReact, "node_modules", "html-flip-book-vanilla");

if (!fs.existsSync(path.join(reactSrc, "dist", "flip-book.js"))) {
	console.warn(
		"copy-local-flip-book: react dist not found; run npm run build in html-flip-book first.",
	);
	process.exit(0);
}

function rmSyncRecursive(dir) {
	if (!fs.existsSync(dir)) return;
	fs.rmSync(dir, { recursive: true, force: true });
}

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

rmSyncRecursive(targetReact);
fs.mkdirSync(path.join(targetReact, "node_modules", "html-flip-book-vanilla"), {
	recursive: true,
});

fs.copyFileSync(
	path.join(reactSrc, "package.json"),
	path.join(targetReact, "package.json"),
);
copyDir(path.join(reactSrc, "dist"), path.join(targetReact, "dist"));

fs.copyFileSync(
	path.join(baseSrc, "package.json"),
	path.join(targetVanilla, "package.json"),
);
copyDir(path.join(baseSrc, "dist"), path.join(targetVanilla, "dist"));

// Install vanilla's dependencies (hammerjs, throttle-debounce, etc.) so the bundler can resolve them
execSync("npm install --omit=dev", {
	cwd: targetVanilla,
	stdio: "inherit",
});

console.log("copy-local-flip-book: copied local html-flip-book-react into node_modules");