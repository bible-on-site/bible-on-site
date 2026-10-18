import { NextResponse } from "next/server";
import { getStoreMetadata, type StoreMetadata } from "@/lib/store-metadata";

export const dynamic = "force-dynamic";

const PLATFORMS = new Set(["android", "windows", "ios"]);

/**
 * GET /api/store-metadata/{android|windows|ios}
 *
 * Public read-only store metadata for README badges (shields dynamic/json)
 * and agents (#2371). Cached 6h upstream / 24h process fallback; fields are
 * null rather than fabricated when a store does not publish them.
 */
export async function GET(
	_request: Request,
	{ params }: { params: Promise<{ platform: string }> },
): Promise<NextResponse> {
	const { platform } = await params;
	if (!PLATFORMS.has(platform)) {
		return NextResponse.json(
			{ error: `unknown platform "${platform}"`, platforms: [...PLATFORMS] },
			{ status: 404 },
		);
	}
	const metadata: StoreMetadata = await getStoreMetadata(
		platform as StoreMetadata["platform"],
	);
	return NextResponse.json(metadata, {
		headers: { "cache-control": "public, max-age=3600" },
	});
}
