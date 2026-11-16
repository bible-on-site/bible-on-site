import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { parse } from "yaml";
import { InspectionError, inspectMsStore } from "./msstore-status.mjs";

const flightId = "34d906ff-d975-495f-85b9-e826c9e3f21c";
const input = { flightId, releaseTag: "app-v5.1.22", tenantId: "11111111-1111-4111-8111-111111111111",
	clientId: "22222222-2222-4222-8222-222222222222", clientSecret: "not-a-real-secret", githubToken: "fixture-token", groupId: "fixture-group" };
const flight = { flightId, friendlyName: "v5.1.22-20261116-100828", groupIds: [input.groupId], lastPublishedFlightSubmission: { id: "1152921504621243649" }, pendingFlightSubmission: null };
const submission = { id: "1152921504621243649", flightId, status: "Published",
	flightPackages: [{ fileName: "BibleOnSite_5.1.22.0_x64.msix", version: "5.1.22.0", fileStatus: "Uploaded" }] };
const release = { tag_name: input.releaseTag, draft: false, prerelease: false,
	body: `<!-- release-delivery:${JSON.stringify({ ref: "a".repeat(40), module_name: "app", module_version: "5.1.22", ci_run_id: "10" })} -->`,
	assets: [{ name: "BibleOnSite_5.1.22.0_x64.msix", digest: `sha256:${"d".repeat(64)}` }] };

function fixture(overrides = {}) {
	const calls = [];
	let flightReads = 0;
	const request = async (url, options) => {
		calls.push({ url, options });
		let value;
		if (url.startsWith("https://api.github.com/")) value = overrides.release ?? release;
		else if (url.startsWith("https://login.microsoftonline.com/")) value = { access_token: "fixture-store-token" };
		else if (url.endsWith("/status")) value = overrides.status ?? { status: (overrides.submission ?? submission).status };
		else if (url.includes("/submissions/")) value = overrides.submission ?? submission;
		else { flightReads++; value = flightReads === 1 ? (overrides.flight ?? flight) : (overrides.after ?? overrides.flight ?? flight); }
		return { ok: true, status: 200, json: async () => structuredClone(value) };
	};
	return { calls, request };
}

test("inspection proves the immutable published package, stable pointers and configured group without store writes", async () => {
	const { calls, request } = fixture();
	const result = await inspectMsStore(input, request);
	assert.equal(result.published, true);
	assert.equal(result.status, "Published");
	assert.equal(result.package.version, "5.1.22.0");
	assert.equal(result.release.source, "a".repeat(40));
	assert.equal(result.release.assetDigest, `sha256:${"d".repeat(64)}`);
	assert.equal(result.hasListingMetadata, false);
	assert.equal(result.groupsVerified, true);
	assert.equal(calls.length, 6);
	assert.deepEqual(calls.map(call => call.options.method), ["GET", "POST", "GET", "GET", "GET", "GET"]);
	const authentication = calls[1];
	assert.equal(authentication.url, `https://login.microsoftonline.com/${input.tenantId}/oauth2/v2.0/token`);
	assert.equal(authentication.options.body.get("scope"), "https://manage.devcenter.microsoft.com/.default");
	assert.equal(authentication.options.body.get("client_secret"), input.clientSecret);
	for (const call of calls) {
		assert.equal(call.options.redirect, "error");
		assert.ok(call.options.signal instanceof AbortSignal);
	}
	for (const call of calls.slice(2)) {
		assert.ok(call.url.startsWith(`https://manage.devcenter.microsoft.com/v1.0/my/applications/9NBLGGH6B55K/flights/${flightId}`));
		assert.equal(call.options.headers.Authorization, "Bearer fixture-store-token");
		assert.equal(call.options.body, undefined);
	}
	assert.doesNotMatch(JSON.stringify(result), /fixture-group|fixture-token|fixture-store-token|not-a-real-secret/);
});

for (const status of ["CommitStarted", "PendingCommit", "PreProcessing", "CommitFailed", "CertificationFailed"]) {
	test(`${status} is a truthful pending or failed store state, never a published receipt`, async () => {
		const pending = { ...flight, lastPublishedFlightSubmission: null, pendingFlightSubmission: { id: submission.id } };
		const result = await inspectMsStore(input, fixture({ flight: pending, submission: { ...submission, status } }).request);
		assert.equal(result.published, false);
		assert.equal(result.status, status);
		assert.equal(result.selection, "pendingFlightSubmission");
	});
}

test("a new pending pointer cannot hide the exact already published submission", async () => {
	const current = { ...flight, pendingFlightSubmission: { id: "1152921504621243650" } };
	const { calls, request } = fixture({ flight: current });
	assert.equal((await inspectMsStore(input, request)).published, true);
	assert.ok(calls[3].url.endsWith(`/submissions/${submission.id}`));
});

