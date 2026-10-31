import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
	createReadStream,
	existsSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { apiAttempts, withApiRetries } from "./gh-api.mjs";
import { appleReader, findApp } from "./testflight-build.mjs";

/**
 * Uploads every managed Background Assets archive (.aar) in a directory to App
 * Store Connect via `xcrun altool --upload-asset-pack`. The packs are produced
 * by `xcrun ba-package` at app packaging time and ride the app release as
 * separate GitHub release assets — the IPA alone carries none of them.
 *
 * Apple asset-pack versions are independent of app builds: a COMPLETE version
 * whose content already matches the archive can serve a new app binary, so the
 * uploader plans per pack — reuse a verified live version, upload only changed
 * packs, or block on ambiguous remote state — and records a publication receipt
 * (asset-pack-publication.json) on the app release tying each content
 * fingerprint to the Apple pack/version that carries it.
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
	if (result == null) return { status: 0, stdout: "", stderr: "", output: "" };
	if (typeof result === "string" || Buffer.isBuffer(result))
		return {
			status: 0,
			stdout: result.toString(),
			stderr: "",
			output: result.toString(),
		};
	const stdout = (result.stdout ?? result.output?.[1] ?? "").toString();
	const stderr = (result.stderr ?? result.output?.[2] ?? "").toString();
	return {
		status: result.status ?? result.exitCode ?? 0,
		stdout,
		stderr,
		// Combined stream for diagnostics; machine readers must use `stdout`
		// alone so stderr warnings can never corrupt parsed payloads.
		output: [stdout, stderr].filter(Boolean).join("\n"),
	};
}

const defaultExec = (command, args) => {
	// Bounded, not default 1 MiB — the #2842 ENOBUFS killed receipt discovery
	// on a 2.6 MB page. The real fix is that callers now request small
	// payloads (`gh api --jq`); this cap is only a safety net for chatty
	// tools like altool.
	const result = spawnSync(command, args, {
		encoding: "utf8",
		maxBuffer: 16 * 1024 * 1024,
	});
	if (result.error) throw result.error;
	process.stdout.write(result.stdout ?? "");
	process.stderr.write(result.stderr ?? "");
	return result;
};

const HEX64 = /^[a-f0-9]{64}$/i;
const HEX32 = /^[a-f0-9]{32}$/i;
const PACK_PLAN = "asset-packs.json";
const PUBLICATION_ASSET = "asset-pack-publication.json";
// Versions that do not serve devices yet; only COMPLETE versions are live.
const IN_FLIGHT_STATES = new Set(["AWAITING_UPLOAD", "PROCESSING"]);
const INTERNAL_BETA_READY = "READY_FOR_TESTING";
const defaultSleep = (ms) =>
	new Promise((resolve) => setTimeout(resolve, ms));

async function fileDigest(file, algorithm = "sha256") {
	const hash = createHash(algorithm);
	for await (const chunk of createReadStream(file)) hash.update(chunk);
	return hash.digest("hex");
}

// ---------- Verified pack plan (produced by verify_recitation_assets.py) ----------

function validPlanEntry(entry) {
	return (
		entry != null &&
		typeof entry === "object" &&
		typeof entry.id === "string" &&
		/^[A-Za-z0-9][A-Za-z0-9-]*$/.test(entry.id) &&
		entry.archive === `${entry.id}.aar` &&
		HEX64.test(entry.archiveSha256 ?? "") &&
		Number.isSafeInteger(entry.archiveBytes) &&
		entry.archiveBytes > 0 &&
		HEX64.test(entry.contentSha256 ?? "") &&
		entry.manifest?.assetPackID === entry.id &&
		Array.isArray(entry.files) &&
		entry.files.length > 0 &&
		entry.files.every(
			(file) =>
				typeof file?.name === "string" &&
				!file.name.includes("/") &&
				!file.name.includes("\\") &&
				HEX64.test(file.sha256 ?? "") &&
				Number.isSafeInteger(file.bytes),
		)
	);
}

/**
 * Load and re-verify the release pack plan. Every required pack must be listed
 * and each listed archive must exist with its recorded digest — a plan that
 * does not match the restored release assets is never a reuse license.
 */
