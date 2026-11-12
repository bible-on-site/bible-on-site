/**
 * `/openapi.json` — OpenAPI 3.1 description of the PUBLIC read surface
 * (issue #3257). Only anonymous GET endpoints appear here; nothing in
 * this document grants or implies access to management/write APIs.
 */
import { NextResponse } from "next/server";
import { SITE_ORIGIN } from "@/lib/seo/jsonld";

export const dynamic = "force-static";

const DOCUMENT = {
	openapi: "3.1.0",
	info: {
		title: 'תנ"ך על הפרק - public API',
		version: "1.0.0",
		description:
			"Anonymous read-only endpoints over the public learning corpus. " +
			"זיכוי הרבים project — content may be indexed and used in AI " +
			"answers; model training is withheld pending a per-bucket " +
			"decision (see /llms.txt and /robots.txt).",
	},
	servers: [{ url: SITE_ORIGIN }],
	paths: {
		"/api/search": {
			get: {
				summary: "Search the public corpus",
				description:
					"Full-text search over perakim, articles and Tanahpedia entities. Anonymous; JSON.",
				parameters: [
					{
						name: "q",
						in: "query",
						required: true,
						schema: { type: "string", minLength: 1, maxLength: 256 },
						description: "Search text (Hebrew or Latin).",
					},
					{
						name: "type",
						in: "query",
						required: false,
						schema: {
							type: "string",
							description:
								"Comma-separated result types: perek,pasuk,perush,author,article,tanahpedia",
						},
						description:
							"Optional filter (CSV); absent = all types.",
					},
					{
						name: "limit",
						in: "query",
						required: false,
						schema: { type: "integer", minimum: 1, maximum: 50, default: 10 },
						description: "Max results per type.",
					},
				],
				responses: {
					"200": { description: "Search results (JSON)." },
					"400": { description: "Invalid parameters." },
					"503": { description: "Transient backend failure; retry." },
				},
			},
		},
		"/llms.txt": {
			get: {
				summary: "Agent guide to the corpus",
				responses: {
					"200": {
						description: "Markdown guide.",
						content: { "text/markdown": {} },
					},
				},
			},
		},
		"/robots.txt": {
			get: {
				summary: "Crawl policy + AI Content Signals",
				responses: {
					"200": {
						description: "robots.txt.",
						content: { "text/plain": {} },
					},
				},
			},
		},
		"/sitemap.xml": {
			get: {
				summary: "Canonical URL sitemap",
				responses: {
					"200": {
						description: "XML sitemap.",
						content: { "application/xml": {} },
					},
				},
			},
		},
		"/.well-known/api-catalog": {
			get: {
				summary: "RFC 9727 API catalog (linkset)",
				responses: {
					"200": {
						description: "Linkset of public endpoints.",
						content: { "application/linkset+json": {} },
					},
				},
			},
		},
		"/api/health": {
			get: {
				summary: "Liveness/health",
				responses: { "200": { description: "Healthy." } },
			},
		},
	},
};

export function GET(): NextResponse {
	return NextResponse.json(DOCUMENT, {
		headers: {
			"content-type": "application/vnd.oai.openapi+json; charset=utf-8",
			"cache-control": "public, max-age=3600",
		},
	});
}
