#!/usr/bin/env node
/**
 * Localized "What's New in this Version" for the public Apple App Store
 * (#2972).
 *
 * The pipeline never submits an app for review; it only fills the Hebrew
 * whatsNew field on the App Store version record while that record is in a
 * normally editable state. When no editable version record exists yet, the
 * generated notes still ship as an immutable release manifest so the text
 * can be applied by the next manual submission without re-deriving it.
 *
 * Ready-for-distribution records can include older available versions and
 * duplicate records of the same live version; duplicates collapse to a single
 * baseline. When several distinct versions match, bind the Hebrew notes
 * baseline to Apple's public Israeli storefront version and require one exact
 * matching Connect version. Releases outside this automation and skipped
 * TestFlight rounds stay in the notes range.
 *
 * Usage:
 *   node appstore-whatsnew.mjs publish --version 5.1.8 --tag app-v5.1.8 \
 *     --out-dir "$RUNNER_TEMP/store-notes-public"
 *
 * Auth comes from the same App Store Connect API key pilot uses
 * (API_KEY_PATH or API_KEY_ID/API_ISSUER_ID/API_KEY_BASE64). The command is
 * deliberately non-fatal for store-facing outcomes: binary delivery to
 * TestFlight already succeeded by the time this runs, so the exact result is
 * reported on stdout and in the manifest instead of flipping the deploy job
 * red — a notes write failure must not masquerade as an undelivered binary.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
	generate as generateNotes,
} from "./store-release-notes.mjs";
import { apiToken, appleReader, findApp } from "./testflight-build.mjs";

/**
 * Version records Apple accepts metadata edits on. Live distribution and
 * in-flight review states are deliberately excluded — whatsNew edits there
 * are rejected or unsafe.
 */
export const EDITABLE_STATES = [
	"PREPARE_FOR_SUBMISSION",
	"DEVELOPER_REJECTED",
	"REJECTED",
	"METADATA_REJECTED",
	"INVALID_BINARY",
];

const LOCALE = "he";
const WHATS_NEW_LIMIT = 4000;

// Apple replaced appStoreState with appVersionState; a present modern state
// takes precedence over a stale legacy value.
function versionState(version) {
	return version.attributes?.appVersionState ?? version.attributes?.appStoreState;
}

/** The states that mean "store users run this build today". */
const LIVE_STATES = ["READY_FOR_DISTRIBUTION", "READY_FOR_SALE"];

/**
 * A list response is only trustworthy whole. An explicit next page or a
 * paging total beyond the returned rows means Apple truncated the answer —
 * resolving a baseline or verifying a write against partial state would
 * guess, which is worse than blocking.
 */
function completeList(result, what) {
	const data = result?.data;
	if (!Array.isArray(data))
		throw new Error(`App Store Connect ${what} response is malformed`);
	if (
		result?.links?.next ||
		(result?.meta?.paging?.total != null &&
			result.meta.paging.total !== data.length)
	)
		throw new Error(
			`App Store Connect ${what} response is incomplete (${data.length} rows returned)`,
		);
	return data;
}

/** Sanitized one-line identity for diagnostics — never the opaque record id. */
function describeRow(row) {
	const platform = row.attributes?.platform ?? "?";
	const state = versionState(row) ?? "?";
	const version = row.attributes?.versionString ?? "(no version)";
	return `${version} [platform=${platform}, state=${state}]`;
}

function unverifiableError(rows, what) {
	return new Error(
		`App Store Connect returned ${rows.length} ${what} record(s) that cannot be classified: ` +
			`${rows.join(", ")} — verify the API response still carries platform and version-state ` +
			"attributes, then rerun the notes job",
	);
}

async function readLiveVersions(appId, read) {
	return read(`apps/${encodeURIComponent(appId)}/appStoreVersions`, {
		"filter[appVersionState]": "READY_FOR_DISTRIBUTION",
		"filter[platform]": "IOS",
		limit: "200",
	});
}

