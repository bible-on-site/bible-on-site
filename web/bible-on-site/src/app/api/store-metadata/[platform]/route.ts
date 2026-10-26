import { NextResponse } from "next/server";
import { getStoreMetadata, type StoreMetadata } from "@/lib/store-metadata";

export const dynamic = "force-dynamic";

const PLATFORMS = new Set(["android", "windows", "ios"]);
/** Fresh answers may be shared briefly; stale/error answers never cache. */
const FRESH_CACHE_CONTROL =
	"public, max-age=300, s-maxage=300, must-revalidate";
const UNAVAILABLE_CACHE_CONTROL = "no-store";

function hasData(metadata: StoreMetadata): boolean {
	return (
		metadata.version !== null ||
		metadata.rating !== null ||
		metadata.ratingCount !== null ||
		metadata.sourceUpdatedAt !== null
	);
}

/**
 * Strip null fields so Shields renders a clear "no result" for a
 * legitimately unavailable field instead of a bare "/5" (#2395).
 */
function omitNulls(metadata: StoreMetadata): Record<string, unknown> {
	return Object.fromEntries(
		Object.entries(metadata).filter(([, value]) => value !== null),
	);
}

/**
 * GET /api/store-metadata/{android|windows|ios}
 *
 * Public read-only store metadata for README badges (shields dynamic/json)
 * and agents (#2371). Fields are omitted rather than fabricated when a store
 * does not publish them. Degraded answers (stale last-good) are served
 * no-store and a never-observed platform 503s so downstream caches — Shields
 * and GitHub Camo — re-check quickly instead of pinning an error body for an
 * hour (#2395).
 */
export async function GET(
	_request: Request,
	{ params }: { params: Promise<{ platform: string }> },
): Promise<NextResponse> {
	const { platform } = await params;
	if (!PLATFORMS.has(platform)) {
		return NextResponse.json(
			{ error: `unknown platform "${platform}"`, platforms: [...PLATFORMS] },
			{ status: 404, headers: { "cache-control": "no-store" } },
		);
	}
	const metadata: StoreMetadata = await getStoreMetadata(
		platform as StoreMetadata["platform"],
	);
	if (!hasData(metadata)) {
		return NextResponse.json(
			{ error: "store metadata unavailable", platform },
			{
				status: 503,
				headers: {
					"cache-control": UNAVAILABLE_CACHE_CONTROL,
					"retry-after": "60",
				},
			},
		);
	}
	return NextResponse.json(omitNulls(metadata), {
		headers: {
			"cache-control": metadata.stale
				? UNAVAILABLE_CACHE_CONTROL
				: FRESH_CACHE_CONTROL,
		},
	});
}
