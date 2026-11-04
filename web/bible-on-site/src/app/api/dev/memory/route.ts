import { NextResponse } from "next/server";

/**
 * Returns the Next.js server process memory usage.
 * Used by perf tests to benchmark server memory consumption.
 */
export function GET() {
	// 404 in production unless the perf-test flag is set; the Host header is
	// client-controlled and must not be trusted as a gate.
	if (
		process.env.NODE_ENV === "production" &&
		process.env.ENABLE_DEV_MEMORY_API !== "1"
	) {
		return new NextResponse("Not Found", { status: 404 });
	}

	const memoryUsage = process.memoryUsage();

	return NextResponse.json({
		// RSS (Resident Set Size) - total memory allocated for the process
		rss: memoryUsage.rss,
		// Heap total - V8's memory usage
		heapTotal: memoryUsage.heapTotal,
		// Heap used - V8's actual memory used
		heapUsed: memoryUsage.heapUsed,
		// External - memory used by C++ objects bound to JS objects
		external: memoryUsage.external,
		// Array buffers - memory for ArrayBuffers and SharedArrayBuffers
		arrayBuffers: memoryUsage.arrayBuffers,
	});
}