async function selectLiveVersion(result, lookupPublicVersion) {
	const versions = [];
	const unverifiable = [];
	for (const row of completeList(result, "appStoreVersions")) {
		const platform = row.attributes?.platform;
		const state = versionState(row);
		const versionString = row.attributes?.versionString;
		// Same proof rule as editableVersion: only attributes that are present
		// may exclude a row; a row that cannot be classified makes the response
		// untrustworthy rather than silently skipped.
		if (platform !== undefined && platform !== "IOS") continue;
		if (state !== undefined && !LIVE_STATES.includes(state)) continue;
		if (
			typeof row.id !== "string" ||
			!row.id ||
			platform !== "IOS" ||
			!LIVE_STATES.includes(state) ||
			typeof versionString !== "string" ||
			!versionString
		) {
			unverifiable.push(describeRow(row));
		} else {
			versions.push(row);
		}
	}
	if (unverifiable.length)
		throw unverifiableError(unverifiable, "appStoreVersions");
	// Duplicate records of one live version collapse to a single baseline: only
	// the version string is published, and every duplicate reports it
	// identically — a genuinely distinct second version stays a conflict.
	const distinct = [...new Set(versions.map((v) => v.attributes.versionString))];
	if (distinct.length === 0) return null;
	let selected = distinct[0];
	if (distinct.length > 1) {
		if (!lookupPublicVersion)
			throw new Error(
				`More than one live iOS App Store version reported: ` +
					`${versions.map(describeRow).join(", ")} — ` +
					"resolve the conflicting public version records in App Store Connect " +
					"so exactly one iOS version is live, then rerun the notes job",
			);
		const published = await lookupPublicVersion();
		const matches = distinct.filter((version) => version === published);
		if (matches.length !== 1)
			throw new Error(
				`Public Apple version ${published} does not match a live iOS App Store record ` +
					`(live candidates: ${versions.map(describeRow).join(", ")}) — ` +
					"resolve the public storefront mismatch in App Store Connect, " +
					"then rerun the notes job",
			);
		selected = matches[0];
	}
	if (!/^\d+\.\d+\.\d+$/.test(selected))
		throw new Error(
			`Live App Store version is not semver: ${selected}`,
		);
	return selected;
}

/** The version store users currently run — the honest public baseline. */
export async function liveVersion(appId, read, lookupPublicVersion) {
	return selectLiveVersion(
		await readLiveVersions(appId, read),
		lookupPublicVersion && (() => lookupPublicVersion(appId)),
	);
}

/** Resolve the current Israeli storefront version for Hebrew release notes, without credentials. */
export async function publicStoreVersion(appId, fetcher = fetch) {
	if (
		typeof appId !== "string" ||
		!/^[1-9]\d*$/.test(appId) ||
		!Number.isSafeInteger(Number(appId))
	)
		throw new Error("Invalid public Apple app identity");
	const url = new URL("https://itunes.apple.com/lookup");
	url.search = new URLSearchParams({
		id: appId,
		country: "il",
		entity: "software",
	}).toString();
	const response = await fetcher(url, {
		method: "GET",
		redirect: "error",
		signal: AbortSignal.timeout(15000),
	});
	if (!response.ok)
		throw new Error(`Public Apple lookup failed: HTTP ${response.status}`);
	const result = await response.json();
	const record = result?.results?.[0];
	if (
		result?.resultCount !== 1 ||
		!Array.isArray(result.results) ||
		result.results.length !== 1 ||
		!Number.isSafeInteger(record?.trackId) ||
		String(record.trackId) !== appId ||
		record.bundleId !== "com.tanah.daily929" ||
		record.kind !== "software" ||
		record.wrapperType !== "software" ||
		typeof record.version !== "string" ||
		!/^\d+\.\d+\.\d+$/.test(record.version)
	)
		throw new Error(
			"Public Apple app/version identity is missing or ambiguous",
		);
	return record.version;
}

/** Inspect exactly the publication query without writing metadata or selecting an ambiguous baseline. */
export async function inspectLiveVersions(appId, read, lookupPublicVersion) {
	const result = await readLiveVersions(appId, read);
	const snapshot = {
		kind: "app-store-public-version-inspection/1",
		appId,
		records: result.data.map((record) => ({
			id: record.id,
			version: record.attributes?.versionString ?? null,
			platform: record.attributes?.platform ?? null,
			appVersionState: record.attributes?.appVersionState ?? null,
			appStoreState: record.attributes?.appStoreState ?? null,
		})),
		publicBaseline: null,
		publicLookupVersion: null,
		error: null,
	};
	try {
		snapshot.publicBaseline = await selectLiveVersion(
			result,
			lookupPublicVersion &&
				(async () => {
					snapshot.publicLookupVersion = await lookupPublicVersion(appId);
					return snapshot.publicLookupVersion;
				}),
		);
	} catch (error) {
		snapshot.error = error.message;
	}
	return snapshot;
}

/**
 * The appStoreVersion record for the exact release version, when it exists
 * in a normally editable state.
 */