export async function loadPackPlan(directory, planPath = path.join(directory, PACK_PLAN)) {
	if (!existsSync(planPath)) return null;
	const plan = JSON.parse(readFileSync(planPath, "utf8"));
	if (plan?.version !== 1 || !Array.isArray(plan.packs))
		throw new Error(`${planPath}: unsupported asset-pack plan`);
	const archives = new Set(
		listArchives(directory).map((archive) => path.basename(archive)),
	);
	const seen = new Set();
	for (const entry of plan.packs) {
		if (!validPlanEntry(entry))
			throw new Error(`${planPath}: malformed asset-pack entry`);
		if (seen.has(entry.id))
			throw new Error(`${planPath}: duplicate asset-pack ${entry.id}`);
		seen.add(entry.id);
		if (!archives.has(entry.archive))
			throw new Error(`${planPath}: ${entry.archive} is missing from ${directory}`);
		archives.delete(entry.archive);
		const digest = await fileDigest(path.join(directory, entry.archive));
		if (digest !== entry.archiveSha256.toLowerCase())
			throw new Error(`${planPath}: ${entry.archive} digest does not match the verified plan`);
	}
	if (archives.size)
		throw new Error(
			`${planPath}: archives missing from the pack plan: ${[...archives].join(", ")}`,
		);
	return plan.packs.map((entry) => ({
		...entry,
		archiveSha256: entry.archiveSha256.toLowerCase(),
		contentSha256: entry.contentSha256.toLowerCase(),
	}));
}

// ---------- App Store Connect remote state ----------

function versionNumber(version) {
	const number = Number(version.attributes?.version);
	if (!Number.isSafeInteger(number) || number < 1)
		throw new Error("App Store Connect returned a malformed asset-pack version");
	return number;
}

function releaseLinkage(version, included, name, type) {
	const id = version.relationships?.[name]?.data?.id;
	if (!id) return null;
	const resource = included.find(
		(item) => item.id === id && item.type === type,
	);
	return { id, state: resource?.attributes?.state ?? null };
}

function normalizeVersion(version, included) {
	return {
		id: version.id,
		number: versionNumber(version),
		state: version.attributes?.state,
		platforms: version.attributes?.platforms ?? null,
		releases: {
			internalBeta: releaseLinkage(
				version,
				included,
				"internalBetaRelease",
				"backgroundAssetVersionInternalBetaReleases",
			),
			externalBeta: releaseLinkage(
				version,
				included,
				"externalBetaRelease",
				"backgroundAssetVersionExternalBetaReleases",
			),
			appStore: releaseLinkage(
				version,
				included,
				"appStoreRelease",
				"backgroundAssetVersionAppStoreReleases",
			),
		},
		checksum: null,
	};
}

/** The ASSET upload file carries Apple's checksum of the .aar bytes it received. */
function uploadChecksum(files) {
	const asset = files.find(
		(file) => file.attributes?.assetType === "ASSET",
	);
	if (!asset) return null;
	const attributes = asset.attributes;
	const candidates = [
		attributes.sourceFileChecksums?.file,
		attributes.sourceFileChecksums?.composite,
	].filter((entry) => entry && typeof entry.hash === "string");
	for (const entry of candidates) {
		if (
			(entry.algorithm === "SHA_256" && HEX64.test(entry.hash)) ||
			(entry.algorithm === "MD5" && HEX32.test(entry.hash))
		)
			return {
				algorithm: entry.algorithm === "SHA_256" ? "sha256" : "md5",
				hash: entry.hash.toLowerCase(),
				fileSize: attributes.fileSize ?? null,
			};
	}
	const legacy = attributes.sourceFileChecksum;
	if (typeof legacy === "string") {
		const hex = legacy.includes(":") ? legacy.split(":").pop() : legacy;
		if (HEX64.test(hex))
			return { algorithm: "sha256", hash: hex.toLowerCase(), fileSize: attributes.fileSize ?? null };
		if (HEX32.test(hex))
			return { algorithm: "md5", hash: hex.toLowerCase(), fileSize: attributes.fileSize ?? null };
	}
	return null;
}

