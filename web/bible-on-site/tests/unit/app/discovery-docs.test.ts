/**
 * @jest-environment node
 */
jest.mock("server-only", () => ({}));
jest.mock("@/lib/seo/jsonld", () => ({
	SITE_ORIGIN: "https://canonical.example",
	absUrl: (path: string) =>
		path.startsWith("http")
			? path
			: `https://canonical.example${path.startsWith("/") ? path : `/${path}`}`,
}));

import {
	dynamic as catalogDynamic,
	GET as catalogGET,
	HEAD as catalogHEAD,
} from "@/app/.well-known/api-catalog/route";
import { GET as aiCatalogGET } from "@/app/.well-known/ai-catalog.json/route";
import { GET as ardGET } from "@/app/.well-known/ard.json/route";
import { GET as authMdGET } from "@/app/auth.md/route";
import { GET as llmsGET } from "@/app/llms.txt/route";
import { GET as openapiGET } from "@/app/openapi.json/route";

describe("/llms.txt (issue #3257)", () => {
	it("is served as UTF-8 markdown", async () => {
		const response = llmsGET();
		expect(response.headers.get("content-type")).toBe(
			"text/markdown; charset=utf-8",
		);
	});

	it("documents the open-corpus policy and every content family", async () => {
		const body = await llmsGET().text();
		for (const fragment of [
			"search=yes, ai-input=yes, ai-train=yes",
			"/929/{perekId",
			"/פרשה/",
			"/מסורה/",
			"/מועדים/",
			"/pedia/",
			"/api/search",
			"/.well-known/api-catalog",
			"/openapi.json",
			"/sitemap.xml",
			"Attribution",
		]) {
			expect(body).toContain(fragment);
		}
	});

	it("points agents at the capability manifests and honest auth note", async () => {
		const body = await llmsGET().text();
		for (const fragment of [
			"/.well-known/ard.json",
			"/.well-known/ai-catalog.json",
			"/.well-known/agent-skills/index.json",
			"SKILL.md",
			"/auth.md",
		]) {
			expect(body).toContain(fragment);
		}
	});

	it("welcomes training without requiring referrals and keeps the crawler buckets", async () => {
		const body = await llmsGET().text();
		expect(body).toContain("AI-training crawlers - welcome");
		expect(body).toContain("Training is welcome even without a link or");
		expect(body).toContain("model weights is welcome in itself");
		expect(body).not.toMatch(/ai-train=no|withheld|pending.*decision/);
		for (const fragment of [
			"GPTBot",
			"ClaudeBot",
			"CCBot",
			"meta-externalagent",
			"Google-Extended",
			"Applebot-Extended",
			"OAI-SearchBot",
			"Claude-SearchBot",
			"Bytespider",
		]) {
			expect(body).toContain(fragment);
		}
		// No whole-corpus Markdown representation is advertised
		// (PR #3299 review).
		expect(body).not.toContain(".md`");
		expect(body).not.toContain("Accept: text/markdown");
	});

	it("names the protected boundaries", async () => {
		const body = await llmsGET().text();
		expect(body).toMatch(/\/dev|\/api\/dev|\/api\/revalidate/);
	});

	it("explains how to discover Masora readings outside the indexing sitemap", async () => {
		const body = await llmsGET().text();
		expect(body).toContain("Masora (/מסורה) pages are intentionally noindex");
		expect(body).toContain("excluded from the sitemap");
		expect(body).toContain("follow the sefer/unit links from /מסורה");
		expect(body).not.toMatch(/complete\s+coverage|every canonical URL/);
	});
});

describe("/.well-known/api-catalog (RFC 9727)", () => {
	it("GET returns a linkset document with the RFC profile", async () => {
		const response = catalogGET();
		expect(catalogDynamic).toBe("force-static");
		expect(response.headers.get("cache-control")).toBe("public, max-age=3600");
		expect(response.headers.get("content-type")).toBe(
			'application/linkset+json; profile="https://www.rfc-editor.org/info/rfc9727"',
		);
		const body = (await response.json()) as {
			linkset: { anchor: string; item: { href: string }[] }[];
		};
		expect(body.linkset[0].anchor).toBe("https://canonical.example");
		const hrefs = body.linkset[0].item.map((item) => item.href);
		expect(hrefs).toEqual(["https://canonical.example/api/search"]);
	});

	it("advertises only public endpoints - no private/admin APIs", async () => {
		const body = (await catalogGET().json()) as {
			linkset: Record<string, { href: string }[] | undefined>[];
		};
		const json = JSON.stringify(body);
		for (const forbidden of [
			"/api/dev",
			"/api/revalidate",
			"/api/push",
			"/dev",
		]) {
			expect(json).not.toContain(forbidden);
		}
	});

	it("HEAD returns the api-catalog Link header and no body", async () => {
		const response = catalogHEAD();
		expect(response.headers.get("cache-control")).toBe("public, max-age=3600");
		expect(response.headers.get("link")).toBe(
			'<https://canonical.example/.well-known/api-catalog>; rel="api-catalog"',
		);
		expect(response.headers.get("content-type")).toContain(
			"application/linkset+json",
		);
		expect(await response.text()).toBe("");
	});
});

