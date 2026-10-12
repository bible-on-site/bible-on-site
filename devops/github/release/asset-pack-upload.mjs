import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { appleReader, findApp } from "./testflight-build.mjs";

/**
 * Uploads every managed Background Assets archive (.aar) in a directory to App
 * Store Connect via `xcrun altool --upload-asset-pack`. The packs are produced
 * by `xcrun ba-package` at app packaging time and ride the app release as
 * separate GitHub release assets — the IPA alone carries none of them.
 */

export function listArchives(directory) {
	return readdirSync(directory)
		.filter((name) => name.endsWith(".aar"))
		.sort()
		.map((name) => path.join(directory, name));
}

export function uploadArguments(archive, appId, credentials) {
	return [
		"altool",
		"--upload-asset-pack",
		archive,
		"--apple-id",
		appId,
		"--api-key",
		credentials.key_id,
		"--api-issuer",
		credentials.issuer_id,
	];
}

export async function uploadAssetPacks(
	{ directory, bundle, credentials, fetcher = fetch, exec = execFileSync },
	read = appleReader(credentials, fetcher),
) {
	const archives = listArchives(directory);
	if (archives.length === 0)
		throw new Error(`No .aar asset packs found in ${directory}`);
	const app = await findApp({ bundle }, read);
	for (const archive of archives) {
		console.log(`Uploading asset pack ${archive} for app ${app.id}`);
		exec("xcrun", uploadArguments(archive, app.id, credentials), {
			stdio: "inherit",
		});
	}
	return archives.length;
}

if (
	process.argv[1] &&
	import.meta.url === pathToFileURL(process.argv[1]).href
) {
	const directory = process.argv[2];
	if (!directory) throw new Error("Usage: asset-pack-upload.mjs <aar-directory>");
	const credentials = process.env.API_KEY_PATH
		? JSON.parse(readFileSync(process.env.API_KEY_PATH, "utf8"))
		: {
				key_id: process.env.API_KEY_ID,
				issuer_id: process.env.API_ISSUER_ID,
				key: Buffer.from(process.env.API_KEY_BASE64 ?? "", "base64").toString(
					"utf8",
				),
			};
	const count = await uploadAssetPacks({
		directory,
		bundle: process.env.APP_BUNDLE_ID || "com.tanah.daily929",
		credentials,
	});
	console.log(`Uploaded ${count} asset pack(s) to App Store Connect`);
}
