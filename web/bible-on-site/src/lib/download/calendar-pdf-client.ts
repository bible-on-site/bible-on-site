/**
 * Browser-side consumer of the published calendar-PDF manifest (#2622).
 *
 * A Download activation resolves the canonical artifact key against the
 * static manifest object in the assets bucket and gets the published object
 * URL back — no `/api/calendar-pdf` resolver call and no PDF bytes through
 * the website on the request path. The manifest is fetched lazily (first
 * activation only — browsing never prefetches it), held briefly, and
 * concurrent activations share a single in-flight fetch.
 */

import {
	CALENDAR_PDF_MANIFEST_OBJECT,
	type CalendarPdfManifest,
	parseCalendarPdfManifest,
} from "./calendar-pdf-manifest-model";

/** How long a fetched manifest stays hot before a click refetches it. */
export const CALENDAR_PDF_CLIENT_MANIFEST_TTL_MS = 60_000;

/** Bounded wait for the manifest — never stall the download action. */
export const CALENDAR_PDF_CLIENT_MANIFEST_TIMEOUT_MS = 5_000;

export interface CalendarPdfAsset {
	/** Absolute URL of the published PDF object. */
	url: string;
	/** Download filename the published object carries. */
	filename: string;
}

type CacheEntry = {
	fetchedAt: number;
	manifest: CalendarPdfManifest | null;
};

const manifestCache = new Map<string, CacheEntry>();
const manifestInFlight = new Map<
	string,
	Promise<CalendarPdfManifest | null>
>();

async function fetchManifest(
	manifestUrl: string,
): Promise<CalendarPdfManifest | null> {
	// Defense in depth: the caller pins manifestUrl to the fixed manifest
	// object, and the URL itself comes from server config (assetsUrl), never
	// from user input — so this fetch is not an SSRF surface.
	/* istanbul ignore next -- resolveCalendarPdfAsset gates the same suffix before getManifest runs */
	if (!manifestUrl.endsWith(CALENDAR_PDF_MANIFEST_OBJECT)) {
		return null;
	}
	try {
		// nosemgrep -- server-configured assets manifest URL pinned above to the fixed generated/calendar-pdf/manifest.json suffix; never user-controlled
		const response = await fetch(manifestUrl, {
			signal: AbortSignal.timeout(CALENDAR_PDF_CLIENT_MANIFEST_TIMEOUT_MS),
			// The manifest is the publish switch — never serve a stale copy.
			cache: "no-store",
		});
		if (!response.ok) {
			return null;
		}
		return parseCalendarPdfManifest(await response.text());
	} catch (error) {
		console.warn("calendar PDF manifest fetch failed", error);
		return null;
	}
}

/**
 * Returns the published manifest, or null when it is unreachable or
 * malformed. Results — including failures — are cached briefly so a flaky
 * connection cannot turn one click into an origin burst.
 */
async function getManifest(
	manifestUrl: string,
	now: number,
): Promise<CalendarPdfManifest | null> {
	const hit = manifestCache.get(manifestUrl);
	if (hit && now - hit.fetchedAt < CALENDAR_PDF_CLIENT_MANIFEST_TTL_MS) {
		return hit.manifest;
	}
	let pending = manifestInFlight.get(manifestUrl);
	if (!pending) {
		pending = fetchManifest(manifestUrl).finally(() => {
			manifestInFlight.delete(manifestUrl);
		});
		manifestInFlight.set(manifestUrl, pending);
	}
	const manifest = await pending;
	manifestCache.set(manifestUrl, { fetchedAt: now, manifest });
	return manifest;
}

/**
 * Resolves a canonical artifact key (`cycle:4`, `year:5785`, `month:578512`)
 * to its published object URL via the manifest at `manifestUrl`, or null when
 * the manifest is unavailable or the key is not published — callers then take
 * the legacy `/api/calendar-pdf` compatibility path, which re-checks a fresh
 * manifest server-side and answers 404/503 honestly.
 *
 * The object key is bucket-relative, so the asset base is the manifest URL
 * minus its fixed `generated/calendar-pdf/manifest.json` suffix; a manifest
 * URL that does not carry that suffix cannot resolve artifacts safely.
 */
export async function resolveCalendarPdfAsset(
	manifestUrl: string,
	artifactKey: string,
	now: number = Date.now(),
): Promise<CalendarPdfAsset | null> {
	if (!manifestUrl.endsWith(CALENDAR_PDF_MANIFEST_OBJECT)) {
		return null;
	}
	const manifest = await getManifest(manifestUrl, now);
	const artifact = manifest?.artifacts[artifactKey];
	if (!artifact) {
		return null;
	}
	const base = manifestUrl.slice(
		0,
		manifestUrl.length - CALENDAR_PDF_MANIFEST_OBJECT.length,
	);
	return { url: `${base}${artifact.object}`, filename: artifact.filename };
}

/** Test hook: drops the module-scope manifest caches between cases. */
export function resetCalendarPdfAssetCache(): void {
	manifestCache.clear();
	manifestInFlight.clear();
}
