/**
 * `/.well-known/api-catalog` — RFC 9727 API catalog (#3257).
 *
 * GET returns a linkset document (application/linkset+json; profile
 * https://www.rfc-editor.org/info/rfc9727) listing ONLY the public
 * read endpoints; HEAD replies with the same headers (no body) plus a
 * `Link` header advertising the catalog, as the RFC requires.
 * Management/dev/write endpoints are deliberately absent.
 */
import { NextResponse } from "next/server";
import { SITE_ORIGIN } from "@/lib/seo/jsonld";

export const dynamic = "force-static";

const CATALOG_TYPE =
	'application/linkset+json; profile="https://www.rfc-editor.org/info/rfc9727"';

const LINKSET = {
	linkset: [
		{
			anchor: SITE_ORIGIN,
			item: [
				{
					href: `${SITE_ORIGIN}/api/search`,
					type: "application/json",
					"title-info": [{ title: "Public corpus search", "title-language": "en" }],
				},
				{
					href: `${SITE_ORIGIN}/md`,
					type: "text/markdown",
					"title-info": [
						{
							title: "Markdown representation of any public page",
							"title-language": "en",
						},
					],
				},
			],
			"service-desc": [
				{
					href: `${SITE_ORIGIN}/openapi.json`,
					type: "application/vnd.oai.openapi+json",
				},
			],
			"service-doc": [
				{ href: `${SITE_ORIGIN}/llms.txt`, type: "text/markdown" },
			],
			status: [{ href: `${SITE_ORIGIN}/api/health`, type: "application/json" }],
		},
	],
};

const CATALOG_LINK = `<${SITE_ORIGIN}/.well-known/api-catalog>; rel="api-catalog"`;

export function GET(): NextResponse {
	return NextResponse.json(LINKSET, {
		headers: {
			"content-type": CATALOG_TYPE,
			link: CATALOG_LINK,
			"cache-control": "public, max-age=3600",
		},
	});
}

export function HEAD(): NextResponse {
	return new NextResponse(null, {
		headers: {
			"content-type": CATALOG_TYPE,
			link: CATALOG_LINK,
			"cache-control": "public, max-age=3600",
		},
	});
}
