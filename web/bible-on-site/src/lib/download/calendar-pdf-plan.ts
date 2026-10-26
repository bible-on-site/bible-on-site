/**
 * Incremental generation plan + manifest model for pre-generated calendar
 * PDFs (#2608).
 *
 * Two fingerprints keep CI fast without under-invalidating:
 *
 * - Global fingerprint (`fingerprint` in the manifest) — a hash of the
 *   renderer sources, fonts and output-affecting dependency versions. It is
 *   the shared prefix of every artifact's input sha, so a renderer/font/dep
 *   change regenerates the whole set, while the CI cache key restores the
 *   previous lineage for partial reuse.
 * - Per-artifact input sha — `sha256(globalFp | key | serialized input)` —
 *   the serialized payload is exactly what the renderer draws (titles, cell
 *   grid, resolved day labels, dimming), so a schedule/logic change only
 *   re-renders the artifacts whose drawn content actually changed.
 *
 * The object file name is the sha256 of the emitted bytes (rendering is
 * deterministic — see calendar-pdf.ts), which makes S3 uploads idempotent:
 * the same content always lands at the same additive key.
 */

import { createHash } from "node:crypto";
import type { CalendarArtifactBounds } from "./calendar-artifacts";
import type { CalendarPdfInput } from "./calendar-pdf";

export const CALENDAR_PDF_MANIFEST_VERSION = 1;

/** Bucket key prefix every calendar-pdf object and manifest lives under. */
export const CALENDAR_PDF_S3_PREFIX = "generated/calendar-pdf";
export const CALENDAR_PDF_MANIFEST_OBJECT = `${CALENDAR_PDF_S3_PREFIX}/manifest.json`;

/** Object key for a content-addressed artifact body. */
export function calendarPdfObjectKey(sha256: string): string {
	return `${CALENDAR_PDF_S3_PREFIX}/objects/${sha256}.pdf`;
}

/** Archived manifest object kept per fingerprint for instant rollback. */
export function calendarPdfArchivedManifestObject(fingerprint: string): string {
	return `${CALENDAR_PDF_S3_PREFIX}/manifest-${fingerprint}.json`;
}

export interface CalendarPdfManifestArtifact {
	/** S3 object key the artifact body is published at. */
	object: string;
	sha256: string;
	bytes: number;
	/** Download filename (Content-Disposition) stored on the object. */
	filename: string;
}

export interface CalendarPdfManifest {
	version: typeof CALENDAR_PDF_MANIFEST_VERSION;
	/** Global input fingerprint the set was generated from. */
	fingerprint: string;
	/** ISO timestamp of the generation run (metadata only). */
	generatedAt: string;
	bounds: CalendarArtifactBounds;
	artifacts: Record<string, CalendarPdfManifestArtifact>;
}

export interface CalendarPdfCacheArtifact extends CalendarPdfManifestArtifact {
	/** Per-artifact input fingerprint — see module docs. */
	inputSha: string;
}

/**
 * Local cache index kept next to the objects directory. It is what makes
 * regeneration partial: entries carry the input sha of the artifact they
 * were rendered from.
 */
export interface CalendarPdfCacheIndex {
	version: typeof CALENDAR_PDF_MANIFEST_VERSION;
	fingerprint: string;
	artifacts: Record<string, CalendarPdfCacheArtifact>;
}

function sha256Hex(data: string | Uint8Array): string {
	return createHash("sha256").update(data).digest("hex");
}

export function sha256Bytes(bytes: Uint8Array): string {
	return sha256Hex(bytes);
}

/**
 * Serializes the exact payload the renderer draws from a cell: blank column,
 * or the day's number, status, resolved dimming flag and label text. Field
 * order is fixed so the JSON is canonical.
 */
interface SerializedCell {
	b?: number;
	d?: {
		n: number;
		s: string;
		dim: boolean;
		label: string;
	};
}

function serializeCell(
	cell: CalendarPdfInput["months"][number]["cells"][number],
	input: CalendarPdfInput,
): SerializedCell {
	const day = cell.day;
	if (day === undefined) {
		return { b: cell.blankColumn ?? 0 };
	}
	const dim = input.dimmed?.(day) === true;
	return {
		d: {
			n: day.day,
			s: day.status,
			dim,
			label: day.perekId === undefined ? "" : input.dayLabel(day),
		},
	};
}

/** Canonical JSON of everything the renderer consumes for one artifact. */
export function serializeCalendarPdfInput(input: CalendarPdfInput): string {
	return JSON.stringify({
		t: input.title,
		s: input.subtitle ?? null,
		m: input.months.map((month) => ({
			t: month.title,
			c: month.cells.map((cell) => serializeCell(cell, input)),
		})),
	});
}

/**
 * Fingerprint of one artifact's complete render inputs: the global
 * fingerprint (renderer/fonts/deps/bounds logic) AND the serialized drawn
 * payload (schedule/cycle/label data as consumed). Either side changing
 * re-renders exactly the artifacts that differ.
 */
export function calendarArtifactInputSha(
	globalFingerprint: string,
	key: string,
	input: CalendarPdfInput,
): string {
	return sha256Hex(
		`${globalFingerprint}\n${key}\n${serializeCalendarPdfInput(input)}`,
	);
}