function archiveChecksumMatches(checksum, archiveSha256, localMd5) {
	if (!checksum) return false;
	if (checksum.algorithm === "sha256")
		return checksum.hash === archiveSha256;
	return localMd5 != null && checksum.hash === localMd5;
}

async function findPack(app, identifier, read) {
	const packs = (
		await read(`apps/${encodeURIComponent(app.id)}/backgroundAssets`, {
			"filter[assetPackIdentifier]": identifier,
			"fields[backgroundAssets]": "assetPackIdentifier",
			limit: "200",
		})
	).data;
	if (packs.length > 1)
		throw new Error(
			`App Store Connect holds duplicate asset-pack records for ${identifier}`,
		);
	return packs[0] ?? null;
}

/**
 * Remote picture for one pack: its record, every version with release-channel
 * linkage, and the ASSET upload checksum of the versions that can matter —
 * the newest COMPLETE (live) version plus anything still in flight above it.
 */
export async function readRemotePack(app, identifier, read) {
	const pack = await findPack(app, identifier, read);
	if (!pack) return { pack: null, versions: [] };
	const result = await read(
		`backgroundAssets/${encodeURIComponent(pack.id)}/versions`,
		{
			// Sparse fieldsets gate relationships too — without these names the
			// release linkage IDs (and therefore beta readiness) never arrive.
			"fields[backgroundAssetVersions]":
				"version,state,platforms,internalBetaRelease,externalBetaRelease,appStoreRelease",
			include: "internalBetaRelease,externalBetaRelease,appStoreRelease",
			limit: "200",
		},
	);
	const versions = result.data.map((version) =>
		normalizeVersion(version, result.included ?? []),
	);
	const live = versions
		.filter((version) => version.state === "COMPLETE")
		.sort((a, b) => b.number - a.number)[0];
	const targets = [
		...(live ? [live] : []),
		...versions.filter(
			(version) =>
				IN_FLIGHT_STATES.has(version.state) &&
				(!live || version.number > live.number),
		),
	];
	for (const version of targets) {
		const files = (
			await read(
				`backgroundAssetVersions/${encodeURIComponent(version.id)}/backgroundAssetUploadFiles`,
				{
					"fields[backgroundAssetUploadFiles]":
						"fileName,fileSize,assetType,sourceFileChecksum,sourceFileChecksums",
					limit: "200",
				},
			)
		).data;
		version.checksum = uploadChecksum(files);
		version.fileSize =
			files.find((file) => file.attributes?.assetType === "ASSET")
				?.attributes?.fileSize ?? null;
	}
	return { pack, versions };
}

// ---------- Publication receipt ----------

function validReceiptEntry(entry) {
	return (
		entry != null &&
		typeof entry === "object" &&
		typeof entry.versionId === "string" &&
		entry.versionId.length > 0 &&
		HEX64.test(entry.contentSha256 ?? "")
	);
}

/**
 * Prior-receipt discovery outcome. `available` carries the validated entries;
 * `absent` means the search completed and no app release carries a receipt
 * (explicit bootstrap); `unavailable` means the evidence could not be read —
 * search incomplete, gh/download/network failure or a malformed receipt. Only
 * `absent` may bootstrap uploads: an `unavailable` receipt must never justify
 * publishing packs whose remote content cannot otherwise be verified.
 */
