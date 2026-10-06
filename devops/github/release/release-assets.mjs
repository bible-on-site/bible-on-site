import { createHash } from "node:crypto";
import { globSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { releasePayload } from "./release-provenance.mjs";

export { releasePayload } from "./release-provenance.mjs";

/** Do not expose a draft or dispatch CD until every expected asset is uploaded. */
export function verifyReleaseAssets(release, artifacts, cwd = process.cwd()) {
	const expected = new Map();
	for (const artifact of artifacts.filter((item) => item.name)) {
		const folder = path.resolve(cwd, artifact.path);
		const files = globSync(artifact.glob, { cwd: folder }).filter((file) =>
			statSync(path.join(folder, file)).isFile(),
		);
		if (!files.length) throw new Error(`No release files for ${artifact.name}`);
		for (const file of files) {
			const name = path.basename(file);
			if (expected.has(name))
				throw new Error(`Duplicate release asset: ${name}`);
			expected.set(name, readFileSync(path.join(folder, file)));
		}
	}
	if (!expected.size) throw new Error("A release requires at least one asset");
	for (const [name, bytes] of expected) {
		const asset = release.assets.find((item) => item.name === name);
		const digest = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
		if (
			asset?.state !== "uploaded" ||
			asset.size !== bytes.length ||
			(asset.digest && asset.digest !== digest)
		) {
			throw new Error(`Incomplete or mismatched release asset: ${name}`);
		}
	}
}

if (
	process.argv[1] &&
	path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
	const release = JSON.parse(readFileSync("release.json", "utf8"));
	if (process.argv.includes("--verify")) {
		verifyReleaseAssets(release, JSON.parse(process.env.RELEASE_ARTIFACTS));
	} else {
		const payload = releasePayload(release);
		if (payload) console.log(JSON.stringify(payload));
	}
}
