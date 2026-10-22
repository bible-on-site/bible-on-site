/**
 * Store metadata for README badges and machine-readable lookups (#2371).
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
 * Upstream responses are cached per process (24 h) and Next revalidates the
 * fetch (6 h). A failed fetch serves the last good value with stale: true;
 * when nothing is cached, fields are null and stale stays true — never a
 * fabricated zero.
 */

export interface StoreMetadata {
	platform: "android" | "windows" | "ios";
	version: string | null;
	/** Star rating on ratingScale; null when the store does not publish it. */
	rating: number | null;
	ratingScale: 5;
	ratingCount: number | null;
	source: string;
	/** ISO time the upstream source last answered successfully. */
	fetchedAt: string | null;
	/** ISO time the source catalog reports its data last modified (windows). */
	sourceUpdatedAt: string | null;
	/** True when serving a cached value or no upstream answer ever landed. */
	stale: boolean;
}

const ANDROID_URL =
	"https://play.google.com/store/apps/details?id=com.tanah.daily929&hl=en&gl=IL";
const WINDOWS_URL =
	"https://displaycatalog.mp.microsoft.com/v7.0/products/9NBLGGH6B55K?fieldsTemplate=Details&market=IL&languages=en-us";
const IOS_URL = "https://itunes.apple.com/lookup?id=1045128150&country=il";

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

const REVALIDATE_SECONDS = 6 * 60 * 60;
const STALE_MS = 24 * 60 * 60 * 1000;

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

const cache = new Map<StoreMetadata["platform"], StoreMetadata>();

async function fetchJson(url: string): Promise<unknown> {
	const response = await fetch(url, {
		next: { revalidate: REVALIDATE_SECONDS },
		signal: AbortSignal.timeout(15_000),
	});
	if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
	return response.json();
}

async function fetchText(url: string): Promise<string> {
	const response = await fetch(url, {
		next: { revalidate: REVALIDATE_SECONDS },
		signal: AbortSignal.timeout(15_000),
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
				// biome-ignore lint/complexity/useMathMinMax: Math.max rejects bigint and Number conversion loses packed version precision.
				b > a ? b : a,
			)
		: null;
	const modified = product?.LastModifiedDate;
	return {
		version: max === null ? null : decodeWindowsPackageVersion(max),
		sourceUpdatedAt: typeof modified === "string" ? modified : null,
	};
}

async function collect(
	platform: StoreMetadata["platform"],
): Promise<Omit<StoreMetadata, "stale">> {
	const base = {
		platform,
		ratingScale: 5 as const,
		sourceUpdatedAt: null as string | null,
	};
	switch (platform) {
		case "android": {
			const { version, rating } = parsePlayStoreHtml(
				await fetchText(ANDROID_URL),
			);
			return {
				...base,
				version,
				rating,
				ratingCount: null,
				source: ANDROID_URL,
				fetchedAt: new Date().toISOString(),
			};
		}
		case "windows": {
			const parsed = parseWindowsCatalog(await fetchJson(WINDOWS_URL));
			return {
				...base,
				version: parsed.version,
				rating: null,
				ratingCount: null,
				sourceUpdatedAt: parsed.sourceUpdatedAt,
				source: WINDOWS_URL,
				fetchedAt: new Date().toISOString(),
			};
		}
		case "ios": {
			const parsed = parseItunesLookup(await fetchJson(IOS_URL));
			return {
				...base,
				...parsed,
				source: IOS_URL,
				fetchedAt: new Date().toISOString(),
			};
		}
	}
}

export async function getStoreMetadata(
	platform: StoreMetadata["platform"],
): Promise<StoreMetadata> {
	const cached = cache.get(platform);
	if (cached) {
		const ageMs =
			Date.now() -
			Date.parse(cached.fetchedAt ?? /* istanbul ignore next */ "");
		if (ageMs < STALE_MS) return cached;
	}
	try {
		const fresh: StoreMetadata = { ...(await collect(platform)), stale: false };
		cache.set(platform, fresh);
		return fresh;
	} catch (error) {
		console.warn(`store-metadata ${platform}: upstream failed`, error);
		if (cached) return { ...cached, stale: true };
		return {
			platform,
			version: null,
			rating: null,
			ratingScale: 5,
			ratingCount: null,
			source:
				platform === "android"
					? ANDROID_URL
					: platform === "windows"
						? WINDOWS_URL
						: IOS_URL,
			fetchedAt: null,
			sourceUpdatedAt: null,
			stale: true,
		};
	}
}