async function findPriorReceipt(github, repository, report) {
	if (!github || !repository)
		return {
			state: "unavailable",
			entries: {},
			reason: "no release repository context to search",
		};
	try {
		const tag = await github.findReceiptAsset(repository);
		if (!tag) {
			report(
				"No publication receipt on any app release; publishing under the explicit bootstrap path",
			);
			return { state: "absent", entries: {} };
		}
		const directory = mkdtempSync(path.join(tmpdir(), "pack-receipt-"));
		try {
			await github.downloadReceipt(repository, tag, directory);
			const receipt = JSON.parse(
				readFileSync(path.join(directory, PUBLICATION_ASSET), "utf8"),
			);
			if (receipt?.version !== 1 || typeof receipt.packs !== "object")
				throw new Error("unsupported publication receipt");
			// Entries are downloaded artifact data: only a well-formed tie may
			// ever serve as reuse evidence.
			const entries = Object.fromEntries(
				Object.entries(receipt.packs).filter(([, entry]) =>
					validReceiptEntry(entry),
				),
			);
			report(
				`Prior publication receipt: ${tag} (${Object.keys(entries).length} valid pack entries)`,
			);
			return { state: "available", entries };
		} finally {
			rmSync(directory, { recursive: true, force: true });
		}
	} catch (error) {
		const reason = error?.message ?? String(error);
		report(
			`::warning::Publication receipt unavailable (${reason}); packs that need receipt evidence will block, not upload`,
		);
		return { state: "unavailable", entries: {}, reason };
	}
}

/** Most recent app releases are enough for any healthy receipt, but a full
 * history scan must stay explicit when it has to give up. */
const RECEIPT_PAGE_LIMIT = 25;

/**
 * `gh api --jq` filters server output inside `gh` itself: stdout stays a few
 * hundred bytes per page no matter how large the release payload grows — the
 * #2842 ENOBUFS was spawnSync's 1 MiB buffer vs a 2.6 MB first page. Errors
 * keep stderr for the message while stdout carries only machine-readable
 * JSON, so warnings cannot corrupt the scan.
 */
const RECEIPT_SCAN_JQ = `{count: length, tags: [.[] | select(.draft == false) | select((.tag_name // "") | startswith("app-v")) | select([.assets[]?.name] | index("${PUBLICATION_ASSET}") != null) | .tag_name]}`;

/** Bounded transient retry shared by every gh call (output already parsed). */
function ghCall(exec, args, what, retryDelayMs) {
	return withApiRetries(
		() => {
			const { status, stdout, stderr } = execResult(exec("gh", args));
			if (status !== 0)
				throw new Error(`${what} failed: ${(stderr || stdout).trim()}`);
			return { stdout, stderr };
		},
		apiAttempts,
		retryDelayMs,
	);
}

const defaultGithub = (exec, { retryDelayMs = 1500 } = {}) => ({
	async findReceiptAsset(repository) {
		for (let page = 1; page <= RECEIPT_PAGE_LIMIT; page++) {
			const { stdout } = ghCall(
				exec,
				[
					"api",
					`repos/${repository}/releases?per_page=100&page=${page}`,
					"--jq",
					RECEIPT_SCAN_JQ,
				],
				`gh api releases page ${page}`,
				retryDelayMs,
			);
			const scan = JSON.parse(stdout);
			if (scan.tags.length) return scan.tags[0];
			// A short page is the end of the history — the search is complete.
			if (scan.count < 100) return null;
		}
		throw new Error(
			`publication receipt search incomplete: no receipt in the newest ${RECEIPT_PAGE_LIMIT * 100} releases`,
		);
	},
	async downloadReceipt(repository, tag, directory) {
		ghCall(
			exec,
			[
				"release",
				"download",
				tag,
				"--repo",
				repository,
				"--pattern",
				PUBLICATION_ASSET,
				"--dir",
				directory,
				"--clobber",
			],
			`gh release download ${tag}`,
			retryDelayMs,
		);
	},
	async uploadReceipt(repository, tag, file) {
		ghCall(
			exec,
			["release", "upload", tag, file, "--repo", repository, "--clobber"],
			`gh release upload ${tag}`,
			retryDelayMs,
		);
	},
});

// ---------- Per-pack plan ----------

function liveTop(versions) {
	return versions
		.filter((version) => version.state === "COMPLETE")
		.sort((a, b) => b.number - a.number)[0];
}

