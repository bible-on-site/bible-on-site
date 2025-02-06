import { NextResponse } from "next/server";
// Receives an empty request
// Returns the coverage object
// Prupose: currently swc instrumentation is only propogated to client pages
// Much of this project is server side rendered, so this is a brdige to get coverage data from the server
// The issue is explained here: https://github.com/kwonoj/swc-plugin-coverage-instrument/issues/246
// The solution idea is quite old and it was prototyped here: https://github.com/bahmutov/next-and-cypress-example/blob/master/pages/api/__coverage__.js
export async function GET(request: Request) {
	// allow only requests from localhost
	const host = request.headers.get("host");
	if (!host || (!host.includes("localhost") && !host.includes("127.0.0.1"))) {
		return new NextResponse(
			`Forbidden: This endpoint is only available on localhost. your host is ${host}`,
			{
				status: 403,
			},
		);
	}
	const result =
		(global as unknown as { __coverage__?: CoverageData }).__coverage__ || {};
	(global as unknown as { __coverage__: CoverageData }).__coverage__ = {};
	return NextResponse.json(result);
}