export async function editableVersion(appId, version, read) {
	const result = await read(`apps/${encodeURIComponent(appId)}/appStoreVersions`, {
		"filter[versionString]": version,
		"filter[platform]": "IOS",
		limit: "200",
	});
	const versions = [];
	const unverifiable = [];
	for (const row of completeList(result, "appStoreVersions")) {
		const platform = row.attributes?.platform;
		const versionString = row.attributes?.versionString;
		// Same proof rule as liveVersion: only attributes that are present may
		// exclude a row; a row that cannot be classified makes the response
		// untrustworthy rather than silently skipped.
		if (platform !== undefined && platform !== "IOS") continue;
		if (versionString !== undefined && versionString !== version) continue;
		if (
			typeof row.id !== "string" ||
			!row.id ||
			platform !== "IOS" ||
			versionString !== version
		) {
			unverifiable.push(describeRow(row));
		} else {
			versions.push(row);
		}
	}
	if (unverifiable.length)
		throw unverifiableError(unverifiable, "appStoreVersions");
	if (versions.length > 1)
		throw new Error("App Store Connect version identity is ambiguous");
	if (!versions.length) return null;
	const state = versionState(versions[0]);
	return EDITABLE_STATES.includes(state)
		? { id: versions[0].id, state }
		: { id: null, state };
}

/**
 * Write the Hebrew whatsNew on an editable version record: PATCH the
 * existing `he` localization or create it, then read the field back so the
 * accepted value is proven — never just assumed.
 */
export async function publishWhatsNew({ versionId, notes, read, write }) {
	if (notes.length > WHATS_NEW_LIMIT)
		throw new Error(
			`Notes are ${notes.length} chars, over Apple's ${WHATS_NEW_LIMIT} whatsNew limit`,
		);
	const localizations = completeList(
		await read(
			`appStoreVersions/${encodeURIComponent(versionId)}/appStoreVersionLocalizations`,
			{ limit: "200" },
		),
		"appStoreVersionLocalizations",
	);
	const hebrew = localizations.find((l) => l.attributes?.locale === LOCALE);
	let localizationId;
	if (hebrew) {
		localizationId = hebrew.id;
		await write(`appStoreVersionLocalizations/${encodeURIComponent(hebrew.id)}`, {
			method: "PATCH",
			body: {
				data: {
					type: "appStoreVersionLocalizations",
					id: hebrew.id,
					attributes: { whatsNew: notes },
				},
			},
		});
	} else {
		const created = await write("appStoreVersionLocalizations", {
			method: "POST",
			body: {
				data: {
					type: "appStoreVersionLocalizations",
					attributes: { locale: LOCALE, whatsNew: notes },
					relationships: {
						appStoreVersion: {
							data: { type: "appStoreVersions", id: versionId },
						},
					},
				},
			},
		});
		localizationId = created?.data?.id;
		if (!localizationId)
			throw new Error("Apple did not return the created localization id");
	}
	// Read back through the version's localization list: appleReader only
	// accepts array results, and the list proves what the version record
	// actually persisted.
	const check = completeList(
		await read(
			`appStoreVersions/${encodeURIComponent(versionId)}/appStoreVersionLocalizations`,
			{ "fields[appStoreVersionLocalizations]": "whatsNew,locale", limit: "200" },
		),
		"appStoreVersionLocalizations",
	).find((l) => l.id === localizationId);
	if (check?.attributes?.whatsNew !== notes)
		throw new Error("App Store Connect did not accept the exact whatsNew text");
	return { localizationId, verified: true };
}

/**
 * App Store Connect writes share the read transport but must not silently
 * retry: a PATCH that timed out may already have been applied, so the
 * read-back verification is the only safe recovery.
 */
