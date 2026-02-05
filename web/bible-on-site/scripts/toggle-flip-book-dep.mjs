/**
 * Toggles html-flip-book-react dependency between local file and npm version.
 * Usage:
 *   node scripts/toggle-flip-book-dep.mjs local   # Switch to file:../../../html-flip-book/react
 *   node scripts/toggle-flip-book-dep.mjs npm     # Switch to npm version
 *   node scripts/toggle-flip-book-dep.mjs check   # Exit 1 if local, 0 if npm (for pre-commit)
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pkgPath = path.resolve(__dirname, "..", "package.json");

const LOCAL_REF = "file:../../../html-flip-book/react";
const NPM_VERSION = "0.0.0-alpha.19"; // Update this when upgrading

const mode = process.argv[2];

if (!["local", "npm", "check"].includes(mode)) {
	console.error("Usage: node toggle-flip-book-dep.mjs <local|npm|check>");
	process.exit(1);
}

const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
const current = pkg.dependencies?.["html-flip-book-react"];
const isLocal = current?.startsWith("file:");

if (mode === "check") {
	if (isLocal) {
		console.error(
			"❌ html-flip-book-react is set to local. Run: npm run flip-book:npm",
		);
		process.exit(1);
	}
	process.exit(0);
}

const target = mode === "local" ? LOCAL_REF : NPM_VERSION;

if (current === target) {
	console.log(`html-flip-book-react already set to ${mode} (${target})`);
	process.exit(0);
}

pkg.dependencies["html-flip-book-react"] = target;
fs.writeFileSync(pkgPath, `${JSON.stringify(pkg, null, "\t")}\n`);
console.log(`html-flip-book-react switched to ${mode}: ${target}`);

if (mode === "local") {
	console.log("Run: npm install");
}
