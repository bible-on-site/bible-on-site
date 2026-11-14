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
 * The public baseline is the version Apple reports READY_FOR_SALE — the
 * truth about what store users actually run, including versions released
 * outside this automation. Features skip/failed TestFlight rounds still fall
 * inside the announcement range.
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
 * Version records Apple accepts metadata edits on. READY_FOR_SALE and
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

/** The version store users currently run — the honest public baseline. */
export async function liveVersion(appId, read) {
	const result = await read(`apps/${encodeURIComponent(appId)}/appStoreVersions`, {
		"filter[appStoreState]": "READY_FOR_SALE",
		"filter[platform]": "IOS",
		limit: "200",
	});
	const versions = result.data
		.map((v) => ({
			id: v.id,
			version: v.attributes?.versionString,
		}))
		.filter((v) => typeof v.version === "string");
	if (versions.length > 1)
		throw new Error("More than one live iOS App Store version reported");
	if (versions.length === 0) return null;
	if (!/^\d+\.\d+\.\d+$/.test(versions[0].version))
		throw new Error(
			`Live App Store version is not semver: ${versions[0].version}`,
		);
	return versions[0].version;
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
	const versions = result.data.filter(
		(v) => v.id && v.attributes?.versionString === version,
	);
	if (versions.length > 1)
		throw new Error("App Store Connect version identity is ambiguous");
	if (!versions.length) return null;
	const state = versions[0].attributes?.appStoreState;
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
	const localizations = (
		await read(
			`appStoreVersions/${encodeURIComponent(versionId)}/appStoreVersionLocalizations`,
			{ limit: "200" },
		)
	).data;
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
	const check = (
		await read(
			`appStoreVersions/${encodeURIComponent(versionId)}/appStoreVersionLocalizations`,
			{ "fields[appStoreVersionLocalizations]": "whatsNew,locale", limit: "200" },
		)
	).data.find((l) => l.id === localizationId);
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

async function main() {
	const [command, ...rest] = process.argv.slice(2);
	if (command !== "publish")
		throw new Error("Usage: appstore-whatsnew.mjs publish --version X --tag app-vX --out-dir dir");
	const args = parseArgs(rest);
	for (const required of ["version", "tag", "out-dir"])
		if (!args[required]) throw new Error(`--${required} is required`);
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
		// The public baseline is Apple's own READY_FOR_SALE version —
		// including releases this automation never touched.
		const baseline = await liveVersion(app.id, read);
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
