import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
	cpSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

function assertCachedInstall(log: string) {
	const install = log.match(/^#(\d+) \[deps [^\]]+\] RUN npm ci.*$/m);
	assert(install, "The dependency install must be in the build log");
	assert(log.includes(`#${install[1]} CACHED`), "npm ci must be a cache hit");
}

const log = readFileSync(process.argv[2], "utf8");
assertCachedInstall(log);
const build = log.match(/^#(\d+) \[builder [^\]]+\] RUN npm run build$/m);
assert(build, "The website build must be in the build log");
assert(
	!log.includes(`#${build[1]} CACHED`),
	"Live RDS SSG must never be cached",
);
assert(
	log.includes(`#${build[1]} DONE`),
	"The fresh website build must finish",
);
console.log("Cached npm ci, fresh npm run build; cached steps:");
console.log(
	log
		.split("\n")
		.filter((line) => line.endsWith(" CACHED"))
		.join("\n"),
);

// Reuse the real Dockerfile with a version-only change, as on every release.
const context = mkdtempSync(path.join(tmpdir(), "website-cache-check-"));
try {
	const moduleDir = path.join(context, "bible-on-site");
	cpSync("web/bible-on-site/Dockerfile", path.join(context, "Dockerfile"));
	for (const file of ["package.json", "package-lock.json", ".npmrc"]) {
		cpSync(path.join("web/bible-on-site", file), path.join(moduleDir, file), {
			recursive: true,
		});
	}
	for (const file of ["package.json", "package-lock.json"]) {
		const location = path.join(moduleDir, file);
		const json = JSON.parse(readFileSync(location, "utf8"));
		json.version = `${json.version}-cache-check`;
		if (json.packages) json.packages[""].version = json.version;
		writeFileSync(location, JSON.stringify(json));
	}
	const result = spawnSync(
		"docker",
		[
			"buildx",
			"build",
			"--builder",
			"default",
			"--network=host",
			"--progress=plain",
			"--target",
			"deps",
			"--no-cache-filter",
			"manifests",
			"--cache-from",
			`type=registry,ref=${process.argv[3]}`,
			context,
		],
		{ encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
	);
	console.log(result.stderr);
	assert.ifError(result.error);
	assert.equal(result.status, 0, "The version-only cache check must build");
	assertCachedInstall(result.stderr);
} finally {
	rmSync(context, { recursive: true, force: true });
}