describe("/openapi.json", () => {
	it("documents partial search results and their availability notices", async () => {
		const doc = await openapiGET().json();
		const response = doc.paths["/api/search"].get.responses["200"];
		expect(response.description).toContain("availability");
		const schema = response.content["application/json"].schema;
		expect(schema.required).toEqual(
			expect.arrayContaining([
				"query",
				"types",
				"results",
				"counts",
				"availability",
			]),
		);
		expect(schema.properties.availability).toMatchObject({
			type: "array",
			items: { type: "string" },
		});
		expect(schema.properties.availability.description).toContain("incomplete");
	});

	it("describes only the public read endpoints", async () => {
		const response = openapiGET();
		expect(response.headers.get("content-type")).toContain(
			"application/vnd.oai.openapi+json",
		);
		const doc = (await response.json()) as {
			openapi: string;
			paths: Record<string, unknown>;
		};
		expect(doc.openapi).toBe("3.1.0");
		expect(Object.keys(doc.paths)).toEqual(
			expect.arrayContaining([
				"/api/search",
				"/llms.txt",
				"/robots.txt",
				"/sitemap.xml",
				"/.well-known/api-catalog",
				"/.well-known/ard.json",
				"/.well-known/ai-catalog.json",
				"/.well-known/agent-skills/index.json",
				"/.well-known/agent-skills/{name}/SKILL.md",
				"/auth.md",
				"/api/health",
			]),
		);
		expect(Object.keys(doc.paths)).not.toContain("/md/{path}");
		const json = JSON.stringify(doc);
		expect(json).toContain(
			"model training, including learning in model weights",
		);
		expect(json).not.toMatch(/withheld|ai-train=no/);
		for (const forbidden of ["/api/dev", "/api/revalidate", "/api/push"]) {
			expect(json).not.toContain(forbidden);
		}
	});
});

describe("ARD / AI Catalog manifest (issue #3257)", () => {
	interface Manifest {
		specVersion: string;
		host: { displayName: string; identifier: string };
		entries: {
			identifier: string;
			displayName: string;
			type: string;
			mediaType: string;
			url: string;
			representativeQueries: string[];
		}[];
	}

	it("serves the same manifest at the ARD and predecessor paths with their own media types", async () => {
		const [ard, ai] = [ardGET(), aiCatalogGET()];
		expect(ard.headers.get("content-type")).toContain("application/ard+json");
		expect(ai.headers.get("content-type")).toContain(
			"application/ai-catalog+json",
		);
		expect(await ard.text()).toBe(await ai.text());
	});

	it("lists only real artifacts - no MCP, A2A, OAuth or commerce entries", async () => {
		const manifest = (await ardGET().json()) as Manifest;
		expect(manifest.specVersion).toBe("1.0");
		expect(manifest.host.identifier).toBe("canonical.example");
		expect(manifest.entries.length).toBeGreaterThanOrEqual(8);
		const json = JSON.stringify(manifest).toLowerCase();
		for (const forbidden of [
			"mcp-server-card",
			"a2a-agent-card",
			"oauth",
			"x402",
			"/api/dev",
			"/api/revalidate",
			"/api/push",
			"/dev",
		]) {
			expect(json).not.toContain(forbidden);
		}
	});

	it("gives every entry a URN, both type spellings, a real URL and 2-5 representative queries", async () => {
		const manifest = (await ardGET().json()) as Manifest;
		for (const entry of manifest.entries) {
			expect(entry.identifier).toMatch(/^urn:air:canonical\.example:.+/);
			expect(entry.displayName.length).toBeGreaterThan(0);
			expect(entry.type).toBe(entry.mediaType);
			expect(entry.url.startsWith("https://canonical.example/")).toBe(true);
			expect(entry.representativeQueries.length).toBeGreaterThanOrEqual(2);
			expect(entry.representativeQueries.length).toBeLessThanOrEqual(5);
		}
		const urls = manifest.entries.map((entry) => entry.url);
		for (const required of [
			"https://canonical.example/.well-known/api-catalog",
			"https://canonical.example/openapi.json",
			"https://canonical.example/llms.txt",
			"https://canonical.example/.well-known/agent-skills/index.json",
			"https://canonical.example/.well-known/agent-skills/tanah-corpus-map/SKILL.md",
			"https://canonical.example/api/search",
		]) {
			expect(urls).toContain(required);
		}
	});
});

describe("/auth.md", () => {
	it("is served as UTF-8 markdown", async () => {
		const response = authMdGET();
		expect(response.headers.get("content-type")).toBe(
			"text/markdown; charset=utf-8",
		);
	});

	it("states plainly that public reads need no authentication", async () => {
		const body = await authMdGET().text();
		expect(body).toContain("No authentication is required");
		for (const honest of [
			"no registration flow",
			"no API key",
			"no OAuth server",
			"/api/search",
			"/.well-known/api-catalog",
			"/llms.txt",
		]) {
			expect(body.toLowerCase()).toContain(honest.toLowerCase());
		}
		// No invented ceremony: nothing in the file may describe a flow
		// the site does not implement.
		expect(body).not.toMatch(/token_endpoint|register.*endpoint|claim.*code/i);
	});
});
