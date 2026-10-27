/**
 * Runtime access to the published calendar-PDF manifest (#2608).
 *
 * The manifest lives at `generated/calendar-pdf/manifest.json` in the shared
 * public assets bucket and is the single switch that points requests at
 * artifacts: the publisher uploads every object first, verifies them, then
 * flips this file — so a manifest that parses only ever references objects
 * that are already served.
 *
 * The route caches the parsed manifest briefly in module scope. Publishing
 * a new manifest picks it up within MANIFEST_TTL_MS without a redeploy, and
 * a burst of requests dedupes onto a single fetch.
 */

import { assetsUrl } from "@/lib/assets-url";
import {
	type CalendarPdfManifest,
	parseCalendarPdfManifest,
} from "./calendar-pdf-manifest-model";
import { CALENDAR_PDF_MANIFEST_OBJECT } from "./calendar-pdf-plan";

/** How long a fetched manifest stays hot before a request refetches it. */
export const MANIFEST_TTL_MS = 60_000;

/** Bounded wait for the manifest object — never hold a request open. */
export const MANIFEST_FETCH_TIMEOUT_MS = 5_000;

export function calendarPdfManifestUrl(): string {
	return assetsUrl(CALENDAR_PDF_MANIFEST_OBJECT);
}

let cached: { fetchedAt: number; manifest: CalendarPdfManifest | null } | null =
	null;
let inFlight: Promise<CalendarPdfManifest | null> | null = null;

async function fetchManifest(): Promise<CalendarPdfManifest | null> {
	try {
		const res = await fetch(calendarPdfManifestUrl(), {
			signal: AbortSignal.timeout(MANIFEST_FETCH_TIMEOUT_MS),
			// Never serve a CDN/browser-cached copy — the manifest is the
			// publish switch and must flip as soon as it is replaced.
			cache: "no-store",
		});
		if (!res.ok) {
			return null;
		}
		return parseCalendarPdfManifest(await res.text());
	} catch {
		return null;
	}
}

/**
 * Returns the published manifest, or null when it is unreachable or
 * malformed. Results (including failures) are cached for MANIFEST_TTL_MS so
 * an S3 hiccup cannot turn into a per-request outage; callers decide how to
 * answer their request from null vs. a parsed manifest.
 */
export async function getCalendarPdfManifest(
	now: number = Date.now(),
): Promise<CalendarPdfManifest | null> {
	if (cached && now - cached.fetchedAt < MANIFEST_TTL_MS) {
		return cached.manifest;
	}
	if (!inFlight) {
		inFlight = fetchManifest().finally(() => {
			inFlight = null;
		});
	}
	const manifest = await inFlight;
	cached = { fetchedAt: Date.now(), manifest };
	return manifest;
}

/** Test hook: drops the module-scope manifest cache between cases. */
export function resetCalendarPdfManifestCache(): void {
	cached = null;
	inFlight = null;
}