test("Published with an unuploaded package cannot claim package delivery", async () => {
	const result = await inspectMsStore(input, fixture({ submission: { ...submission, flightPackages: [{ ...submission.flightPackages[0], fileStatus: "PendingUpload" }] } }).request);
	assert.equal(result.published, false);
});

for (const [name, overrides, code] of [
	["wrong flight", { flight: { ...flight, flightId: "33333333-3333-4333-8333-333333333333" } }, "WRONG_FLIGHT"],
	["wrong name", { flight: { ...flight, friendlyName: "v5.1.21-another-release" } }, "WRONG_FLIGHT_NAME"],
	["wrong group", { flight: { ...flight, groupIds: ["other-group"] } }, "WRONG_FLIGHT_GROUP"],
	["missing pointer", { flight: { ...flight, lastPublishedFlightSubmission: null } }, "NO_SUBMISSION"],
	["untrusted pointer", { flight: { ...flight, lastPublishedFlightSubmission: { id: "../another" } } }, "INVALID_SUBMISSION_POINTER"],
	["wrong submission", { submission: { ...submission, id: "1152921504621243650" } }, "WRONG_SUBMISSION"],
	["wrong submission flight", { submission: { ...submission, flightId: "33333333-3333-4333-8333-333333333333" } }, "WRONG_SUBMISSION"],
	["wrong package version", { submission: { ...submission, flightPackages: [{ ...submission.flightPackages[0], version: "5.1.21.0" }] } }, "WRONG_PACKAGE"],
	["wrong package name", { submission: { ...submission, flightPackages: [{ ...submission.flightPackages[0], fileName: "another.msix" }] } }, "WRONG_PACKAGE"],
	["ambiguous package", { submission: { ...submission, flightPackages: [...submission.flightPackages, ...submission.flightPackages] } }, "WRONG_PACKAGE"],
	["missing packages", { submission: { ...submission, flightPackages: null } }, "INVALID_PACKAGES"],
	["changed status", { status: { status: "CommitStarted" } }, "STATUS_CHANGED_DURING_INSPECTION"],
	["changed pointer", { after: { ...flight, pendingFlightSubmission: { id: "1152921504621243650" } } }, "FLIGHT_POINTERS_CHANGED"],
	["ambiguous fields", { flight: { ...flight, FlightId: flightId } }, "AMBIGUOUS_PROPERTY"],
	["draft release", { release: { ...release, draft: true } }, "UNPUBLISHED_RELEASE"],
	["wrong release", { release: { ...release, tag_name: "app-v5.1.21" } }, "UNPUBLISHED_RELEASE"],
	["missing provenance", { release: { ...release, body: "" } }, "MISSING_PROVENANCE"],
	["missing digest", { release: { ...release, assets: [{ ...release.assets[0], digest: null }] } }, "INVALID_MSIX_ASSET"],
]) {
	test(`${name} cannot produce a delivery receipt`, async () => {
		await assert.rejects(inspectMsStore(input, fixture(overrides).request), error => error instanceof InspectionError && error.code === code);
	});
}

for (const overrides of [{ flightId: "../anything" }, { releaseTag: "master" }, { tenantId: "secret-value-not-an-id" }, { clientSecret: "" }, { githubToken: "" }, { groupId: "" }]) {
	test(`invalid inputs are rejected before any authenticated request: ${Object.keys(overrides)[0]}`, async () => {
		let calls = 0;
		await assert.rejects(inspectMsStore({ ...input, ...overrides }, async () => { calls++; throw new Error("must not run"); }), InspectionError);
		assert.equal(calls, 0);
	});
}

test("authorization and malformed responses fail once without exposing credential-bearing bodies", async () => {
	for (const failure of ["http", "json", "network"]) {
		let calls = 0;
		const request = async () => {
			calls++;
			if (failure === "network") throw new Error(input.clientSecret);
			return { ok: failure !== "http", status: 401, json: async () => { throw new Error(input.clientSecret); } };
		};
		await assert.rejects(inspectMsStore(input, request), error => error instanceof InspectionError && !error.message.includes(input.clientSecret));
		assert.equal(calls, 1);
	}
});

test("inspection workflow is manual, master-only, contents-read and never calls publication tooling", () => {
	const workflow = parse(readFileSync(new URL("../../../.github/workflows/msstore-status.yml", import.meta.url), "utf8"));
	assert.deepEqual(Object.keys(workflow.on), ["workflow_dispatch"]);
	assert.deepEqual(workflow.permissions, { contents: "read" });
	assert.match(workflow.jobs.inspect.if, /github\.ref == 'refs\/heads\/master'/);
	const commands = workflow.jobs.inspect.steps.filter(step => step.run).map(step => step.run);
	assert.deepEqual(commands, ["node devops/github/release/msstore-status.mjs"]);
	assert.doesNotMatch(commands.join("\n"), /publish|deploy|delete|update/i);
});
