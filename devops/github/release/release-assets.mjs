import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { globSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { releasePayload } from "./release-provenance.mjs";

export { releasePayload } from "./release-provenance.mjs";

/** The tag endpoint only returns published releases; authenticated lists include drafts. */
export function findRelease(
	repository,
	tag,
	api = (endpoint) =>
		JSON.parse(
			execFileSync("gh", ["api", endpoint], {
				encoding: "utf8",
				maxBuffer: 16 * 1024 * 1024,
			}),
		),
) {
	if (
		!/^[\w.-]+\/[\w.-]+$/.test(repository ?? "") ||
		repository.split("/").some((part) => part === "." || part === "..") ||
		!/^[\w.-]+$/.test(tag ?? "")
	)
		throw new Error("Release lookup requires a repository and tag");
	for (let page = 1; ; page++) {
		const releases = api(
			`repos/${repository}/releases?per_page=100&page=${page}`,
		);
		if (!Array.isArray(releases)) throw new Error("Invalid release listing");
		const release = releases.find((item) => item.tag_name === tag);
		if (release) return release;
		if (releases.length < 100) return null;
	}
}

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
	if (process.argv.includes("--lookup")) {
		console.log(
			JSON.stringify(
				findRelease(
					process.env.GITHUB_REPOSITORY,
					process.argv[process.argv.indexOf("--lookup") + 1],
				),
			),
		);
	} else if (process.argv.includes("--verify")) {
		const release = JSON.parse(readFileSync("release.json", "utf8"));
		verifyReleaseAssets(release, JSON.parse(process.env.RELEASE_ARTIFACTS));
	} else {
		const release = JSON.parse(readFileSync("release.json", "utf8"));
		const payload = releasePayload(release);
		if (payload) console.log(JSON.stringify(payload));
	}
}
