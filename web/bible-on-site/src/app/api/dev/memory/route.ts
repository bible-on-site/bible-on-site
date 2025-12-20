import { NextResponse } from "next/server";

/**
 * Returns the Next.js server process memory usage.
 * Used by perf tests to benchmark server memory consumption.
 */
export function GET(request: Request) {
	// Allow only requests from localhost
	const host = request.headers.get("host");
	if (!host || (!host.includes("localhost") && !host.includes("127.0.0.1"))) {
		return new NextResponse(
			`Forbidden: This endpoint is only available on localhost. Your host is ${host}`,
			{ status: 403 },
		);
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
