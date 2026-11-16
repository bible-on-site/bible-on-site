import { appendFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { releasePayload } from "./release-provenance.mjs";

const appId = "9NBLGGH6B55K";
const repository = "bible-on-site/bible-on-site";
const storeOrigin = "https://manage.devcenter.microsoft.com";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class InspectionError extends Error {
	constructor(stage, code) {
		super(`${stage}: ${code}`);
		this.stage = stage;
		this.code = code;
	}
}

function requireValue(condition, code, stage = "identity") {
	if (!condition) throw new InspectionError(stage, code);
}

function field(value, name) {
	requireValue(value && typeof value === "object" && !Array.isArray(value), "INVALID_OBJECT");
	const matches = Object.keys(value).filter(key => key.toLowerCase() === name.toLowerCase());
	requireValue(matches.length <= 1, "AMBIGUOUS_PROPERTY");
	return matches.length ? value[matches[0]] : undefined;
}

function pointer(flight, name) {
	const value = field(flight, name);
	if (value == null) return null;
	const id = field(value, "id");
	requireValue(typeof id === "string" && /^\d{1,30}$/.test(id), "INVALID_SUBMISSION_POINTER");
	return id;
}

function flightIdentity(flight, flightId, version, expectedGroups) {
	const returnedId = field(flight, "flightId");
	requireValue(typeof returnedId === "string" && returnedId.toLowerCase() === flightId, "WRONG_FLIGHT");
	const name = field(flight, "friendlyName");
	requireValue(typeof name === "string" && name.startsWith(`v${version}-`), "WRONG_FLIGHT_NAME");
	const groups = field(flight, "groupIds");
	requireValue(Array.isArray(groups) && groups.every(group => typeof group === "string")
		&& JSON.stringify([...groups].sort()) === JSON.stringify(expectedGroups), "WRONG_FLIGHT_GROUP");
	return { name, published: pointer(flight, "lastPublishedFlightSubmission"), pending: pointer(flight, "pendingFlightSubmission") };
}

/** One bounded view of one CI-created flight. This helper never mutates a store or deployment. */
export async function inspectMsStore({ flightId, releaseTag, tenantId, clientId, clientSecret, githubToken, groupId }, request = fetch) {
	requireValue(typeof flightId === "string" && uuid.test(flightId), "INVALID_FLIGHT_ID", "input");
	flightId = flightId.toLowerCase();
	const version = /^app-v(\d+\.\d+\.\d+)$/.exec(releaseTag ?? "")?.[1];
	requireValue(version && version.split(".").every(part => Number(part) <= 65535), "INVALID_RELEASE_TAG", "input");
	requireValue(uuid.test(tenantId ?? "") && uuid.test(clientId ?? ""), "INVALID_AUTH_IDENTITY", "input");
	requireValue(typeof clientSecret === "string" && clientSecret.length > 0 && typeof githubToken === "string" && githubToken.length > 0, "MISSING_CREDENTIAL", "input");
	const expectedGroups = typeof groupId === "string" ? groupId.split(",").map(value => value.trim()).sort() : [];
	requireValue(expectedGroups.length > 0 && expectedGroups.every(value => value.length > 0) && new Set(expectedGroups).size === expectedGroups.length, "MISSING_GROUP_IDENTITY", "input");
	const json = async (url, options, stage) => {
		let response;
		try {
			response = await request(url, { ...options, redirect: "error", signal: AbortSignal.timeout(10000) });
		} catch {
			throw new InspectionError(stage, "REQUEST_FAILED");
		}
		requireValue(response.ok, `HTTP_${response.status}`, stage);
		try { return await response.json(); }
		catch { throw new InspectionError(stage, "INVALID_JSON"); }
	};
	const release = await json(`https://api.github.com/repos/${repository}/releases/tags/${releaseTag}`, {
		method: "GET", headers: { Authorization: `Bearer ${githubToken}`, Accept: "application/vnd.github+json" },
	}, "release");
	requireValue(release.tag_name === releaseTag && !release.draft && !release.prerelease, "UNPUBLISHED_RELEASE", "release");
	let provenance;
	try { provenance = releasePayload(release); }
	catch { throw new InspectionError("release", "INVALID_PROVENANCE"); }
	requireValue(provenance?.module_name === "app" && provenance.module_version === version, "MISSING_PROVENANCE", "release");
	const expectedVersion = `${version}.0`;
	const expectedName = `BibleOnSite_${expectedVersion}_x64.msix`;
	requireValue(Array.isArray(release.assets), "INVALID_MSIX_ASSET", "release");
	const assets = release.assets.filter(asset => asset.name === expectedName);
	requireValue(assets.length === 1 && /^sha256:[a-f0-9]{64}$/.test(assets[0].digest ?? ""), "INVALID_MSIX_ASSET", "release");

	const authentication = await json(`https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`, {
		method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
		body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, grant_type: "client_credentials", scope: `${storeOrigin}/.default` }),
	}, "authentication");
	requireValue(typeof authentication.access_token === "string" && authentication.access_token.length > 0, "MISSING_ACCESS_TOKEN", "authentication");
	const get = resource => json(`${storeOrigin}/v1.0/my/applications/${appId}/flights/${flightId}${resource}`, {
		method: "GET", headers: { Authorization: `Bearer ${authentication.access_token}`, Accept: "application/json" },
	}, "store-read");
	const before = flightIdentity(await get(""), flightId, version, expectedGroups);
	const submissionId = before.published ?? before.pending;
	requireValue(submissionId, "NO_SUBMISSION");
	const submission = await get(`/submissions/${submissionId}`);
	const submissionFlight = field(submission, "flightId");
	requireValue(field(submission, "id") === submissionId && typeof submissionFlight === "string" && submissionFlight.toLowerCase() === flightId, "WRONG_SUBMISSION");
	const status = field(submission, "status");
	requireValue(typeof status === "string" && status.length > 0, "MISSING_STATUS");
	const currentStatus = await get(`/submissions/${submissionId}/status`);
	requireValue(field(currentStatus, "status") === status, "STATUS_CHANGED_DURING_INSPECTION");
	const packages = field(submission, "flightPackages");
	requireValue(Array.isArray(packages), "INVALID_PACKAGES");
	const packageRows = packages.map(value => ({ fileName: field(value, "fileName"), version: field(value, "version"), fileStatus: field(value, "fileStatus") }));
	const matched = packageRows.filter(value => typeof value.fileName === "string" && value.fileName.split(/[\\/]/).at(-1).toLowerCase() === expectedName.toLowerCase());
	requireValue(matched.length === 1 && matched[0].version === expectedVersion, "WRONG_PACKAGE");
	const after = flightIdentity(await get(""), flightId, version, expectedGroups);
	requireValue(JSON.stringify(after) === JSON.stringify(before), "FLIGHT_POINTERS_CHANGED");
	return {
		mode: "read-only", appId, flightId, flightName: before.name, submissionId,
		selection: before.published ? "lastPublishedFlightSubmission" : "pendingFlightSubmission",
		status, published: before.published === submissionId && status === "Published" && matched[0].fileStatus === "Uploaded",
		package: matched[0], packages: packageRows, pointersStable: true, groupsVerified: true,
		hasListingMetadata: field(submission, "listings") != null,
		release: { tag: releaseTag, source: provenance.ref, ciRunId: String(provenance.ci_run_id), assetName: expectedName, assetDigest: assets[0].digest },
		verifiedAt: new Date().toISOString(),
	};
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	let receipt;
	try {
		receipt = await inspectMsStore({ flightId: process.env.FLIGHT_ID, releaseTag: process.env.RELEASE_TAG,
			tenantId: process.env.PARTNER_CENTER_TENANT_ID, clientId: process.env.PARTNER_CENTER_CLIENT_ID,
			clientSecret: process.env.PARTNER_CENTER_CLIENT_SECRET, githubToken: process.env.GH_TOKEN,
			groupId: process.env.PARTNER_CENTER_FLIGHT_GROUP_ID });
	} catch (error) {
		receipt = { mode: "read-only", result: "failed", stage: error instanceof InspectionError ? error.stage : "inspection", code: error instanceof InspectionError ? error.code : "UNEXPECTED_FAILURE" };
		process.exitCode = 1;
	}
	writeFileSync(process.env.RECEIPT_PATH, `${JSON.stringify(receipt, null, 2)}\n`);
	console.log(JSON.stringify(receipt));
	if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY,
		`Microsoft flight inspection: ${receipt.result === "failed" ? `failed (${receipt.stage}/${receipt.code})` : `${receipt.status}; published=${receipt.published}; package=${receipt.package.version}`}\n`);
}
