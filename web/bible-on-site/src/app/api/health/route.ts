import { NextResponse } from "next/server";

/**
 * Basic liveness probe for ALB health checks.
 * Returns 200 immediately - used to verify the container is running.
 */
export function GET(): NextResponse {
	return NextResponse.json({ status: "ok" }, { status: 200 });
}
