/**
 * AI Catalog / ARD manifest (issue #3257): the machine-readable index of
 * the agent-facing resources this origin really serves - the RFC 9727 API
 * linkset, the OpenAPI description, the agent guide, the Agent Skills
 * index and its SKILL.md files, and the anonymous search endpoint.
 *
 * Served at `/.well-known/ard.json` (ARD v0.91, `application/ard+json`)
 * and the predecessor path `/.well-known/ai-catalog.json`
 * (`application/ai-catalog+json`), which is what the Cloudflare readiness
 * scanner and earlier clients still probe. Both fields `type` and
 * `mediaType` are emitted with the same value because the ai-catalog base
 * spec and the ARD layer diverged on the name; `representativeQueries`
 * (2-5 natural-language asks per entry) is what registries index for
 * capability search.
 *
 * Only real artifacts are listed - no MCP/A2A/OAuth entries the site
 * does not actually run (per the issue: no fake capabilities).
 */
import "server-only";
import { AGENT_SKILLS } from "@/lib/agent-skills";
import { SITE_ORIGIN } from "@/lib/seo/jsonld";

interface CatalogEntry {
	identifier: string;
	displayName: string;
	type: string;
	mediaType: string;
	url: string;
	description: string;
	representativeQueries: string[];
	tags?: string[];
}

function entry(
	slug: string,
	displayName: string,
	mediaType: string,
	url: string,
	description: string,
	representativeQueries: string[],
	tags?: string[],
): CatalogEntry {
	const host = new URL(SITE_ORIGIN).host;
	return {
		identifier: `urn:air:${host}:${slug}`,
		displayName,
		type: mediaType,
		mediaType,
		url,
		description,
		representativeQueries,
		...(tags ? { tags } : {}),
	};
}

export function aiCatalogManifest() {
	const entries: CatalogEntry[] = [
		entry(
			"catalog:rfc9727-api-catalog",
			"Public API catalog (RFC 9727 linkset)",
			"application/linkset+json",
			`${SITE_ORIGIN}/.well-known/api-catalog`,
			"Linkset catalog of the anonymous public read endpoints.",
			[
				"which public APIs does this site offer",
				"find the anonymous search endpoint for the Tanah corpus",
			],
		),
		entry(
			"doc:openapi",
			"OpenAPI description of the public read endpoints",
			"application/vnd.oai.openapi+json",
			`${SITE_ORIGIN}/openapi.json`,
			"OpenAPI 3.1 contract for /api/search and the discovery documents: anonymous access, parameters, limits, content types and error behavior.",
			[
				"what parameters does the corpus search API accept",
				"what do /api/search error codes mean",
			],
		),
		entry(
			"doc:agent-guide",
			'llms.txt agent guide to the תנ"ך corpus',
			"text/markdown",
			`${SITE_ORIGIN}/llms.txt`,
			"Plain-language guide: open-corpus policy, crawler buckets, canonical URL families, attribution and licence guidance.",
			[
				"may I train a model on this site's content",
				"what is the crawl policy for the Tanah corpus",
				"how should agents attribute articles from this site",
			],
		),
		entry(
			"index:agent-skills",
			"Agent Skills discovery index (v0.2.0)",
			"application/json",
			`${SITE_ORIGIN}/.well-known/agent-skills/index.json`,
			"Discovery index of the Agent Skills below - how to traverse, search and cite the corpus correctly.",
			[
				"how do I traverse the whole Tanah corpus",
				"how do I search this site's content as an agent",
				"how do I cite content from this site",
			],
			["agent-skill", "discovery"],
		),
		...AGENT_SKILLS.map((skill) =>
			entry(
				`skill:${skill.name}`,
				skill.name,
				"text/markdown",
				`${SITE_ORIGIN}/.well-known/agent-skills/${skill.name}/SKILL.md`,
				`Agent Skill: ${skill.description}`,
				skill.queries,
				["agent-skill"],
			),
		),
		entry(
			"api:search",
			"Anonymous corpus search",
			"application/json",
			`${SITE_ORIGIN}/api/search`,
			"GET /api/search?q={query}&type={csv}&limit={1-50} - anonymous JSON search over perakim, pesukim, perushim, authors, articles and Tanahpedia. Nonempty availability notices mean retryable partial results.",
			[
				"find pesukim containing a phrase",
				"which perakim mention a topic",
				"search for commentary by a parshan",
			],
		),
	];

	return {
		specVersion: "1.0",
		host: {
			displayName: 'תנ"ך על הפרק (Bible on Site)',
			identifier: new URL(SITE_ORIGIN).host,
		},
		entries,
	};
}
