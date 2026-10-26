/**
 * Upstream collection for store metadata (#2371, resilience rework #2395).
 *
 * This module only knows how to talk to the stores and parse their answers.
 * Caching, last-known-good retention, dedupe and response deadlines live in
 * ./index.ts so this file stays usable from the build-time snapshot script
 * (scripts/collect-store-metadata.mts) without dragging in server state.
 *
 * Sources (all public, no credentials):
 * - android: play.google.com listing HTML for the IL market (gl=IL); version
 *   anchored at the "141" details key, star rating from the "Rated X.X stars"
 *   aria-label Play only renders for the Israeli market. If Play stops
 *   publishing it, rating stays null rather than fabricated.
 * - windows: Microsoft displaycatalog v7.0 product API. The published package
 *   version is decoded from the packed integers in
 *   Sku.Properties.Packages[].Version (four uint16 components). Star rating
 *   is not published — it stays null. sourceUpdatedAt carries the catalog
 *   LastModifiedDate; fetchedAt stays the actual fetch time.
 * - ios: itunes.apple.com lookup (same source the existing README badge uses).
 *
 * Upstream answers are NOT cached here (`cache: "no-store"`): a stale or
 * incomplete cached body would otherwise be re-served for hours. Freshness is
 * owned by the caller's last-known-good store.
 */

export type StorePlatform = "android" | "windows" | "ios";

/** Fields a store answer can carry; null means the parse found nothing. */
export interface StoreMetadataFields {
	version: string | null;
	rating: number | null;
	ratingCount: number | null;
	sourceUpdatedAt: string | null;
}

export interface CollectedStoreMetadata extends StoreMetadataFields {
	platform: StorePlatform;
	source: string;
	/** ISO time this collection completed — the observation time. */
	fetchedAt: string;
}

const ANDROID_URL =
	"https://play.google.com/store/apps/details?id=com.tanah.daily929&hl=en&gl=IL";
const WINDOWS_URL =
	"https://displaycatalog.mp.microsoft.com/v7.0/products/9NBLGGH6B55K?fieldsTemplate=Details&market=IL&languages=en-us";
const IOS_URL = "https://itunes.apple.com/lookup?id=1045128150&country=il";

export const STORE_METADATA_SOURCES: Record<StorePlatform, string> = {
	android: ANDROID_URL,
	windows: WINDOWS_URL,
	ios: IOS_URL,
};

const UPSTREAM_TIMEOUT_MS = 15_000;

function isDottedNumber(value: string): boolean {
	const parts = value.split(".");
	return (
		parts.length > 1 &&
		parts.every(
			(part) =>
				part.length > 0 &&
				[...part].every((char) => char >= "0" && char <= "9"),
		)
	);
}

export function parsePlayStoreHtml(html: string): {
	version: string | null;
	rating: number | null;
} {
	const version = html.match(/"141":\s*\[\[\["([^"]+)"\]\]/)?.[1] ?? null;
	// Defensive best-effort: some locales embed a "Rated X.X" label.
	const ratingText =
		html.match(/aria-label="Rated ([0-5](?:\.[0-9])?) stars/i)?.[1] ??
		html.match(/"aggregateRating"\s*:\s*([0-5](?:\.[0-9])?)/)?.[1] ??
		null;
	return {
		version: version && isDottedNumber(version) ? version : null,
		rating: ratingText === null ? null : Number(ratingText),
	};
}

export function parseItunesLookup(json: unknown): {
	version: string | null;
	rating: number | null;
	ratingCount: number | null;
} {
	const result = (json as { results?: Array<Record<string, unknown>> })
		?.results?.[0];
	return {
		version: typeof result?.version === "string" ? result.version : null,
		rating:
			typeof result?.averageUserRating === "number"
				? result.averageUserRating
				: null,
		ratingCount:
			typeof result?.userRatingCount === "number"
				? result.userRatingCount
				: null,
	};
}

async function fetchJson(url: string): Promise<unknown> {
	const response = await fetch(url, {
		cache: "no-store",
		signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
	});
	if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
	return response.json();
}

async function fetchText(url: string): Promise<string> {
	const response = await fetch(url, {
		cache: "no-store",
		signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
		headers: { "user-agent": "Mozilla/5.0 store-metadata" },
	});
	if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
	return response.text();
}

const WINDOWS_PACKAGE_COMPONENTS = 4;
const WINDOWS_PACKAGE_SHIFT = 16;

/** Packed MS package version → "major.minor.build.revision". */
function decodeWindowsPackageVersion(packed: bigint): string {
	const parts: string[] = [];
	for (let i = 0; i < WINDOWS_PACKAGE_COMPONENTS; i++) {
		const shift = BigInt(
			(WINDOWS_PACKAGE_COMPONENTS - 1 - i) * WINDOWS_PACKAGE_SHIFT,
		);
		parts.push(((packed >> shift) & 0xffffn).toString());
	}
	return parts.join(".");
}

export function parseWindowsCatalog(json: unknown): {
	version: string | null;
	sourceUpdatedAt: string | null;
} {
	const product = (json as { Product?: Record<string, unknown> })?.Product;
	const packed = (
		(product?.DisplaySkuAvailabilities ?? []) as Array<{
			Sku?: { Properties?: { Packages?: Array<{ Version?: string }> } };
		}>
	)
		.flatMap((sku) => sku.Sku?.Properties?.Packages ?? [])
		.map((pkg) => pkg.Version)
		.filter((v): v is string => typeof v === "string" && /^[0-9]+$/.test(v))
		.map((v) => BigInt(v));
	const max = packed.length
		? packed.reduce((a, b) =>
				// biome-ignore lint: Math.max rejects bigint and Number conversion loses packed version precision.
				b > a ? b : a,
			)
		: null;
	const modified = product?.LastModifiedDate;
	return {
		version: max === null ? null : decodeWindowsPackageVersion(max),
		sourceUpdatedAt: typeof modified === "string" ? modified : null,
	};
}

/**
 * One upstream collection. Throws on transport failure; an HTTP answer whose
 * parse yields no fields resolves with all-null fields so the caller can tell
 * "store unreachable" from "store answered with nothing usable".
 */
export async function collectStoreMetadata(
	platform: StorePlatform,
): Promise<CollectedStoreMetadata> {
	const base = {
		platform,
		sourceUpdatedAt: null as string | null,
		source: STORE_METADATA_SOURCES[platform],
		fetchedAt: new Date().toISOString(),
	};
	switch (platform) {
		case "android": {
			const { version, rating } = parsePlayStoreHtml(
				await fetchText(ANDROID_URL),
			);
			return { ...base, version, rating, ratingCount: null };
		}
		case "windows": {
			const parsed = parseWindowsCatalog(await fetchJson(WINDOWS_URL));
			return {
				...base,
				version: parsed.version,
				rating: null,
				ratingCount: null,
				sourceUpdatedAt: parsed.sourceUpdatedAt,
			};
		}
		case "ios": {
			const parsed = parseItunesLookup(await fetchJson(IOS_URL));
			return { ...base, ...parsed };
		}
	}
}
