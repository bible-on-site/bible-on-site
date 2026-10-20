import { spawnSync } from "node:child_process";
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

export function packIdentifier(archive) {
	return path.basename(archive).replace(/\.aar$/, "");
}

// altool reports failed uploads on stdout/stderr while still exiting 0, so an
// exit code alone cannot prove a pack landed (#2420).
const UPLOAD_FAILURE =
	/failed to upload asset pack|failed to get the list of asset packs/i;

function execResult(result) {
	if (result == null) return { status: 0, output: "" };
	if (typeof result === "string" || Buffer.isBuffer(result))
		return { status: 0, output: result.toString() };
	const output = [result.stdout, result.stderr, ...(result.output ?? [])]
		.filter(Boolean)
		.map((part) => part.toString())
		.join("\n");
	return { status: result.status ?? result.exitCode ?? 0, output };
}

const defaultExec = (command, args) => {
	const result = spawnSync(command, args, { encoding: "utf8" });
	if (result.error) throw result.error;
	process.stdout.write(result.stdout ?? "");
	process.stderr.write(result.stderr ?? "");
	return result;
};

/** Every expected pack must exist as a backgroundAssets record after upload. */
export async function verifyAssetPacks(app, archives, read) {
	const packs = (
		await read(`apps/${encodeURIComponent(app.id)}/backgroundAssets`, {
			"fields[backgroundAssets]": "assetPackIdentifier",
			limit: "200",
		})
	).data;
	const present = new Set(
		packs.map((pack) => pack.attributes?.assetPackIdentifier),
	);
	const missing = archives
		.map(packIdentifier)
		.filter((identifier) => !present.has(identifier));
	if (missing.length)
		throw new Error(
			`App Store Connect is missing uploaded asset pack(s): ${missing.join(", ")}`,
		);
}

export async function uploadAssetPacks(
	{
		directory,
		bundle,
		credentials,
		fetcher = fetch,
		exec = defaultExec,
		verify = verifyAssetPacks,
	},
	read = appleReader(credentials, fetcher),
) {
	const archives = listArchives(directory);
	if (archives.length === 0)
		throw new Error(`No .aar asset packs found in ${directory}`);
	const app = await findApp({ bundle }, read);
	const failed = [];
	for (const archive of archives) {
		console.log(`Uploading asset pack ${archive} for app ${app.id}`);
		try {
			const { status, output } = execResult(
				exec("xcrun", uploadArguments(archive, app.id, credentials)),
			);
			if (status !== 0 || UPLOAD_FAILURE.test(output))
				failed.push(packIdentifier(archive));
		} catch (error) {
			failed.push(`${packIdentifier(archive)} (${error.message})`);
		}
	}
	if (failed.length)
		throw new Error(
			`Asset pack upload failed for ${failed.length}/${archives.length}: ${failed.join(", ")}`,
		);
	await verify(app, archives, read);
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