/** A version can only serve our app when it declares the iOS platform. */
function servesIos(version) {
	return !version?.platforms || version.platforms.includes("IOS");
}

/**
 * Classify one pack: reuse a verified live version, upload a new version, wait
 * for our own in-flight bytes, or block on state that proves neither.
 */
export function planPack(pack, remote, receiptEntry, localMd5 = null) {
	const matches = (version) =>
		version?.checksum &&
		servesIos(version) &&
		archiveChecksumMatches(version.checksum, pack.archiveSha256, localMd5);
	if (!remote.pack)
		return {
			action: "upload",
			evidence: "remote-missing",
			previousTop: 0,
			reason: "no asset-pack record on App Store Connect",
		};
	if (remote.versions.some((version) => !version.id))
		return {
			action: "blocked",
			reason: "App Store Connect returned a version without a resource id",
		};
	const top = liveTop(remote.versions);
	// An in-flight version carrying our exact archive is a previously interrupted
	// publish of this content — settle it instead of duplicating a version.
	const pending = remote.versions
		.filter(
			(version) =>
				IN_FLIGHT_STATES.has(version.state) &&
				(!top || version.number > top.number),
		)
		.sort((a, b) => b.number - a.number);
	const settling = pending.find(
		(version) => version.state === "PROCESSING" && matches(version),
	);
	if (settling)
		return {
			action: "settle",
			version: settling,
			reason: `version ${settling.number} is still processing the same content — reconciling instead of duplicating`,
		};
	if (!top) {
		const waiting = pending.some(
			(version) => version.state === "AWAITING_UPLOAD" && matches(version),
		);
		return {
			action: "upload",
			evidence: "no-live-version",
			previousTop: pending[0]?.number ?? 0,
			reason: waiting
				? "a reserved upload never completed; publishing a fresh version"
				: "no processed pack version exists",
		};
	}
	// The archive container is not the content identity: when Apple's checksum is
	// absent or differs (nondeterministic packaging), a receipt that ties this
	// exact version resource to our content fingerprint still proves reuse.
	const contentMatch =
		servesIos(top) &&
		(matches(top) ||
			(receiptEntry?.versionId === top.id &&
				receiptEntry?.contentSha256 === pack.contentSha256 &&
				(!top.checksum ||
					top.checksum.hash === receiptEntry.archiveSha256?.toLowerCase())));
	if (contentMatch) {
		const beta = top.releases.internalBeta;
		if (beta == null || beta.state === INTERNAL_BETA_READY)
			return {
				action: "reuse",
				version: top,
				reason: `live version ${top.number} carries the same content`,
			};
		return {
			action: "settle",
			version: top,
			reason: `matching live version ${top.number} is not yet ready for internal testing (${beta.state ?? "no internal-beta release"})`,
		};
	}
	// Not matching — but "not proven identical" is not "proven different".
	// Only these cases carry positive evidence for a new upload:
	if (!servesIos(top))
		return {
			action: "upload",
			evidence: "platform-unsupported",
			reason: `live version ${top.number} cannot serve iOS`,
			previousTop: top.number,
		};
	if (
		receiptEntry?.versionId === top.id &&
		receiptEntry.contentSha256 !== pack.contentSha256 &&
		(!top.checksum ||
			top.checksum.hash === receiptEntry.archiveSha256?.toLowerCase())
	)
		return {
			action: "upload",
			evidence: "receipt-differs",
			reason: `live version ${top.number} provably carries different content`,
			previousTop: top.number,
		};
	// Archive checksum differs or is absent and no trusted receipt ties this
	// version to our content: the remote bytes are unverifiable — never
	// proven changed. Whether this may still upload depends on how complete
	// the receipt evidence is (the caller blocks it when the receipt itself
	// could not be read).
	return {
		action: "upload",
		evidence: "unverifiable",
		reason: `live version ${top.number} carries unverifiable content`,
		previousTop: top.number,
	};
}

/**
 * Whether the live remote version provably carries this pack's content: an
 * exact archive checksum match, or a publication receipt that ties this exact
 * version resource to the same content fingerprint (checksum absent or
 * archive-nondeterministic).
 */
