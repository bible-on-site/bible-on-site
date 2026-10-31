import { spawnSync } from "node:child_process";
import { mkdirSync, rmdirSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

const localHosts = new Set(["localhost", "127.0.0.1", "[::1]", "rustfs"]);
const letters = "abcdefghijklmnopqrstuvwxyz";
const digits = "0123456789";
const alphanumeric = letters + digits;
const consistsOf = (value, characters) => value.length > 0 && [...value].every((character) => characters.includes(character));

function validBucket(bucket) {
	return typeof bucket === "string" && bucket.length >= 3 && bucket.length <= 63
		&& !bucket.includes("..") && alphanumeric.includes(bucket[0]) && alphanumeric.includes(bucket.at(-1))
		&& consistsOf(bucket, `${alphanumeric}.-`);
}

function validRegion(region) {
	if (typeof region !== "string" || region.length > 64) return false;
	const parts = region.split("-");
	return parts.length >= 3 && parts[0].length === 2 && consistsOf(parts[0], letters)
		&& parts.slice(1, -1).every((part) => consistsOf(part, letters)) && consistsOf(parts.at(-1), digits);
}

export function localAssetEnvironment(env = process.env) {
	return {
		...env,
		AWS_ACCESS_KEY_ID: env.S3_ACCESS_KEY_ID || "test",
		AWS_SECRET_ACCESS_KEY: env.S3_SECRET_ACCESS_KEY || "test_1234",
		AWS_SESSION_TOKEN: "",
		AWS_SECURITY_TOKEN: "",
	};
}

/** Keep the download cache outside checkouts so worktrees reuse unchanged bytes. */
export function assetMirrorDirectory(bucket, region, root = path.join(homedir(), ".cache", "bible-on-site", "s3-mirrors")) {
	if (!validBucket(bucket)) {
		throw new Error("Invalid source asset bucket");
	}
	if (!validRegion(region)) throw new Error("Invalid source region");
	return path.join(path.resolve(root), region, bucket);
}

/** Incrementally mirror production reads into a strictly local development bucket. */
export function syncLocalAssetMirror(
	{ sourceBucket, region, targetBucket, endpoint, cacheRoot },
	{ run = spawnSync, env = process.env } = {},
) {
	const target = assertLocalAssetTarget(endpoint, sourceBucket, targetBucket);
	const directory = assetMirrorDirectory(sourceBucket, region, cacheRoot);
	mkdirSync(directory, { recursive: true });
	const lock = `${directory}.lock`;
	try {
		mkdirSync(lock);
	} catch (error) {
		if (error.code === "EEXIST") throw new Error(`Another asset mirror is active: ${lock}. If its process exited, remove the empty lock directory and retry.`);
		throw error;
	}
	const execute = (args, commandEnv, label) => {
		const result = run("aws", args, { encoding: "utf8", env: commandEnv, stdio: ["ignore", "pipe", "pipe"] });
		if (result.error || result.status !== 0) {
			// Do not print AWS stderr: it may contain endpoint credentials or queries.
			throw new Error(`${label} failed; no completed asset sync was recorded (exit ${result.status ?? "unavailable"})`);
		}
	};
	try {
		execute(["s3", "sync", `s3://${sourceBucket}`, directory, "--delete", "--region", region, "--no-progress", "--only-show-errors"], env, "Production asset download");
		// Hold the lock until upload completes, so another worktree cannot change
		// the mirror while RustFS is reading it. Never erase it after a sync.
		execute(["s3", "sync", directory, `s3://${targetBucket}`, "--delete", "--endpoint-url", target.origin, "--region", region, "--no-progress", "--only-show-errors"], localAssetEnvironment(env), "Local asset upload");
		return directory;
	} finally {
		// Empty-directory removal only; cached files are deliberately retained.
		rmdirSync(lock);
	}
}

/** Validate before the caller starts Docker or creates the development bucket. */
export function assertLocalAssetTarget(endpoint, sourceBucket, targetBucket) {
	const target = new URL(endpoint);
	if (target.protocol !== "http:" || !localHosts.has(target.hostname) || target.username || target.password || target.pathname !== "/" || target.search || target.hash) {
		throw new Error("Asset mirror target must be a local HTTP RustFS endpoint");
	}
	if (!validBucket(targetBucket) || targetBucket === sourceBucket) {
		throw new Error("Asset mirror needs a distinct development bucket");
	}
	return target;
}
