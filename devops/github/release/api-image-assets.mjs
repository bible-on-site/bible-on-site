import path from "node:path";
import { fileURLToPath } from "node:url";
import { findRelease, verifyReleaseAssets } from "./release-assets.mjs";
import { nativeImageArtifacts, releasePayload } from "./release-provenance.mjs";

/** Verify both downloaded archives against immutable-source published release metadata. */
export function verifyAPIImageAssets(
	release,
	{ version, sourceRef, directory, moduleName = "api" },
) {
	if (
		!["api", "website"].includes(moduleName) ||
		!/^\d+\.\d+\.\d+$/.test(version ?? "") ||
		!/^[a-f0-9]{40}$/.test(sourceRef ?? "") ||
		typeof directory !== "string" ||
		!directory
	)
		throw new Error(
			"API archive verification requires a version, source SHA and directory",
		);
	if (
		!release ||
		release.draft ||
		release.prerelease ||
		release.tag_name !== `${moduleName}-v${version}`
	) {
		throw new Error("API archives require the published canonical release");
	}
	const payload = releasePayload(release);
	if (
		!nativeImageArtifacts(payload) ||
		payload.module_name !== moduleName ||
		payload.ref !== sourceRef
	)
		throw new Error("API archive source differs from the approved release");
	const image =
		moduleName === "website" ? "bible-on-site" : "bible-on-site-api";
	const names = [
		`${image}-v${version}.tar.gz`,
		`${image}-v${version}-arm64.tar.gz`,
	];
	for (const name of names) {
		const matching =
			release.assets?.filter((asset) => asset.name === name) ?? [];
		if (
			matching.length !== 1 ||
			matching[0].state !== "uploaded" ||
			!Number.isSafeInteger(matching[0].size) ||
			matching[0].size <= 0 ||
			!/^sha256:[a-f0-9]{64}$/.test(matching[0].digest ?? "")
		) {
			throw new Error(`Missing, ambiguous or unhashed API archive: ${name}`);
		}
	}
	verifyReleaseAssets(
		release,
		names.map((name) => ({ name, path: directory, glob: name })),
	);
	return names;
}

export function main(env = process.env, lookup = findRelease) {
	const version = env.MODULE_VERSION;
	const moduleName = env.MODULE_NAME ?? "api";
	if (!["api", "website"].includes(moduleName))
		throw new Error("Invalid native image module");
	if (!/^\d+\.\d+\.\d+$/.test(version ?? ""))
		throw new Error("Invalid API release version");
	return verifyAPIImageAssets(
		lookup(env.GITHUB_REPOSITORY, `${moduleName}-v${version}`),
		{
			version,
			sourceRef: env.IMAGE_RELEASE_SOURCE ?? env.API_RELEASE_SOURCE,
			directory: env.DOCKER_IMAGE_OUTPUT_DIR,
			moduleName,
		},
	);
}

if (
	process.argv[1] &&
	path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
	main();
	console.log(
		"Both API release archives match their published source and SHA256 digests.",
	);
}