export interface CalendarArtifactPlan {
	/** Keys whose cached artifact already matches the desired inputs. */
	fresh: string[];
	/** Keys that must be (re)rendered — missing, stale or evicted object. */
	regenerate: string[];
	/** Cached entries keyed for reuse by key. */
	reused: Record<string, CalendarPdfCacheArtifact>;
}

/**
 * Splits the desired key→inputSha set into artifacts reusable from a prior
 * cache index versus ones needing a render. A cached entry is fresh only
 * when its input sha still matches AND its object file is present, so a
 * truncated/corrupt cache re-renders instead of shipping a dangling
 * reference. Entries whose keys are no longer desired are dropped (local
 * eviction; S3 objects are never deleted).
 */
export function planCalendarPdfGeneration(
	desired: ReadonlyMap<string, string>,
	cache: CalendarPdfCacheIndex | null,
	objectPresent: (sha256: string) => boolean,
): CalendarArtifactPlan {
	const fresh: string[] = [];
	const regenerate: string[] = [];
	const reused: Record<string, CalendarPdfCacheArtifact> = {};
	for (const [key, inputSha] of desired) {
		const cached = cache?.artifacts[key];
		if (
			cached !== undefined &&
			cached.inputSha === inputSha &&
			objectPresent(cached.sha256)
		) {
			fresh.push(key);
			reused[key] = cached;
		} else {
			regenerate.push(key);
		}
	}
	return { fresh, regenerate, reused };
}

export interface ParsedCacheIndexOk {
	ok: true;
	index: CalendarPdfCacheIndex;
}
export interface ParsedCacheIndexErr {
	ok: false;
	reason: string;
}

/**
 * Validates cache-state JSON. A corrupt index is treated as a cold cache by
 * callers (`null`), never as a hard failure.
 */
export function parseCalendarPdfCacheIndex(
	text: string,
): ParsedCacheIndexOk | ParsedCacheIndexErr {
	let raw: unknown;
	try {
		raw = JSON.parse(text);
	} catch {
		return { ok: false, reason: "invalid JSON" };
	}
	if (typeof raw !== "object" || raw === null) {
		return { ok: false, reason: "not an object" };
	}
	const candidate = raw as Partial<CalendarPdfCacheIndex>;
	if (candidate.version !== CALENDAR_PDF_MANIFEST_VERSION) {
		return { ok: false, reason: "unsupported cache version" };
	}
	if (typeof candidate.artifacts !== "object" || candidate.artifacts === null) {
		return { ok: false, reason: "missing artifacts map" };
	}
	for (const [key, artifact] of Object.entries(candidate.artifacts)) {
		if (
			typeof artifact !== "object" ||
			artifact === null ||
			typeof artifact.inputSha !== "string" ||
			typeof artifact.sha256 !== "string" ||
			typeof artifact.bytes !== "number" ||
			typeof artifact.filename !== "string" ||
			typeof artifact.object !== "string"
		) {
			return { ok: false, reason: `malformed artifact entry for ${key}` };
		}
	}
	return { ok: true, index: candidate as CalendarPdfCacheIndex };
}

/** Validates manifest JSON received over the wire (route + publisher). */
export function parseCalendarPdfManifest(
	text: string,
): CalendarPdfManifest | null {
	let raw: unknown;
	try {
		raw = JSON.parse(text);
	} catch {
		return null;
	}
	if (typeof raw !== "object" || raw === null) {
		return null;
	}
	const candidate = raw as Partial<CalendarPdfManifest>;
	if (
		candidate.version !== CALENDAR_PDF_MANIFEST_VERSION ||
		typeof candidate.fingerprint !== "string" ||
		typeof candidate.generatedAt !== "string" ||
		typeof candidate.bounds !== "object" ||
		candidate.bounds === null ||
		typeof candidate.artifacts !== "object" ||
		candidate.artifacts === null
	) {
		return null;
	}
	for (const artifact of Object.values(candidate.artifacts)) {
		if (
			typeof artifact !== "object" ||
			artifact === null ||
			typeof artifact.object !== "string" ||
			typeof artifact.sha256 !== "string" ||
			typeof artifact.bytes !== "number" ||
			typeof artifact.filename !== "string"
		) {
			return null;
		}
	}
	return candidate as CalendarPdfManifest;
}

/**
 * Builds the publishable manifest from generated artifacts. Object keys are
 * the content hash of the artifact bytes — additive and immutable.
 */
export function buildCalendarPdfManifest(input: {
	fingerprint: string;
	bounds: CalendarArtifactBounds;
	artifacts: Record<string, CalendarPdfCacheArtifact>;
	generatedAt: string;
}): CalendarPdfManifest {
	const artifacts: Record<string, CalendarPdfManifestArtifact> = {};
	for (const [key, artifact] of Object.entries(input.artifacts)) {
		artifacts[key] = {
			object: calendarPdfObjectKey(artifact.sha256),
			sha256: artifact.sha256,
			bytes: artifact.bytes,
			filename: artifact.filename,
		};
	}
	return {
		version: CALENDAR_PDF_MANIFEST_VERSION,
		fingerprint: input.fingerprint,
		generatedAt: input.generatedAt,
		bounds: input.bounds,
		artifacts,
	};
}
