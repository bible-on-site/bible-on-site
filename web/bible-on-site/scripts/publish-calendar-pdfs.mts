/**
 * Publishes generated calendar-PDF artifacts to the public assets bucket
 * (#2608).
 *
 *   bun run publish:calendar-pdf -- --yes          # real publish
 *   bun run publish:calendar-pdf                   # dry-run plan only
 *
 * Reads `.cache/calendar-pdf/{manifest.json,objects/}` (run
 * `generate:calendar-pdf` first), uploads every referenced object ahead of
 * the manifest, then flips `generated/calendar-pdf/manifest.json` — so a
 * request can never resolve to a missing object.
 *
 * Credentials are resolved by the AWS SDK chain (OIDC in CI, or the
 * S3_ACCESS_KEY_ID/S3_SECRET_ACCESS_KEY/S3_ENDPOINT vars used with local
 * RustFS). Without `--yes` nothing is uploaded — the script only prints the
 * plan, so it is safe to run anywhere.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import {
	GetObjectCommand,
	HeadObjectCommand,
	PutObjectCommand,
	S3Client,
	type S3ClientConfig,
} from "@aws-sdk/client-s3";

import {
	CALENDAR_PDF_MANIFEST_OBJECT,
	type CalendarPdfManifest,
	parseCalendarPdfManifest,
} from "../src/lib/download/calendar-pdf-plan";
import {
	type ArtifactObjectStore,
	type PutObjectOptions,
	publishCalendarPdfArtifacts,
} from "../src/lib/download/calendar-pdf-publish";

const WEBSITE_ROOT = fileURLToPath(new URL("..", import.meta.url));
const DEFAULT_DIR = join(WEBSITE_ROOT, ".cache", "calendar-pdf");

interface Args {
	dir: string;
	yes: boolean;
	bucket: string;
	prefix: string;
}

function parseArgs(argv: string[]): Args {
	const args: Args = {
		dir: DEFAULT_DIR,
		yes: false,
		bucket: process.env.S3_BUCKET || "bible-on-site-assets",
		prefix: "",
	};
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (arg === "--yes") {
			args.yes = true;
		} else if (arg === "--dir") {
			args.dir = argv[++i] ?? args.dir;
		} else if (arg === "--bucket") {
			args.bucket = argv[++i] ?? args.bucket;
		} else {
			throw new Error(`Unknown argument: ${arg}`);
		}
	}
	return args;
}

function createStore(bucket: string): ArtifactObjectStore {
	const config: S3ClientConfig = {
		region: process.env.S3_REGION || process.env.AWS_REGION || "il-central-1",
	};
	if (process.env.S3_ENDPOINT) {
		config.endpoint = process.env.S3_ENDPOINT;
		config.forcePathStyle = process.env.S3_FORCE_PATH_STYLE !== "false";
	}
	if (process.env.S3_ACCESS_KEY_ID && process.env.S3_SECRET_ACCESS_KEY) {
		config.credentials = {
			accessKeyId: process.env.S3_ACCESS_KEY_ID,
			secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
		};
	}
	const client = new S3Client(config);
	return {
		async head(key) {
			try {
				const res = await client.send(
					new HeadObjectCommand({ Bucket: bucket, Key: key }),
				);
				return { contentLength: res.ContentLength };
			} catch (error) {
				const status = (error as { $metadata?: { httpStatusCode?: number } })
					.$metadata?.httpStatusCode;
				if (status === 404 || status === 403) {
					return null;
				}
				throw error;
			}
		},
		async put(key, body, options: PutObjectOptions) {
			await client.send(
				new PutObjectCommand({
					Bucket: bucket,
					Key: key,
					Body: body,
					ContentType: options.contentType,
					ContentDisposition: options.contentDisposition,
					CacheControl: options.cacheControl,
					Metadata: options.metadata,
				}),
			);
		},
		async get(key) {
			try {
				const res = await client.send(
					new GetObjectCommand({ Bucket: bucket, Key: key }),
				);
				const body = await res.Body?.transformToByteArray();
				return body ?? null;
			} catch (error) {
				const status = (error as { $metadata?: { httpStatusCode?: number } })
					.$metadata?.httpStatusCode;
				// S3 answers 403 (not 404) for a missing object when the caller
				// lacks s3:ListBucket — the deploy role is object-scoped, so treat
				// both as absent. A genuinely denied object fails loudly on the
				// put that follows instead of silently skipping the manifest flip.
				if (status === 404 || status === 403) {
					return null;
				}
				throw error;
			}
		},
	};
}

async function main(): Promise<void> {
	const args = parseArgs(process.argv.slice(2));
	const manifestPath = join(args.dir, "manifest.json");
	const manifest: CalendarPdfManifest | null = parseCalendarPdfManifest(
		readFileSync(manifestPath, "utf8"),
	);
	if (manifest === null) {
		throw new Error(
			`${manifestPath} is missing or malformed — run generate:calendar-pdf first`,
		);
	}

	const entries = Object.entries(manifest.artifacts);
	console.log(
		`Manifest ${manifest.fingerprint.slice(0, 12)}… — ${entries.length} artifacts, generated ${manifest.generatedAt}`,
	);

	if (!args.yes) {
		console.log(
			"DRY RUN — pass --yes to upload. Plan: " +
				`${entries.length} objects → s3://${args.bucket}/generated/calendar-pdf/objects/, ` +
				`then ${CALENDAR_PDF_MANIFEST_OBJECT} (last).`,
		);
		return;
	}

	const store = createStore(args.bucket);
	const report = await publishCalendarPdfArtifacts({
		store,
		manifest,
		readObject: async (sha256) =>
			readFileSync(join(args.dir, "objects", `${sha256}.pdf`)),
	});
	console.log(
		`Published ${report.totalArtifacts} artifacts to s3://${args.bucket}: ` +
			`${report.uploaded} uploaded, ${report.alreadyPresent} already present, ` +
			`${report.verified} verified. Manifest ${report.manifestUpdated ? "updated" : "unchanged"} ` +
			`(archive: ${report.archivedManifest}).`,
	);
}

main().catch((error) => {
	console.error(error instanceof Error ? error.message : error);
	process.exitCode = 1;
});
