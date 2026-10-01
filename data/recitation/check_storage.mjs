import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { localCorsConfiguration, publicReadPolicy } from "../../devops/rustfs/config.mjs";

const require = createRequire(new URL("../../devops/package.json", import.meta.url));
const { S3Client, CreateBucketCommand, PutBucketPolicyCommand, PutObjectCommand,
	PutBucketCorsCommand, DeleteObjectCommand, DeleteBucketCommand } = require("@aws-sdk/client-s3");

// This test creates and removes only its own bucket on local RustFS.
const endpoint = new URL(process.env.S3_ENDPOINT || "http://localhost:4566");
assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(endpoint.hostname));
assert.equal(endpoint.protocol, "http:");
const client = new S3Client({
	endpoint: endpoint.href, region: "il-central-1", forcePathStyle: true,
	credentials: { accessKeyId: "test", secretAccessKey: "test_1234" },
});
const Bucket = `recitation-test-${randomUUID()}`;
const Key = "recordings/1_record.mp3";
const Body = await readFile(process.argv[2] || new URL("./fixtures/seek.mp3", import.meta.url));
let created = false;
try {
	await client.send(new CreateBucketCommand({ Bucket }));
	created = true;
	await client.send(new PutBucketCorsCommand({ Bucket, CORSConfiguration: localCorsConfiguration }));
	await client.send(new PutBucketPolicyCommand({ Bucket, Policy: publicReadPolicy(Bucket) }));
	await client.send(new PutObjectCommand({ Bucket, Key, Body, ContentType: "audio/mpeg" }));
	const url = new URL(`${Bucket}/${Key}`, endpoint);
	const head = await fetch(url, { method: "HEAD", headers: { Origin: "http://localhost:3001" } });
	assert.equal(head.headers.get("access-control-allow-origin"), "*");
	const whole = await fetch(url, { headers: { Origin: "http://localhost:3001" } });
	assert.equal(whole.headers.get("access-control-allow-origin"), "*");
	assert.deepEqual(Buffer.from(await whole.arrayBuffer()), Body);
	assert.equal(head.status, 200);
	assert.equal(head.headers.get("content-type"), "audio/mpeg");
	assert.equal(Number(head.headers.get("content-length")), Body.length);
	for (const start of [0, Math.floor(Body.length / 2)]) {
		const end = Math.min(start + 1023, Body.length - 1);
		const response = await fetch(url, { headers: { Range: `bytes=${start}-${end}` } });
		assert.equal(response.status, 206);
		assert.equal(response.headers.get("accept-ranges"), "bytes");
		assert.equal(response.headers.get("content-type"), "audio/mpeg");
		assert.equal(response.headers.get("content-range"), `bytes ${start}-${end}/${Body.length}`);
		assert.deepEqual(Buffer.from(await response.arrayBuffer()), Body.subarray(start, end + 1));
	}
	console.log("RustFS MP3 CORS, full decode download, metadata and nonzero byte ranges passed");
} finally {
	if (created) {
		await client.send(new DeleteObjectCommand({ Bucket, Key }));
		await client.send(new DeleteBucketCommand({ Bucket }));
	}
	client.destroy();
}
