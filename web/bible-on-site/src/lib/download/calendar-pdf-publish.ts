/**
 * S3 publication of pre-generated calendar PDFs (#2608).
 *
 * Publication is strictly ordered so a live manifest never references a
 * missing or partial object:
 *   1. Every artifact object is uploaded to its content-addressed key
 *      (`generated/calendar-pdf/objects/<sha256>.pdf`) and HEAD-verified.
 *   2. Only then is `manifest.json` replaced (plus an immutable archived
 *      copy `manifest-<fingerprint>.json` kept for one-copy rollback).
 *   3. A final pass re-verifies every referenced object.
 *
 * Objects are immutable — identical bytes keep the same key, so uploads are
 * skipped when an object with the right size already exists. Unreferenced
 * objects are never deleted, which keeps an older manifest roll-back-able.
 *
 * The S3 client is injected behind this small interface so the orchestration
 * is unit-testable without AWS; scripts/publish-calendar-pdfs.mts adapts
 * `@aws-sdk/client-s3` (or any S3-compatible endpoint such as local RustFS).
 */

import {
	CALENDAR_PDF_MANIFEST_OBJECT,
	type CalendarPdfManifest,
	calendarPdfArchivedManifestObject,
	parseCalendarPdfManifest,
} from "./calendar-pdf-plan";

export interface PutObjectOptions {
	contentType: string;
	contentDisposition?: string;
	cacheControl?: string;
	metadata?: Record<string, string>;
}

/** Minimal object-store surface the publisher needs. */
export interface ArtifactObjectStore {
	/** Object metadata when the key exists, null when it does not. */
	head(key: string): Promise<{ contentLength?: number } | null>;
	put(key: string, body: Uint8Array, options: PutObjectOptions): Promise<void>;
	/** Object body bytes, or null when absent. */
	get(key: string): Promise<Uint8Array | null>;
}

export interface CalendarPdfPublishInput {
	store: ArtifactObjectStore;
	manifest: CalendarPdfManifest;
	/** Reads a generated object body from the local artifacts directory. */
	readObject: (sha256: string) => Promise<Uint8Array>;
	/** Number of concurrent object uploads. */
	concurrency?: number;
}

export interface CalendarPdfPublishReport {
	uploaded: number;
	alreadyPresent: number;
	verified: number;
	manifestUpdated: boolean;
	archivedManifest: string;
	totalArtifacts: number;
}

const PDF_CONTENT_TYPE = "application/pdf";
/** Content-addressed objects never change under their key. */
const IMMUTABLE_CACHE_CONTROL = "public, max-age=31536000, immutable";
/** The manifest is the publish switch — keep caches short so flips land. */
const MANIFEST_CACHE_CONTROL = "public, max-age=60";

async function mapWithConcurrency<T>(
	items: T[],
	concurrency: number,
	worker: (item: T) => Promise<void>,
): Promise<void> {
	let index = 0;
	const lanes = Array.from(
		{ length: Math.min(concurrency, items.length) },
		async () => {
			for (;;) {
				const item = items[index];
				index += 1;
				if (item === undefined) return;
				await worker(item);
			}
		},
	);
	await Promise.all(lanes);
}

/**
 * Publishes artifacts then the manifest. Throws before the manifest write on
 * any object failure, so references never switch ahead of the objects.
 */
export async function publishCalendarPdfArtifacts({
	store,
	manifest,
	readObject,
	concurrency = 8,
}: CalendarPdfPublishInput): Promise<CalendarPdfPublishReport> {
	const entries = Object.entries(manifest.artifacts);
	let uploaded = 0;
	let alreadyPresent = 0;

	// 1. Upload/verify every artifact object BEFORE touching the manifest.
	await mapWithConcurrency(entries, concurrency, async ([key, artifact]) => {
		const head = await store.head(artifact.object);
		if (head && head.contentLength === artifact.bytes) {
			alreadyPresent += 1;
			return;
		}
		const body = await readObject(artifact.sha256);
		await store.put(artifact.object, body, {
			contentType: PDF_CONTENT_TYPE,
			contentDisposition: `attachment; filename="${artifact.filename}"`,
			cacheControl: IMMUTABLE_CACHE_CONTROL,
			metadata: {
				sha256: artifact.sha256,
				"artifact-key": key,
				fingerprint: manifest.fingerprint,
			},
		});
		// A PUT that returned success can still race with listing/consistency —
		// verify the object is served before letting the manifest point at it.
		const verified = await store.head(artifact.object);
		if (!verified || verified.contentLength !== artifact.bytes) {
			throw new Error(`Artifact ${artifact.object} is not served after upload`);
		}
		uploaded += 1;
	});

	// 2. Flip the manifest only when it actually changed; archive a copy per
	// fingerprint so rollback is a single documented copy.
	const manifestBody = new TextEncoder().encode(
		`${JSON.stringify(manifest)}\n`,
	);
	const current = await store.get(CALENDAR_PDF_MANIFEST_OBJECT);
	const currentManifest =
		current === null
			? null
			: parseCalendarPdfManifest(new TextDecoder().decode(current));
	const manifestChanged =
		currentManifest === null ||
		currentManifest.fingerprint !== manifest.fingerprint ||
		JSON.stringify(currentManifest.artifacts) !==
			JSON.stringify(manifest.artifacts);
	const archivedKey = calendarPdfArchivedManifestObject(manifest.fingerprint);
	if (manifestChanged) {
		await store.put(archivedKey, manifestBody, {
			contentType: "application/json",
			cacheControl: IMMUTABLE_CACHE_CONTROL,
		});
		await store.put(CALENDAR_PDF_MANIFEST_OBJECT, manifestBody, {
			contentType: "application/json",
			cacheControl: MANIFEST_CACHE_CONTROL,
		});
	}

	// 3. Final verification: every referenced object must be served.
	let verified = 0;
	await mapWithConcurrency(entries, concurrency, async ([, artifact]) => {
		const head = await store.head(artifact.object);
		if (!head || head.contentLength !== artifact.bytes) {
			throw new Error(
				`Artifact ${artifact.object} missing or truncated after publish`,
			);
		}
		verified += 1;
	});

	return {
		uploaded,
		alreadyPresent,
		verified,
		manifestUpdated: manifestChanged,
		archivedManifest: archivedKey,
		totalArtifacts: entries.length,
	};
}
