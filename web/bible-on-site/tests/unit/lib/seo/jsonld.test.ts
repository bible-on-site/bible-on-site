import type { Thing, WithContext } from "schema-dts";
import {
	absUrl,
	breadcrumbNode,
	buildGraph,
	hasContent,
	nodeId,
	ORG_ID,
	organizationNode,
	renderJsonLd,
	SITE_NAME,
	SITE_ORIGIN,
	WEBSITE_ID,
	websiteNode,
} from "../../../../src/lib/seo/jsonld";

describe("seo/jsonld", () => {
	describe("SITE_ORIGIN", () => {
		it("is an absolute origin with no trailing slash", () => {
			expect(SITE_ORIGIN).toMatch(/^https?:\/\/[^/]+$/);
			expect(SITE_ORIGIN.endsWith("/")).toBe(false);
		});
	});

	describe("absUrl", () => {
		it("prefixes a slash-rooted path with the origin", () => {
			expect(absUrl("/pedia/x")).toBe(`${SITE_ORIGIN}/pedia/x`);
		});

		it("adds a missing leading slash", () => {
			expect(absUrl("pedia/x")).toBe(`${SITE_ORIGIN}/pedia/x`);
		});

		it("returns an already-absolute URL unchanged", () => {
			expect(absUrl("https://example.com/a")).toBe("https://example.com/a");
			expect(absUrl("http://example.com/a")).toBe("http://example.com/a");
		});
	});

	describe("nodeId", () => {
		it("builds a fragment-anchored id from a path", () => {
			expect(nodeId("/pedia/x", "term")).toBe(`${SITE_ORIGIN}/pedia/x#term`);
		});
	});

	describe("organizationNode", () => {
		it("returns an Organization with a stable id and sameAs list", () => {
			const org = organizationNode() as unknown as Record<string, unknown>;
			expect(org["@type"]).toBe("Organization");
			expect(org["@id"]).toBe(ORG_ID);
			expect(org.name).toBe(SITE_NAME);
			expect(org.url).toBe(`${SITE_ORIGIN}/`);
			expect(Array.isArray(org.sameAs)).toBe(true);
			expect(org.sameAs as string[]).toContain("https://t.me/BibleOnSite");
		});
	});

	describe("websiteNode", () => {
		it("returns a WebSite linked to the Organization as publisher", () => {
			const site = websiteNode() as unknown as Record<string, unknown>;
			expect(site["@type"]).toBe("WebSite");
			expect(site["@id"]).toBe(WEBSITE_ID);
			expect(site.inLanguage).toBe("he");
			expect(site.publisher).toEqual({ "@id": ORG_ID });
		});
	});

	describe("breadcrumbNode", () => {
		it("numbers items from 1 and resolves absolute item URLs", () => {
			const crumb = breadcrumbNode(
				[
					{ name: "בית", path: "/" },
					{ name: "תנכפדיה", path: "/tanahpedia" },
					{ name: "אברהם", path: "/pedia/avraham" },
				],
				"/pedia/avraham",
			) as unknown as Record<string, unknown>;
			expect(crumb["@type"]).toBe("BreadcrumbList");
			expect(crumb["@id"]).toBe(`${SITE_ORIGIN}/pedia/avraham#breadcrumb`);
			const items = crumb.itemListElement as Array<{
				position: number;
				name: string;
				item: string;
			}>;
			expect(items).toHaveLength(3);
			expect(items[0]).toMatchObject({
				position: 1,
				name: "בית",
				item: `${SITE_ORIGIN}/`,
			});
			expect(items[2]).toMatchObject({
				position: 3,
				item: `${SITE_ORIGIN}/pedia/avraham`,
			});
		});
	});

	describe("buildGraph", () => {
		it("wraps nodes with the schema.org context", () => {
			const graph = buildGraph([organizationNode()]);
			expect(graph["@context"]).toBe("https://schema.org");
			expect(graph["@graph"]).toHaveLength(1);
		});
	});

	describe("renderJsonLd", () => {
		it("escapes characters that could break out of a script element", () => {
			const node: WithContext<Thing> = {
				"@context": "https://schema.org",
				"@type": "Thing",
				name: "a </script> & 'b' <c>\u2028\u2029",
			};
			const out = renderJsonLd(node);
			expect(out).not.toContain("</script>");
			expect(out).not.toContain("<c>");
			expect(out).toContain("\\u003c");
			expect(out).toContain("\\u003e");
			expect(out).toContain("\\u0026");
			expect(out).toContain("\\u0027");
			expect(out).toContain("\\u2028");
			expect(out).toContain("\\u2029");
		});

		it("produces JSON that parses back to the original values", () => {
			const node = buildGraph([organizationNode()]);
			const parsed = JSON.parse(renderJsonLd(node));
			expect(parsed["@context"]).toBe("https://schema.org");
			expect(parsed["@graph"][0]["@type"]).toBe("Organization");
		});
	});

	describe("hasContent", () => {
		it("returns false for empty, null, or tag-only HTML", () => {
			expect(hasContent(null)).toBe(false);
			expect(hasContent(undefined)).toBe(false);
			expect(hasContent("")).toBe(false);
			expect(hasContent("<p></p>")).toBe(false);
			expect(hasContent("<p>  </p>")).toBe(false);
			expect(hasContent("<p>&nbsp;</p>")).toBe(false);
		});

		it("returns true when visible text remains after stripping tags", () => {
			expect(hasContent("<p>אברהם</p>")).toBe(true);
			expect(hasContent("plain text")).toBe(true);
		});
	});
});
