import assert from "node:assert/strict";
import {
	CreateBucketCommand,
	HeadBucketCommand,
	PutBucketCorsCommand,
	PutBucketPolicyCommand,
	S3Client,
} from "@aws-sdk/client-s3";
import { localCorsConfiguration, publicReadPolicy } from "./config.mjs";

// Only the local server or Compose service may receive these public-read policies.
if (!process.env.S3_ENDPOINT) {
	throw new Error("S3_ENDPOINT is required for local bucket initialization");
}
const endpoint = new URL(process.env.S3_ENDPOINT);
assert.ok(
	["rustfs", "localhost", "127.0.0.1", "[::1]"].includes(endpoint.hostname),
	"S3_ENDPOINT must point to the local RustFS service",
);
assert.equal(endpoint.protocol, "http:");
const client = new S3Client({
	endpoint: endpoint.href,
	region: "il-central-1",
	forcePathStyle: true,
});

try {
	for (const Bucket of [
		"bible-on-site-assets-dev",
		"bible-on-site-assets-test",
	]) {
		try {
			await client.send(new HeadBucketCommand({ Bucket }));
		} catch (error) {
			// Do not mistake credential or availability failures for a missing bucket.
			if (error.$metadata?.httpStatusCode !== 404) throw error;
			await client.send(new CreateBucketCommand({ Bucket }));
		}
		await client.send(
			new PutBucketPolicyCommand({
				Bucket,
				Policy: publicReadPolicy(Bucket),
			}),
		);
		await client.send(
			new PutBucketCorsCommand({
				Bucket,
				CORSConfiguration: localCorsConfiguration,
			}),
		);
	}
	console.info("RustFS S3 initialization complete!");
} finally {
	client.destroy();
}