export const appleWriter =
	(credentials, fetcher = fetch) =>
	async (pathName, { method, body }) => {
		const url = new URL(
			`https://api.appstoreconnect.apple.com/v1/${pathName}`,
		);
		const response = await fetcher(url, {
			method,
			headers: {
				Authorization: `Bearer ${apiToken(credentials)}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify(body),
			redirect: "error",
			signal: AbortSignal.timeout(30000),
		});
		if (!response.ok)
			throw new Error(
				`App Store Connect ${method} ${pathName} failed: HTTP ${response.status}`,
			);
		const result = await response.json();
		if (method === "PATCH") return result;
		if (!result.data) throw new Error("App Store Connect write returned no data");
		return result;
	};

export function appleCredentials(env = process.env) {
	return env.API_KEY_PATH
		? JSON.parse(readFileSync(env.API_KEY_PATH, "utf8"))
		: {
				key_id: env.API_KEY_ID,
				issuer_id: env.API_ISSUER_ID,
				key: Buffer.from(env.API_KEY_BASE64 ?? "", "base64").toString(
					"utf8",
				),
			};
}

function parseArgs(argv) {
	const args = {};
	for (let i = 0; i < argv.length; i++) {
		if (!argv[i].startsWith("--")) continue;
		args[argv[i].slice(2)] =
			i + 1 < argv.length && !argv[i + 1].startsWith("--")
				? argv[++i]
				: "true";
	}
	return args;
}

export async function main() {
	const [command, ...rest] = process.argv.slice(2);
	if (command !== "publish" && command !== "inspect")
		throw new Error(
			"Usage: appstore-whatsnew.mjs publish --version X --tag app-vX --out-dir dir | inspect --out-dir dir",
		);
	const args = parseArgs(rest);
	for (const required of command === "inspect"
		? ["out-dir"]
		: ["version", "tag", "out-dir"])
		if (!args[required]) throw new Error(`--${required} is required`);
	if (command === "inspect") {
		const read = appleReader(appleCredentials(), fetch, { retries: 3 });
		const app = await findApp({ bundle: "com.tanah.daily929" }, read);
		const snapshot = await inspectLiveVersions(
			app.id,
			read,
			publicStoreVersion,
		);
		mkdirSync(args["out-dir"], { recursive: true });
		writeFileSync(
			path.join(args["out-dir"], "app-store-public-version-inspection.json"),
			`${JSON.stringify(snapshot, null, 2)}\n`,
		);
		console.log(JSON.stringify(snapshot));
		return;
	}
	const repo = process.env.GITHUB_REPOSITORY;
	if (!repo) throw new Error("GITHUB_REPOSITORY is required");

	const credentials = appleCredentials();
	const read = appleReader(credentials, fetch, { retries: 3 });
	const write = appleWriter(credentials, fetch);
	const outcome = {
		manifest: null,
		publicBaseline: null,
		publication: { attempted: false },
	};
	try {
		const app = await findApp({ bundle: "com.tanah.daily929" }, read);
		// The public baseline is Apple's own ready-for-distribution version —
		// including releases this automation never touched.
		const baseline = await liveVersion(app.id, read, publicStoreVersion);
		outcome.publicBaseline = baseline;
		const manifest = generateNotes({
			repo,
			target: "app-store-public",
			version: args.version,
			tag: args.tag,
			baselineVersion: baseline,
			overrideText: process.env.STORE_NOTES_OVERRIDE || undefined,
		});
		outcome.manifest = manifest;
		const editable = manifest.notes === null
			? { id: null, state: "NO_CURATED_ENTRIES" }
			: await editableVersion(app.id, args.version, read);
		if (editable?.id) {
			outcome.publication = {
				attempted: true,
				...(await publishWhatsNew({
					versionId: editable.id,
					notes: manifest.notes,
					read,
					write,
				})),
				versionState: editable.state,
			};
		} else {
			outcome.publication = {
				attempted: false,
				reason:
					manifest.notes === null
						? "release predates curated entries"
						: `version record not editable (state: ${editable?.state ?? "absent"})`,
			};
		}
	} catch (error) {
		// Notes publication must not fail the binary deployment record or
		// block TestFlight distribution downstream: the manifest keeps the
		// failure provable, the notes reusable, and a workflow_dispatch rerun
		// retries metadata without reuploading the build.
		outcome.publication = { ...outcome.publication, error: error.message };
		console.error(
			`::error::Hebrew App Store whatsNew publish failed: ${error.message}`,
		);
	}
	const manifest = outcome.manifest ?? {
		version: args.version,
		tag: args.tag,
		target: "app-store-public",
		notes: null,
		digest: null,
	};
	mkdirSync(args["out-dir"], { recursive: true });
	writeFileSync(
		path.join(args["out-dir"], "release-notes.txt"),
		manifest.notes === null ? "" : `${manifest.notes}\n`,
	);
	writeFileSync(
		path.join(args["out-dir"], "release-notes-manifest.json"),
		`${JSON.stringify(outcome, null, 2)}\n`,
	);
	if (process.env.GITHUB_OUTPUT)
		writeFileSync(
			process.env.GITHUB_OUTPUT,
			`has_notes=${manifest.notes !== null}\nnotes_published=${outcome.publication.verified === true}\n`,
			{ flag: "a" },
		);
	console.log(
		JSON.stringify({
			publicBaseline: outcome.publicBaseline,
			versionState: outcome.publication.versionState ?? null,
			published: outcome.publication.verified === true,
			reason: outcome.publication.reason ?? null,
			error: outcome.publication.error ?? null,
			notesChars: manifest.notes?.length ?? 0,
			digest: manifest.digest,
		}),
	);
}

if (
	process.argv[1] &&
	import.meta.url === pathToFileURL(process.argv[1]).href
)
	await main();
