/**
 * Seeds the local RustFS dev bucket only when it is empty.
 *
 * The RustFS volume and bucket are shared across worktrees, and `predev`
 * otherwise paid a release-mode cargo build plus a full bucket clear/re-upload
 * on every `npm run dev` — which also destroyed assets mirrored by
 * sync-from-prod. When the bucket already holds anything, seeding is skipped;
 * `npm run s3:populate:dev` remains the explicit force-reseed.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
	ListObjectsV2Command,
	S3Client,
} from "@aws-sdk/client-s3";

const moduleDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dataDir = resolve(moduleDir, "..", "..", "data");

// Minimal .dev.env parse — same style as devops/ensure-dev-db.mts.
const envPath = resolve(moduleDir, ".dev.env");
if (existsSync(envPath)) {
	for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
		const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
		if (!m || process.env[m[1]] !== undefined) continue;
		process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
	}
}

const bucket = process.env.S3_BUCKET ?? "bible-on-site-assets-dev";
const endpoint = process.env.S3_ENDPOINT;
if (!endpoint) {
	console.log(
		"ensure-s3-seeded: S3_ENDPOINT unset — no local seed check; run npm run s3:populate:dev to seed manually",
	);
	process.exit(0);
}

const client = new S3Client({
	endpoint,
	region: process.env.S3_REGION ?? "us-east-1",
	forcePathStyle: true,
	credentials: {
		accessKeyId: process.env.S3_ACCESS_KEY_ID ?? "test",
		secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? "test_1234",
	},
});

try {
	const res = await client.send(
		new ListObjectsV2Command({ Bucket: bucket, MaxKeys: 1 }),
	);
	if ((res.Contents?.length ?? 0) > 0) {
		console.log(
			`ensure-s3-seeded: bucket '${bucket}' already holds objects — skipping seed (npm run s3:populate:dev forces a reseed)`,
		);
		process.exit(0);
	}
} catch (err) {
	// Bucket missing or endpoint unreachable: the populator creates the bucket
	// and surfaces a real endpoint failure the same way it always did.
	console.log(
		`ensure-s3-seeded: could not inspect '${bucket}' (${err?.message ?? err}) — running populator`,
	);
} finally {
	client.destroy();
}

const result = spawnSync("cargo", ["make", "s3-populate-dev"], {
	cwd: dataDir,
	stdio: "inherit",
	shell: process.platform === "win32",
});
process.exit(result.status ?? 1);
