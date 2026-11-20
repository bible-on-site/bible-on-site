/**
 * `/openapi.json` - OpenAPI 3.1 description of the PUBLIC read surface
 * (issue #3257). Only anonymous GET endpoints appear here; nothing in
 * this document grants or implies access to management/write APIs.
 */
import { NextResponse } from "next/server";
import { SEARCH_RESULT_TYPES } from "@/lib/search/types";
import { SITE_ORIGIN } from "@/lib/seo/jsonld";

export const dynamic = "force-static";

const DOCUMENT = {
	openapi: "3.1.0",
	info: {
		title: 'תנ"ך על הפרק - public API',
		version: "1.0.0",
		description:
			"Anonymous read-only endpoints over the public learning corpus. " +
			"זיכוי הרבים project - content may be indexed and used in AI " +
			"answers and model training, including learning in model weights " +
			"without referrals (see /llms.txt and /robots.txt).",
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
						description: "Optional filter (CSV); absent = all types.",
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
					"200": {
						description:
							"Search results. Inspect availability even on HTTP 200: nonempty notices mean incomplete results; retry later.",
						content: {
							"application/json": {
								schema: {
									type: "object",
									required: [
										"query",
										"types",
										"results",
										"counts",
										"availability",
									],
									properties: {
										query: {
											type: "string",
											description: "Normalized search query.",
										},
										types: {
											type: "array",
											items: { type: "string", enum: SEARCH_RESULT_TYPES },
										},
										results: {
											type: "array",
											description:
												"Grouped by type, ordered by relevance within each type.",
											items: {
												type: "object",
												required: [
													"type",
													"title",
													"snippetHtml",
													"href",
													"score",
												],
												properties: {
													type: { type: "string", enum: SEARCH_RESULT_TYPES },
													title: { type: "string" },
													snippetHtml: {
														type: ["string", "null"],
														description:
															"HTML-escaped excerpt with optional <mark> highlights.",
													},
													href: {
														type: "string",
														description: "Site-relative result URL.",
													},
													score: { type: "number" },
												},
											},
										},
										counts: {
											type: "object",
											description:
												"Returned result counts keyed by successful result type.",
											additionalProperties: { type: "integer", minimum: 0 },
										},
										availability: {
											type: "array",
											items: { type: "string" },
											description:
												"Non-fatal provider availability notices. Nonempty means incomplete results; retry later. Empty means no provider failure was reported.",
										},
									},
								},
							},
						},
					},
					"400": {
						description:
							"Invalid parameters: JSON error is invalid_query (missing or blank q), invalid_limit, or invalid_type (no recognized type).",
					},
					"414": {
						description:
							"Query exceeds 256 characters after trimming; JSON error is invalid_query.",
					},
					"500": {
						description:
							"Uncaught search failure; JSON error is search_failed. Retry later.",
					},
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
		"/.well-known/ard.json": {
			get: {
				summary: "ARD v0.91 agent capability manifest",
				description:
					"Machine-readable index of the real agent-facing resources this origin serves. Also served at the predecessor path /.well-known/ai-catalog.json.",
				responses: {
					"200": {
						description: "Agent capability manifest.",
						content: { "application/ard+json": {} },
					},
				},
			},
		},
		"/.well-known/ai-catalog.json": {
			get: {
				summary: "AI Catalog manifest (predecessor ARD path)",
				responses: {
					"200": {
						description: "Same manifest as /.well-known/ard.json.",
						content: { "application/ai-catalog+json": {} },
					},
				},
			},
		},
		"/.well-known/agent-skills/index.json": {
			get: {
				summary: "Agent Skills discovery index (v0.2.0)",
				responses: {
					"200": {
						description:
							"Index of skill-md artifacts with sha256 digests.",
						content: { "application/json": {} },
					},
				},
			},
		},
		"/.well-known/agent-skills/{name}/SKILL.md": {
			get: {
				summary: "A published Agent Skill",
				parameters: [
					{
						name: "name",
						in: "path",
						required: true,
						schema: {
							type: "string",
							enum: [
								"tanah-corpus-map",
								"tanah-corpus-search",
								"tanah-corpus-citation",
							],
						},
						description: "Skill name from the index; others 404.",
					},
				],
				responses: {
					"200": {
						description: "SKILL.md artifact.",
						content: { "text/markdown": {} },
					},
					"404": { description: "No skill by that name." },
				},
			},
		},
		"/auth.md": {
			get: {
				summary: "Anonymous-access statement",
				responses: {
					"200": {
						description:
							"No authentication exists for public reads - plain markdown note.",
						content: { "text/markdown": {} },
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
