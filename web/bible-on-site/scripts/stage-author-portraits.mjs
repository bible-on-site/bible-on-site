import { randomUUID } from "node:crypto";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const productionBucket = "bible-on-site-assets";
const assetsOrigin = `https://${productionBucket}.s3.il-central-1.amazonaws.com`;
const manifestUrl = `${assetsOrigin}/authors/caricatures/manifest.json`;
const snapshotPath = "public/generated/author-portraits.json";
const requestTimeoutMs = 5_000;
const maxParallelRequests = 8;

function isRecord(value) {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function normalizeEtag(value) {
	if (typeof value !== "string") return null;
	const etag = value.replace(/^"([^"]+)"$/, "$1");
	return /^[0-9a-f]{32}(?:-[1-9]\d*)?$/i.test(etag) ? etag.toLowerCase() : null;
}

async function readManifest(fetcher) {
	const response = await fetcher(manifestUrl, {
		cache: "no-store",
		redirect: "error",
		signal: AbortSignal.timeout(requestTimeoutMs),
	});
	if (!response.ok) {
		throw new Error(`Portrait manifest returned HTTP ${response.status}`);
	}
	const manifest = await response.json();
	if (manifest?.version !== 1 || !isRecord(manifest.portraits)) {
		throw new Error("Invalid author portrait manifest");
	}

	return Object.entries(manifest.portraits).map(([id, portrait]) => {
		const key = portrait?.key;
		const keyId =
			typeof key === "string"
				? /^authors\/caricatures\/[A-Za-z0-9][A-Za-z0-9_-]*\/high-res\/([1-9]\d*)\.png$/.exec(
						key,
					)?.[1]
				: undefined;
		const legacyEtag = normalizeEtag(portrait?.legacyEtag);
		if (keyId !== id || !Number.isSafeInteger(Number(id)) || !legacyEtag) {
			throw new Error(
				`Invalid author portrait manifest entry ${JSON.stringify(id)}`,
			);
		}
		return { id, key, legacyEtag };
	});
}

async function resolvePortrait({ id, key, legacyEtag }, fetcher) {
	const legacyKey = `authors/high-res/${id}.jpg`;
	try {
		const response = await fetcher(`${assetsOrigin}/${legacyKey}`, {
			method: "HEAD",
			cache: "no-store",
			redirect: "error",
			signal: AbortSignal.timeout(requestTimeoutMs),
		});
		if (!response.ok) {
			throw new Error(`HTTP ${response.status}`);
		}
		const currentEtag = normalizeEtag(response.headers.get("etag"));
		if (!currentEtag) {
			throw new Error("Missing or invalid JPEG ETag");
		}
		// A later admin upload still uses the historical JPEG key. Give it
		// a new optimizer URL when its bytes differ from the release baseline.
		if (currentEtag !== legacyEtag) {
			return [id, `${legacyKey}?v=${currentEtag}`];
		}
	} catch (error) {
		console.warn(
			`Could not verify ${legacyKey}. Keeping the released PNG.`,
			error,
		);
	}
	return [id, key];
}

async function writeSnapshot(cwd, snapshot) {
	const target = resolve(cwd, snapshotPath);
	const temporary = `${target}.${randomUUID()}.tmp`;
	await mkdir(dirname(target), { recursive: true });
	try {
		await writeFile(temporary, `${JSON.stringify(snapshot)}\n`);
		await rename(temporary, target);
	} catch (error) {
		await rm(temporary, { force: true });
		throw error;
	}
}

function usesFixtureDatabase(databaseUrl) {
	// CI uses tanah_test. The Playwright launcher adds a 12-digit checkout hash.
	return (
		URL.canParse(databaseUrl) &&
		/^\/tanah_test(?:_[a-f0-9]{12})?$/.test(new URL(databaseUrl).pathname)
	);
}

/** Stage one build-time snapshot for prerendered and standalone website pages. */
export async function stageAuthorPortraits({
	cwd = process.cwd(),
	env = process.env,
	fetcher = fetch,
	requireManifest = false,
} = {}) {
	let portraits = [];
	const useProductionPortraits =
		!env.S3_ENDPOINT &&
		(!env.S3_BUCKET || env.S3_BUCKET === productionBucket) &&
		!usesFixtureDatabase(env.DB_URL);
	if (useProductionPortraits) {
		try {
			portraits = await readManifest(fetcher);
		} catch (error) {
			if (requireManifest) throw error;
			console.warn(
				"Could not stage author portraits. Using legacy JPEGs.",
				error,
			);
		}
	} else if (requireManifest) {
		throw new Error(
			"Author portrait release requires a production build without fixture assets or database",
		);
	}

	const entries = [];
	for (
		let offset = 0;
		offset < portraits.length;
		offset += maxParallelRequests
	) {
		const batch = portraits.slice(offset, offset + maxParallelRequests);
		entries.push(
			...(await Promise.all(
				batch.map((portrait) => resolvePortrait(portrait, fetcher)),
			)),
		);
	}
	const snapshot = Object.fromEntries(entries);
	await writeSnapshot(cwd, snapshot);
	return snapshot;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	try {
		const snapshot = await stageAuthorPortraits({
			requireManifest: process.argv.slice(2).includes("--require"),
		});
		console.log(`Staged ${Object.keys(snapshot).length} author portraits.`);
	} catch (error) {
		console.error(error);
		process.exitCode = 1;
	}
}
