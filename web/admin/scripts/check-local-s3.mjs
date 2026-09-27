import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
	CreateBucketCommand,
	DeleteBucketCommand,
	DeleteObjectCommand,
	GetObjectCommand,
	HeadBucketCommand,
	ListObjectsV2Command,
	PutBucketCorsCommand,
	PutBucketPolicyCommand,
	PutObjectCommand,
	S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import {
	localCorsConfiguration,
	publicReadPolicy,
} from "../../../devops/rustfs/config.mjs";

// Never run this destructive smoke test against AWS or another remote service.
assert.ok(
	process.env.S3_ENDPOINT,
	"S3_ENDPOINT is required for local S3 checks",
);
const endpoint = new URL(process.env.S3_ENDPOINT);
assert.ok(
	["localhost", "127.0.0.1", "[::1]"].includes(endpoint.hostname),
	"S3_ENDPOINT must point to a loopback development server",
);
assert.equal(endpoint.protocol, "http:");
const client = new S3Client({
	endpoint: endpoint.href,
	region: "il-central-1",
	forcePathStyle: true,
	credentials: { accessKeyId: "test", secretAccessKey: "test_1234" },
});
const Bucket = `s3-smoke-${randomUUID()}`;
const keys = ["authors/high-res/upload.jpg", "authors/high-res/presigned.jpg"];
const body = "local S3 compatibility fixture";
let created = false;

try {
	for (const bucket of [
		"bible-on-site-assets-dev",
		"bible-on-site-assets-test",
	]) {
		await client.send(new HeadBucketCommand({ Bucket: bucket }));
		const preflight = await fetch(
			new URL(`${bucket}/cors-check.jpg`, endpoint),
			{
				method: "OPTIONS",
				headers: {
					Origin: "http://localhost:3101",
					"Access-Control-Request-Method": "PUT",
					"Access-Control-Request-Headers": "content-type,cache-control",
				},
			},
		);
		assert.equal(preflight.status, 200);
		assert.equal(
			preflight.headers.get("access-control-allow-origin"),
			"http://localhost:3101",
		);
		await preflight.text();
	}
	await client.send(new CreateBucketCommand({ Bucket }));
	created = true;
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
	await client.send(
		new PutObjectCommand({
			Bucket,
			Key: keys[0],
			Body: body,
			ContentType: "image/jpeg",
			CacheControl: "max-age=31536000",
		}),
	);
	const downloaded = await client.send(
		new GetObjectCommand({ Bucket, Key: keys[0] }),
	);
	assert.equal(await downloaded.Body.transformToString(), body);
	assert.equal(downloaded.ContentType, "image/jpeg");
	assert.equal(downloaded.CacheControl, "max-age=31536000");
	const publicUrl = new URL(`${Bucket}/${keys[0]}`, endpoint);
	const publicRead = await fetch(publicUrl);
	assert.equal(publicRead.status, 200);
	assert.equal(await publicRead.text(), body);
	const origin = "http://localhost:3101";
	const preflight = await fetch(publicUrl, {
		method: "OPTIONS",
		headers: {
			Origin: origin,
			"Access-Control-Request-Method": "PUT",
			"Access-Control-Request-Headers": "content-type,cache-control",
		},
	});
	assert.equal(preflight.status, 200);
	assert.ok(
		["*", origin].includes(
			preflight.headers.get("access-control-allow-origin"),
		),
		"Browser uploads must allow the local Admin origin",
	);
	assert.ok(
		preflight.headers.get("access-control-allow-methods").includes("PUT"),
	);
	await preflight.text();
	const anonymousWrite = await fetch(publicUrl, { method: "PUT", body });
	assert.equal(anonymousWrite.status, 403, "Anonymous writes must be denied");
	await anonymousWrite.text();

	const signedUrl = await getSignedUrl(
		client,
		new PutObjectCommand({
			Bucket,
			Key: keys[1],
			ContentType: "image/jpeg",
			CacheControl: "max-age=31536000",
		}),
		{ expiresIn: 60 },
	);
	const signedWrite = await fetch(signedUrl, {
		method: "PUT",
		headers: {
			"Content-Type": "image/jpeg",
			"Cache-Control": "max-age=31536000",
		},
		body,
	});
	assert.equal(signedWrite.status, 200, await signedWrite.text());
	const invalidUrl = new URL(signedUrl);
	invalidUrl.searchParams.set("X-Amz-Signature", "0".repeat(64));
	const invalidWrite = await fetch(invalidUrl, { method: "PUT", body });
	assert.equal(invalidWrite.status, 403, "Invalid signatures must be denied");
	await invalidWrite.text();
	const signedRead = await fetch(new URL(`${Bucket}/${keys[1]}`, endpoint));
	assert.equal(signedRead.status, 200);
	assert.equal(signedRead.headers.get("content-type"), "image/jpeg");
	assert.equal(signedRead.headers.get("cache-control"), "max-age=31536000");
	assert.equal(await signedRead.text(), body);
	const listed = await client.send(new ListObjectsV2Command({ Bucket }));
	assert.deepEqual(
		listed.Contents.map((object) => object.Key).sort(),
		[...keys].sort(),
	);
	await client.send(new DeleteObjectCommand({ Bucket, Key: keys[0] }));
	const deletedRead = await fetch(publicUrl);
	assert.equal(deletedRead.status, 404);
	await deletedRead.text();
	console.info("Local S3 compatibility checks passed");
} finally {
	try {
		if (created) {
			for (const Key of keys) {
				await client.send(new DeleteObjectCommand({ Bucket, Key }));
			}
			await client.send(new DeleteBucketCommand({ Bucket }));
		}
	} finally {
		client.destroy();
	}
}
