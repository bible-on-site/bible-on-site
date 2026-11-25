import { NextResponse } from "next/server";
// Receives an empty request
// Returns the coverage object
// Prupose: currently swc instrumentation is only propogated to client pages
// Much of this project is server side rendered, so this is a brdige to get coverage data from the server
// The issue is explained here: https://github.com/kwonoj/swc-plugin-coverage-instrument/issues/246
// The solution idea is quite old and it was prototyped here: https://github.com/bahmutov/next-and-cypress-example/blob/master/pages/api/__coverage__.js
function isDevLocalhost(request: Request): boolean {
	// Dev-only endpoint: inert in production regardless of headers.
	if (process.env.NODE_ENV !== "development") {
		return false;
	}
	// Exact hostname match — the Host header is client-controlled, so a
	// substring check would pass for hosts like `evil-localhost.example.com`.
	const hostname = request.headers.get("host")?.split(":")[0];
	return hostname === "localhost" || hostname === "127.0.0.1";
}

export function GET(request: Request) {
	// allow only requests from localhost in development
	if (!isDevLocalhost(request)) {
		return new NextResponse(
			`Forbidden: This endpoint is only available on localhost in development. your host is ${request.headers.get("host")}`,
			{
				status: 403,
			},
		);
	}
	const result =
		(global as unknown as { __coverage__?: CoverageData }).__coverage__ ?? {};
	(global as unknown as { __coverage__: CoverageData }).__coverage__ = {};
	return NextResponse.json(result);
}
