/**
 * Store metadata for README badges and machine-readable lookups (#2371).
 *
 * Sources (all public, no credentials):
 * - android: play.google.com listing HTML; version anchored at the "141"
 *   details key. Play does not ship the star rating in initial HTML, so
 *   rating stays null rather than fabricated.
 * - windows: Microsoft displaycatalog v7.0 product API. The public catalog
 *   does not expose package version or star rating — both stay null.
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
	/** True when serving a cached value or no upstream answer ever landed. */
	stale: boolean;
}

const ANDROID_URL =
	"https://play.google.com/store/apps/details?id=com.tanah.daily929&hl=en&gl=US";
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

async function collect(
	platform: StoreMetadata["platform"],
): Promise<Omit<StoreMetadata, "stale">> {
	const base = { platform, ratingScale: 5 as const };
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
			const json = await fetchJson(WINDOWS_URL);
			const modified = (json as { Product?: { LastModifiedDate?: string } })
				.Product?.LastModifiedDate;
			return {
				...base,
				version: null,
				rating: null,
				ratingCount: null,
				source: WINDOWS_URL,
				fetchedAt:
					typeof modified === "string" ? modified : new Date().toISOString(),
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
	if (cached && Date.now() - Date.parse(cached.fetchedAt ?? "") < STALE_MS)
		return cached;
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
			stale: true,
		};
	}
}
