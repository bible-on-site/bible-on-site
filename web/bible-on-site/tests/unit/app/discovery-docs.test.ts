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

import { GET as llmsGET } from "@/app/llms.txt/route";
import { GET as catalogGET, HEAD as catalogHEAD } from "@/app/.well-known/api-catalog/route";
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

	it("welcomes training without requiring referrals and keeps the crawler buckets", async () => {
		const body = await llmsGET().text();
		expect(body).toContain("AI-training crawlers — welcome");
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
});

describe("/.well-known/api-catalog (RFC 9727)", () => {
	it("GET returns a linkset document with the RFC profile", async () => {
		const response = catalogGET();
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

	it("advertises only public endpoints — no private/admin APIs", async () => {
		const body = (await catalogGET().json()) as {
			linkset: Record<string, { href: string }[] | undefined>[];
		};
		const json = JSON.stringify(body);
		for (const forbidden of ["/api/dev", "/api/revalidate", "/api/push", "/dev"]) {
			expect(json).not.toContain(forbidden);
		}
	});

	it("HEAD returns the api-catalog Link header and no body", async () => {
		const response = catalogHEAD();
		expect(response.headers.get("link")).toContain('rel="api-catalog"');
		expect(response.headers.get("content-type")).toContain(
			"application/linkset+json",
		);
		expect(await response.text()).toBe("");
	});
});

describe("/openapi.json", () => {
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
				"/api/health",
			]),
		);
		expect(Object.keys(doc.paths)).not.toContain("/md/{path}");
		const json = JSON.stringify(doc);
		expect(json).toContain("model training, including learning in model weights");
		expect(json).not.toMatch(/withheld|ai-train=no/);
		for (const forbidden of ["/api/dev", "/api/revalidate", "/api/push"]) {
			expect(json).not.toContain(forbidden);
		}
	});
});