async function liveVersionMatches(top, pack, receiptEntry) {
	if (!top || !servesIos(top)) return false;
	const receiptMatch =
		receiptEntry?.versionId === top.id &&
		receiptEntry?.contentSha256 === pack.contentSha256;
	if (!top.checksum) return receiptMatch;
	if (await archiveChecksumResolved(top.checksum, pack)) return true;
	return (
		receiptMatch &&
		top.checksum.hash === receiptEntry.archiveSha256?.toLowerCase()
	);
}

/**
 * Poll until the newest COMPLETE version carries this pack's archive and is
 * ready for internal testing — the uniform proof for reuse, settled uploads
 * and fresh uploads alike. minNumber (the version number above whatever was
 * live when an upload was decided) proves a fresh upload's version even when
 * Apple exposes no checksum for it: version numbers are monotonic, so only
 * the upload we just performed could produce a newer live version.
 */
async function awaitDeliverableVersion(
	app,
	pack,
	receiptEntry,
	read,
	{ attempts, sleep, report },
	minNumber = null,
) {
	for (let attempt = 1; ; attempt++) {
		const remote = await readRemotePack(app, pack.id, read);
		const top = liveTop(remote.versions);
		// A version newer than whatever was live at decision time can only be
		// the upload this run performed — but only when Apple exposes no
		// checksum for it (a checksum mismatch proves foreign bytes). Timing
		// alone is not provenance (#2842): the reported file size MUST match
		// our archive, and it must be the ONLY checksum-less COMPLETE version
		// above the decision top — a second unattributed version means a
		// concurrent producer published in the same window and neither bytes
		// nor receipt may be claimed for it.
		const fresh =
			minNumber != null &&
			top?.number >= minNumber &&
			top.checksum == null &&
			top.fileSize === pack.archiveBytes &&
			remote.versions.filter(
				(version) =>
					version.state === "COMPLETE" &&
					version.number >= minNumber &&
					version.checksum == null,
			).length === 1;
		const matching =
			top != null &&
			(fresh || (await liveVersionMatches(top, pack, receiptEntry)));
		const beta = matching ? top.releases.internalBeta : null;
		report(
			JSON.stringify({
				phase: "asset-pack-verify",
				pack: pack.id,
				attempt,
				live: top
					? {
							version: top.number,
							state: top.state,
							contentMatch: matching,
							internalBeta: beta?.state ?? null,
						}
					: null,
			}),
		);
		if (top && matching && beta?.state === INTERNAL_BETA_READY) return top;
		if (attempt >= attempts)
			throw new Error(
				`${pack.id}: App Store Connect never reached a deliverable version matching the archive content`,
			);
		await sleep(30000);
	}
}

async function archiveChecksumResolved(checksum, pack) {
	if (checksum.algorithm === "sha256")
		return checksum.hash === pack.archiveSha256;
	return checksum.hash === (await fileDigest(pack.archivePath, "md5"));
}

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

function runUploads(packs, app, credentials, exec, report) {
	const failed = [];
	for (const pack of packs) {
		report(`Uploading asset pack ${pack.archivePath} for app ${app.id}`);
		try {
			const { status, output } = execResult(
				exec("xcrun", uploadArguments(pack.archivePath, app.id, credentials)),
			);
			if (status !== 0 || UPLOAD_FAILURE.test(output)) failed.push(pack.id);
		} catch (error) {
			failed.push(`${pack.id} (${error.message})`);
		}
	}
	if (failed.length)
		throw new Error(
			`Asset pack upload failed for ${failed.length}/${packs.length}: ${failed.join(", ")}`,
		);
}

function releaseContext(releaseTag) {
	return {
		release: releaseTag ?? null,
		ref: process.env.GITHUB_SHA ?? null,
		runId: process.env.GITHUB_RUN_ID ?? null,
		runAttempt: process.env.GITHUB_RUN_ATTEMPT ?? null,
	};
}

