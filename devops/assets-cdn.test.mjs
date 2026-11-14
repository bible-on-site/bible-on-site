import assert from "node:assert/strict";
import test from "node:test";
import { ACCOUNT, DISABLED_CACHE, ERROR_CODES, assertOriginPolicy, distributionRequest, main, originPolicyConfig, parseArgs } from "./assets-cdn.mjs";

const id = "11111111-2222-3333-4444-555555555555";
function fixture(overrides = {}) {
	const calls = [];
	return { calls, aws(args) {
		calls.push(args);
		const operation = args[1];
		if (overrides[operation]) return overrides[operation];
		if (operation === "get-caller-identity") return { Account: ACCOUNT };
		if (operation === "get-bucket-location") return { LocationConstraint: "il-central-1" };
		if (operation === "get-bucket-policy-status") return { PolicyStatus: { IsPublic: true } };
		if (operation === "get-origin-request-policy") return { OriginRequestPolicy: { OriginRequestPolicyConfig: originPolicyConfig() } };
		assert.fail(`Unexpected AWS mutation or operation: ${operation}`);
	} };
}

test("request adds only an anonymous read-only distribution with disabled caching and no DNS aliases", () => {
	const request = distributionRequest(id, "assets-2026-11-01");
	const config = request.DistributionConfig;
	assert.equal(config.CallerReference, "assets-2026-11-01");
	assert.equal(config.DefaultCacheBehavior.CachePolicyId, DISABLED_CACHE);
	assert.deepEqual(config.DefaultCacheBehavior.AllowedMethods.Items, ["GET", "HEAD", "OPTIONS"]);
	assert.equal(config.DefaultCacheBehavior.OriginRequestPolicyId, id);
	assert.equal(config.Origins.Items[0].DomainName, "bible-on-site-assets.s3.il-central-1.amazonaws.com");
	assert.equal(config.Origins.Items[0].S3OriginConfig.OriginAccessIdentity, "");
	assert.equal(config.Aliases.Quantity, 0);
	assert.equal(config.DefaultCacheBehavior.Compress, false);
	assert.equal(config.Origins.Items[0].OriginAccessControlId, undefined);
	assert.equal(config.Logging, undefined);
	assert.equal(config.ViewerCertificate.CloudFrontDefaultCertificate, true);
	assert.deepEqual(config.CustomErrorResponses.Items, ERROR_CODES.map((ErrorCode) => ({ ErrorCode, ErrorCachingMinTTL: 0 })));
	assert.equal(config.CustomErrorResponses.Quantity, 10);
});

test("custom forwarding retains every query parameter and CORS input without cookie variants", () => {
	assertOriginPolicy(originPolicyConfig());
	for (const change of [
		{ QueryStringsConfig: { QueryStringBehavior: "none" } },
		{ CookiesConfig: { CookieBehavior: "all" } },
		{ HeadersConfig: { HeaderBehavior: "allViewer" } },
		{ HeadersConfig: { HeaderBehavior: "whitelist", Headers: { Quantity: 2, Items: ["Origin", "Access-Control-Request-Method"] } } },
	]) assert.throws(() => assertOriginPolicy({ ...originPolicyConfig(), ...change }), /Origin policy/);
	assert.throws(() => assertOriginPolicy(undefined), /Origin policy/);
});

test("generation verifies identity, public bucket and policy but makes no live write", () => {
	const io = fixture();
	const printed = [];
	const request = main(["--kind", "distribution", "--policy-id", id, "--reference", "stable-reference"], { ...io, write: (text) => printed.push(text) });
	assert.deepEqual(io.calls.map((args) => args[1]), ["get-caller-identity", "get-bucket-location", "get-bucket-policy-status", "get-origin-request-policy"]);
	assert.deepEqual(JSON.parse(printed[0]), request);
	const policyIo = fixture();
	assert.deepEqual(main(["--kind", "policy", "--profile", "chosen-profile"], { ...policyIo, write: () => {} }), originPolicyConfig());
	assert.ok(policyIo.calls.every((args) => args[args.indexOf("--profile") + 1] === "chosen-profile"));
});

test("wrong account, changed bucket region, private legacy bucket or incompatible policy stops generation", () => {
	for (const override of [
		{ "get-caller-identity": { Account: "123456789012" } },
		{ "get-bucket-location": { LocationConstraint: "us-east-1" } },
		{ "get-bucket-policy-status": { PolicyStatus: { IsPublic: false } } },
		{ "get-origin-request-policy": { OriginRequestPolicy: { OriginRequestPolicyConfig: {} } } },
	]) {
		assert.throws(() => main(["--kind", "distribution", "--policy-id", id, "--reference", "stable"], { ...fixture(override), write: () => assert.fail("Unsafe request printed") }));
	}
});

test("invalid CLI and unstable creation references fail before AWS access", () => {
	for (const args of [[], ["--apply"], ["--kind"], ["--kind", "unknown"], ["--kind", "distribution"], ["--kind", "distribution", "--policy-id", "wrong", "--reference", "stable"]]) assert.throws(() => parseArgs(args));
	for (const reference of ["", "../path", "contains spaces", "a".repeat(129)]) assert.throws(() => distributionRequest(id, reference), /reference/);
	assert.equal(parseArgs(["--kind", "policy"]).kind, "policy");
	for (const policyId of [id.replace("11111111", "g1111111"), id.replace("11111111", "1111111-"), "a".repeat(100_000)]) assert.throws(() => distributionRequest(policyId, "stable"), /UUID/);
});
