import { createHash } from "node:crypto";
import { appendFileSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Read only named inputs: GitHub's hashFiles can time out traversing a large
// reused runner workspace even when its patterns name just two files.
export function directFileHash(root, paths) {
	const hash = createHash("sha256");
	for (const path of [...paths].sort()) {
		hash.update(`${path}\0`);
		hash.update(readFileSync(join(root, path)));
		hash.update("\0");
	}
	return hash.digest("hex");
}

export function mobileCacheKeys(root) {
	return {
		npm: directFileHash(root, [
			"devops/package-lock.json",
			"app/mobile-e2e/package-lock.json",
		]),
		avd: directFileHash(root, [
			"app/mobile-e2e/android-readiness.mjs",
			"app/mobile-e2e/android-ready.mjs",
		]),
	};
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	const keys = mobileCacheKeys(fileURLToPath(new URL("../../../", import.meta.url)));
	appendFileSync(
		process.env.GITHUB_OUTPUT,
		Object.entries(keys).map(([name, hash]) => `${name}=${hash}\n`).join(""),
	);
}
