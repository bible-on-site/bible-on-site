// Generic cache-key input: sha256 over the named files, emitted to
// $GITHUB_OUTPUT as `hash`. Replaces `hashFiles()` in step templates —
// template-expression hashFiles is bounded by a hard 120s budget and dies
// on loaded runners (#2184), while a run step is not template-evaluated.
// CRLF is normalized so a Windows checkout and a Linux checkout of the
// same revision produce the same key.
import { createHash } from "node:crypto";
import { appendFileSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export function filesHash(paths, root = process.cwd()) {
	const hash = createHash("sha256");
	for (const path of [...paths].sort()) {
		const content = readFileSync(resolve(root, path), "utf8");
		hash.update(`${path}\0${content.replace(/\r\n/g, "\n")}\0`);
	}
	return hash.digest("hex");
}

if (resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	const paths = process.argv.slice(2);
	if (paths.length === 0) {
		console.error("usage: node files-hash.mjs <path>...");
		process.exit(2);
	}
	const hash = filesHash(paths);
	console.log(`Files hash: ${hash}`);
	appendFileSync(process.env.GITHUB_OUTPUT, `hash=${hash}\n`);
}
