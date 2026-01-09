import { NextResponse } from "next/server";
import { getPerekByPerekId } from "@/data/perek-dto";

/**
 * Readiness probe that warms critical code paths before container receives traffic.
 * ALB should use this endpoint for health checks to ensure the app is fully ready.
 *
 * This endpoint:
 * 1. Warms the data loading code path by loading a sample perek
 * 2. Ensures all lazy-loaded modules are initialized
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
