import { NextResponse } from "next/server";
import { getPerekByPerekId } from "@/data/perek-dto";

/**
 * ECS readiness probe. Importing perek-dto initializes the canonical server data
 * shared by chapter and recitation routes; the sample lookups verify it is usable.
 * Liveness can pass before this cold load completes, so ECS must use this endpoint
 * before replacing the old task. This does not check database-backed pages.
 */

let isWarmed = false;

function warmCriticalPaths(): void {
	if (isWarmed) return;

	// Warm the perek data loading path (loads sefarim, perakim data)
	// This ensures the data modules are loaded and cached
	getPerekByPerekId(1);
	getPerekByPerekId(929);

	isWarmed = true;
}

export function GET(): NextResponse {
	try {
		warmCriticalPaths();
		return NextResponse.json(
			{
				status: "ready",
				warmed: isWarmed,
			},
			{ status: 200 },
		);
	} catch (error) {
		console.error("Readiness check failed:", error);
		return NextResponse.json(
			{
				status: "error",
				message: error instanceof Error ? error.message : "Unknown error",
			},
			{ status: 503 },
		);
	}
}
