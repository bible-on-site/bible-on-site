// NuGet cache key input for the app: every app .csproj with the release
// version properties removed. `bump_versions` rewrites those on each app
// release, so hashing the raw files would start a new multi-GB cache per release.
// MAUI lock files are not used: BibleOnSite.csproj adds its Windows target only
// on Windows and iOS/Mac Catalyst restore only on macOS, so no runner can
// produce a lock file that every packaging job could restore in locked mode.
import { createHash } from "node:crypto";
import { appendFileSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const VERSION_PROPERTY =
	/<(ApplicationDisplayVersion|ApplicationVersion)\b[^>]*>[^<]*<\/\1>/g;

export function nugetDependencyHash(appDirectory) {
	const hash = createHash("sha256");
	const projects = readdirSync(appDirectory, { recursive: true })
		.map(String)
		.filter(
			(path) => path.endsWith(".csproj") && !/(^|[\\/])(bin|obj)[\\/]/.test(path),
		)
		.map((path) => path.replaceAll("\\", "/"))
		.sort();
	for (const project of projects) {
		const content = readFileSync(join(appDirectory, project), "utf8")
			.replace(/\r\n/g, "\n")
			.replace(VERSION_PROPERTY, "");
		hash.update(`${project}\0${content}\0`);
	}
	return hash.digest("hex");
}

if (resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	const hash = nugetDependencyHash(
		fileURLToPath(new URL("../../../app", import.meta.url)),
	);
	console.log(`NuGet dependency hash: ${hash}`);
	appendFileSync(process.env.GITHUB_OUTPUT, `hash=${hash}\n`);
}
