/**
 * Wire model of the published calendar-PDF manifest (#2608), kept free of
 * Node-only imports so browser consumers (#2622) can validate the manifest
 * they fetch straight from the assets bucket without pulling `node:crypto`
 * into the client bundle.
 */

import type { CalendarArtifactBounds } from "./calendar-artifacts";

export const CALENDAR_PDF_MANIFEST_VERSION = 1;

/** Bucket key prefix every calendar-pdf object and manifest lives under. */
export const CALENDAR_PDF_S3_PREFIX = "generated/calendar-pdf";
export const CALENDAR_PDF_MANIFEST_OBJECT = `${CALENDAR_PDF_S3_PREFIX}/manifest.json`;

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

/** Validates manifest JSON received over the wire (route + consumers). */
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