function receiptEntryFor(pack, result, prior, context, action) {
	const previous = prior?.[pack.id];
	return {
		contentSha256: pack.contentSha256,
		archiveSha256: pack.archiveSha256,
		archiveBytes: pack.archiveBytes,
		packId: result.packId,
		versionId: result.id,
		version: result.number,
		state: result.state,
		internalBetaRelease: result.releases.internalBeta,
		externalBetaRelease: result.releases.externalBeta,
		appStoreRelease: result.releases.appStore,
		action,
		producedBy:
			action === "uploaded"
				? context
				// Producer provenance only chains while the receipt still
				// names the same Apple version; a newer reused version was
				// produced by whoever uploaded it — unknown to us.
				: (previous?.versionId === result.id ? previous.producedBy : null) ?? {
						release: null,
						source: "apple-remote-checksum",
					},
		consumedBy: context,
	};
}

function buildReceipt(packs, results, prior, context) {
	const entries = {};
	for (const pack of packs) {
		const result = results.get(pack.id);
		if (result)
			entries[pack.id] = receiptEntryFor(
				pack,
				result,
				prior,
				context,
				result.action,
			);
	}
	return { version: 1, producedAt: new Date().toISOString(), packs: entries };
}

export async function uploadAssetPacks(
	{
		directory,
		bundle,
		credentials,
		releaseTag = null,
		repository = process.env.GITHUB_REPOSITORY ?? null,
		fetcher = fetch,
		exec = defaultExec,
		githubPolicy = {},
		github = defaultGithub(exec, githubPolicy),
		verify = verifyAssetPacks,
		attempts = 60,
		sleep = defaultSleep,
		report = console.log,
		// Bounded retry policy for the read-only Apple lookups (#2842); tests
		// inject sleeps/clocks here for deterministic retry coverage.
		readPolicy = {},
	},
	read = appleReader(credentials, fetcher, { report, ...readPolicy }),
) {
	const archives = listArchives(directory);
	if (archives.length === 0)
		throw new Error(`No .aar asset packs found in ${directory}`);
	const app = await findApp({ bundle }, read);
	const packs = await loadPackPlan(directory);

	// Releases from before the reuse migration carry no pack plan: keep the
	// unconditional upload + identifier verification they always had.
	if (!packs) {
		report(
			"::notice::No asset-pack plan on this release (pre-reuse artifacts); uploading every archive",
		);
		const failed = [];
		for (const archive of archives) {
			report(`Uploading asset pack ${archive} for app ${app.id}`);
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
		return { uploaded: archives.length, reused: 0, blocked: 0, legacy: true };
	}

	const prior = await findPriorReceipt(github, repository, report);
	const priorEntries = prior.state === "available" ? prior.entries : null;
	const withPaths = packs.map((pack) => ({
		...pack,
		archivePath: path.join(directory, pack.archive),
	}));

	// Decide the whole fleet before any write: a pack that can prove neither
	// reuse nor a needed upload blocks the publish instead of half-applying
	// it. When the receipt could not be read at all, content evidence may be
	// incomplete — a pack whose remote bytes are unverifiable must block
	// rather than "upload just in case" (#2842: the ENOBUFS receipt failure
	// turned every pack into an unneeded upload). A complete search that
	// found no receipt is the explicit bootstrap path and may still upload.
	const decisions = [];
	for (const pack of withPaths) {
		const remote = await readRemotePack(app, pack.id, read);
		// Apple may report MD5 instead of SHA-256 for the uploaded file.
		const localMd5 = remote.versions.some(
			(version) => version.checksum?.algorithm === "md5",
		)
			? await fileDigest(pack.archivePath, "md5")
			: null;
		const planned = planPack(pack, remote, priorEntries?.[pack.id], localMd5);
		const decision =
			planned.action === "upload" &&
			planned.evidence === "unverifiable" &&
			prior.state === "unavailable"
				? {
						action: "blocked",
						reason: `${planned.reason}; publication receipt is unavailable (${prior.reason})`,
					}
				: planned;
		decisions.push({ pack: { ...pack, packResourceId: remote.pack?.id }, decision });
		report(
			JSON.stringify({
				phase: "asset-pack-plan",
				pack: pack.id,
				action: decision.action,
				reason: decision.reason,
			}),
		);
	}
	const blocked = decisions.filter(({ decision }) => decision.action === "blocked");
	if (blocked.length)
		throw new Error(
			`Asset-pack publish blocked for ${blocked.length}/${decisions.length}: ${blocked
				.map(({ pack, decision }) => `${pack.id} (${decision.reason})`)
				.join(", ")}`,
		);

	const results = new Map();
	const uploads = [];
	for (const { pack, decision } of decisions) {
		if (decision.action === "upload") {
			uploads.push(pack);
			continue;
		}
		// Reuse and settle both end at the same proof: the live version carries
		// our bytes and is ready for internal testing.
		const top = await awaitDeliverableVersion(app, pack, priorEntries?.[pack.id], read, {
			attempts,
			sleep,
			report,
		});
		results.set(pack.id, {
			action: decision.action === "settle" ? "reconciled" : "reused",
			packId: pack.packResourceId,
			...top,
		});
	}
	if (uploads.length) {
		runUploads(uploads, app, credentials, exec, report);
		for (const { pack, decision } of decisions.filter(
			({ decision }) => decision.action === "upload",
		)) {
			const top = await awaitDeliverableVersion(app, pack, null, read, {
				attempts,
				sleep,
				report,
			}, (decision.previousTop ?? 0) + 1);
			results.set(pack.id, {
				action: "uploaded",
				packId: (await findPack(app, pack.id, read))?.id,
				...top,
			});
		}
	}

	const context = releaseContext(releaseTag);
	const receipt = buildReceipt(withPaths, results, priorEntries, context);
	report(
		JSON.stringify({
			phase: "asset-pack-receipt",
			...context,
			results: [...results].map(([id, result]) => ({
				pack: id,
				action: result.action,
				version: result.number,
			})),
		}),
	);
	if (releaseTag && repository && github) {
		const file = path.join(mkdtempSync(path.join(tmpdir(), "pack-publish-")), PUBLICATION_ASSET);
		writeFileSync(file, `${JSON.stringify(receipt, null, 2)}\n`, "utf8");
		await github.uploadReceipt(repository, releaseTag, file);
	}
	const counts = { uploaded: 0, reused: 0, reconciled: 0 };
	for (const { action } of results.values()) counts[action] += 1;
	report(
		`Asset packs: ${counts.uploaded} uploaded, ${counts.reused} reused, ${counts.reconciled} reconciled, ${decisions.length} verified`,
	);
	return { ...counts, verified: results.size, blocked: 0 };
}

if (
	process.argv[1] &&
	import.meta.url === pathToFileURL(process.argv[1]).href
) {
	const args = process.argv.slice(2);
	const directory = args[0];
	if (!directory) throw new Error("Usage: asset-pack-upload.mjs <aar-directory> [--release <tag>] [--repository <owner/repo>]");
	const flag = (name) => {
		const index = args.indexOf(name);
		return index === -1 ? null : args[index + 1];
	};
	const credentials = process.env.API_KEY_PATH
		? JSON.parse(readFileSync(process.env.API_KEY_PATH, "utf8"))
		: {
				key_id: process.env.API_KEY_ID,
				issuer_id: process.env.API_ISSUER_ID,
				key: Buffer.from(process.env.API_KEY_BASE64 ?? "", "base64").toString(
					"utf8",
				),
			};
	const result = await uploadAssetPacks({
		directory,
		bundle: process.env.APP_BUNDLE_ID || "com.tanah.daily929",
		credentials,
		releaseTag: flag("--release"),
		repository: flag("--repository") ?? process.env.GITHUB_REPOSITORY,
	});
	console.log(
		`Asset packs delivered: ${result.uploaded} uploaded, ${result.reused} reused, ${result.reconciled ?? 0} reconciled`,
	);
}
