#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Public account identifier for the wrong-account safety check, not a credential.
export const ACCOUNT = "250598594267"; // nosemgrep: generic.secrets.security.detected-aws-account-id.detected-aws-account-id
export const BUCKET = "bible-on-site-assets";
export const REGION = "il-central-1";
export const DISABLED_CACHE = "4135ea2d-6df8-44a3-9df3-4b5a84be39ad";
export const ERROR_CODES = [400, 403, 404, 405, 414, 500, 501, 502, 503, 504];
const CORS_HEADERS = ["Origin", "Access-Control-Request-Method", "Access-Control-Request-Headers"];

export function originPolicyConfig() {
	return {
		Name: "bible-on-site-assets-readonly-v1",
		Comment: "Public asset delivery: forward CORS and all queries, no cookies, no edge caching",
		HeadersConfig: { HeaderBehavior: "whitelist", Headers: { Quantity: 3, Items: CORS_HEADERS } },
		CookiesConfig: { CookieBehavior: "none" },
		QueryStringsConfig: { QueryStringBehavior: "all" },
	};
}

export function assertOriginPolicy(config) {
	const headers = config?.HeadersConfig;
	const actual = (headers?.Headers?.Items ?? []).map((name) => name.toLowerCase()).sort();
	const expected = CORS_HEADERS.map((name) => name.toLowerCase()).sort();
	if (headers?.HeaderBehavior !== "whitelist" || headers.Headers?.Quantity !== 3 || actual.join() !== expected.join() || config?.CookiesConfig?.CookieBehavior !== "none" || config?.QueryStringsConfig?.QueryStringBehavior !== "all") {
		throw new Error("Origin policy must forward all queries and exactly the three CORS headers, with no cookies");
	}
}

/** CLI request only: no existing bucket, IAM, DNS, router or ECS resource changes. */
export function distributionRequest(policyId, reference) {
	const groups = typeof policyId === "string" && policyId.length === 36 ? policyId.toLowerCase().split("-") : [];
	const lengths = [8, 4, 4, 4, 12];
	if (groups.length !== 5 || groups.some((group, index) => group.length !== lengths[index] || [...group].some((character) => !"0123456789abcdef".includes(character)))) throw new Error("--policy-id must be a CloudFront policy UUID");
	if (!/^[a-zA-Z0-9_-]{1,128}$/.test(reference ?? "")) throw new Error("--reference is required and must be a stable alphanumeric creation reference");
	return {
		DistributionConfig: {
			CallerReference: reference,
			Comment: "bible-on-site additive public asset delivery; caching disabled",
			Enabled: true,
			Aliases: { Quantity: 0 },
			Origins: { Quantity: 1, Items: [{ Id: "public-assets-s3", DomainName: `${BUCKET}.s3.${REGION}.amazonaws.com`, S3OriginConfig: { OriginAccessIdentity: "" } }] },
			DefaultCacheBehavior: {
				TargetOriginId: "public-assets-s3",
				ViewerProtocolPolicy: "redirect-to-https",
				AllowedMethods: { Quantity: 3, Items: ["GET", "HEAD", "OPTIONS"], CachedMethods: { Quantity: 2, Items: ["GET", "HEAD"] } },
				CachePolicyId: DISABLED_CACHE,
				OriginRequestPolicyId: policyId,
				Compress: false,
			},
			ViewerCertificate: { CloudFrontDefaultCertificate: true },
			CustomErrorResponses: { Quantity: ERROR_CODES.length, Items: ERROR_CODES.map((ErrorCode) => ({ ErrorCode, ErrorCachingMinTTL: 0 })) },
			PriceClass: "PriceClass_All",
			HttpVersion: "http2",
			IsIPV6Enabled: true,
		},
		Tags: { Items: [{ Key: "Project", Value: "bible-on-site" }, { Key: "Purpose", Value: "additive-assets-no-cache" }] },
	};
}

export function parseArgs(args) {
	const values = { profile: `AdministratorAccess-${ACCOUNT}` };
	for (let i = 0; i < args.length; i++) {
		const flag = args[i];
		if (!["--kind", "--policy-id", "--reference", "--profile"].includes(flag) || !args[i + 1] || args[i + 1].startsWith("--")) throw new Error(`Unknown or incomplete argument: ${flag}`);
		values[flag.slice(2)] = args[++i];
	}
	if (!["policy", "distribution"].includes(values.kind)) throw new Error("Use --kind policy or --kind distribution --policy-id UUID --reference STABLE_REFERENCE");
	if (values.kind === "distribution") distributionRequest(values["policy-id"], values.reference);
	return values;
}

/** Generate a reviewed request after read-only identity/bucket/policy preflight. */
export function main(args = process.argv.slice(2), { aws = (argv) => JSON.parse(execFileSync("aws", argv, { encoding: "utf8" })), write = console.log } = {}) {
	const options = parseArgs(args);
	const read = (service, operation, ...rest) => aws([service, operation, ...rest, "--profile", options.profile, "--region", REGION, "--output", "json", "--no-cli-pager"]);
	if (read("sts", "get-caller-identity").Account !== ACCOUNT) throw new Error(`Refusing another AWS account; expected ${ACCOUNT}`);
	if (read("s3api", "get-bucket-location", "--bucket", BUCKET).LocationConstraint !== REGION) throw new Error("Assets bucket is not in the expected Israel region");
	if (read("s3api", "get-bucket-policy-status", "--bucket", BUCKET).PolicyStatus?.IsPublic !== true) throw new Error("Legacy assets are no longer public; do not change their policy to make this plan work");
	let request = originPolicyConfig();
	if (options.kind === "distribution") {
		const policy = read("cloudfront", "get-origin-request-policy", "--id", options["policy-id"]);
		assertOriginPolicy(policy.OriginRequestPolicy?.OriginRequestPolicyConfig);
		request = distributionRequest(options["policy-id"], options.reference);
	}
	write(JSON.stringify(request, null, 2));
	return request;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
