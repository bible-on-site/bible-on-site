import { revalidatePath, revalidateTag } from "next/cache";
import { type NextRequest, NextResponse } from "next/server";

/**
 * API endpoint to revalidate cached content when admin makes changes.
 * Called by the admin app when articles or rabbis are modified.
 *
 * Query parameters:
 * - path: The specific path to revalidate (e.g., /929/1)
 * - tag: A cache tag to revalidate (e.g., article-123)
 * - secret: Required secret key for authorization
 */
export async function POST(request: NextRequest) {
	const searchParams = request.nextUrl.searchParams;
	const path = searchParams.get("path");
	const tag = searchParams.get("tag");
	const secret = searchParams.get("secret");

	// Validate secret in production
	if (process.env.NODE_ENV === "production") {
		const expectedSecret = process.env.REVALIDATE_SECRET;
		if (!expectedSecret || secret !== expectedSecret) {
			return NextResponse.json({ error: "Invalid secret" }, { status: 401 });
		}
	}

	try {
		if (tag) {
			revalidateTag(tag, "max");
			return NextResponse.json({
				revalidated: true,
				type: "tag",
				tag,
				timestamp: new Date().toISOString(),
			});
		}

		if (path) {
			revalidatePath(path);
			return NextResponse.json({
				revalidated: true,
				type: "path",
				path,
				timestamp: new Date().toISOString(),
			});
		}

		return NextResponse.json(
			{ error: "Either path or tag parameter is required" },
			{ status: 400 },
		);
	} catch (error) {
		console.error("Revalidation error:", error);
		return NextResponse.json(
			{ error: "Failed to revalidate" },
			{ status: 500 },
		);
	}
}
