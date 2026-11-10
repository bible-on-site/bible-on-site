/**
 * @jest-environment node
 */
import { NextRequest } from "next/server";
import { config, proxy } from "@/proxy";

function makeRequest(
	pathname: string,
	opts?: { ua?: string; accept?: string; method?: string },
): NextRequest {
	const headers: Record<string, string> = {};
	if (opts?.ua) headers["user-agent"] = opts.ua;
	if (opts?.accept) headers.accept = opts.accept;
	return new NextRequest(new URL(pathname, "https://localhost"), {
		headers,
		method: opts?.method ?? "GET",
	});
}

/** The decoded x-middleware-rewrite destination of a proxy rewrite. */
function rewrittenPath(response: Response | undefined): string | null {
	const rewrite = response?.headers.get("x-middleware-rewrite");
	return rewrite ? decodeURIComponent(new URL(rewrite).pathname) : null;
}

describe("proxy", () => {
	describe("parasha canonical slugs (issue #2738)", () => {
		it.each([
			// Legacy numeric unit ids.
			["/פרשה/1", "/פרשה/בראשית"],
			["/פרשה/54", "/פרשה/וזאת-הברכה"],
			// The ASCII route dir consolidates to the public Hebrew root.
			["/parasha", "/פרשה"],
			["/parasha/1", "/פרשה/בראשית"],
			["/parasha/לך-לך", "/פרשה/לך-לך"],
			// Researched aliases and shared 'פרשת {name}' forms.
			["/פרשה/תצווה", "/פרשה/תצוה"],
			["/פרשה/שלח לך", "/פרשה/שלח"],
			["/פרשה/פרשת לך לך", "/פרשה/לך-לך"],
			["/פרשה/פרשת-וזאת-הברכה", "/פרשה/וזאת-הברכה"],
			// Maqaf, niqqud, and space variants normalize to the slug.
			["/פרשה/לך־לך", "/פרשה/לך-לך"],
			["/פרשה/לֶךְ־לֵךְ", "/פרשה/לך-לך"],
			["/פרשה/חיי שרה", "/פרשה/חיי-שרה"],
		])("redirects %s permanently to its canonical slug", async (path, slug) => {
			const result = await proxy(makeRequest(path));
			expect(result?.status).toBe(308);
			expect(decodeURIComponent(result?.headers.get("location") ?? "")).toBe(
				`https://localhost${slug}`,
			);
		});

		it("preserves reader and tracking params on the redirect", async () => {
			const result = await proxy(
				makeRequest("/פרשה/1?perush=Rashi&utm_source=test"),
			);
			expect(result?.status).toBe(308);
			const location = result?.headers.get("location") ?? "";
			expect(decodeURIComponent(location.split("?")[0])).toBe(
				"https://localhost/פרשה/בראשית",
			);
			expect(location).toContain("perush=Rashi");
			expect(location).toContain("utm_source=test");
		});

		it("consolidates unresolvable ASCII-root paths under the Hebrew root", async () => {
			const result = await proxy(makeRequest("/parasha/not-a-unit"));
			expect(result?.status).toBe(308);
			expect(decodeURIComponent(result?.headers.get("location") ?? "")).toBe(
				"https://localhost/פרשה/not-a-unit",
			);
		});

		it("consolidates deeper ASCII-root paths verbatim under the Hebrew root", async () => {
			// Book-chrome depth paths keep their remaining segments — the
			// Hebrew root's own chrome handling (noindex / 404) applies
			// after the redirect.
			const result = await proxy(makeRequest("/parasha/בראשית/כריכה"));
			expect(result?.status).toBe(308);
			expect(decodeURIComponent(result?.headers.get("location") ?? "")).toBe(
				"https://localhost/פרשה/בראשית/כריכה",
			);
		});

		it.each([
			// Unknown and out-of-range segments fall through to the router's
			// 404 — the proxy never redirects to a dead end.
			"/פרשה/55",
			"/פרשה/not-a-unit",
			"/פרשה/1garbage",
			// Three-segment paths skip unit canonicalization entirely
			// (book chrome gets its own noindex handling above).
			"/פרשה/בראשית/not-a-cover",
			"/other/1",
			"/%invalid/1",
		])("leaves non-unit %s untouched", async (path) => {
			expect(await proxy(makeRequest(path))).toBeUndefined();
		});
	});

	describe("parasha search exclusion", () => {
		it.each([
			"/פרשה?book",
			"/פרשה/בראשית?perush=Rashi",
			"/פרשה/בראשית?article=123",
			"/פרשה/וזאת-הברכה?haftaraPerush=Rashi",
			"/פרשה/וזאת-הברכה?haftaraArticle=123",
			"/פרשה/בראשית?bookPage=front",
			"/פרשה/בראשית?toc",
			"/פרשה/לך-לך?haftara",
			"/פרשה/בראשית?reading=weekday&scheme=default",
			"/פרשה/בראשית?scheme=default",
			"/פרשה/בראשית?variant=chabad",
			"/פרשה/בראשית?perush=",
			"/פרשה/בראשית/כריכה",
			"/פרשה/דברים/גב",
		])("keeps the reader usable but excludes %s", async (path) => {
			const response = await proxy(makeRequest(path, { ua: "Googlebot/2.1" }));
			expect(response?.status).toBe(200);
			expect(response?.headers.get("x-middleware-next")).toBe("1");
			expect(response?.headers.get("x-robots-tag")).toBe("noindex, follow");
		});

		it.each([
			"/929/1/123?book&article=123",
			"/929/1/Rashi?perush=Rashi",
			"/other?perush=Rashi",
			"/parasha-other/1?book",
			"/%invalid/1?book",
		])("does not exclude unrelated %s", async (path) => {
			const response = await proxy(makeRequest(path));
			// Corpus paths now pass through with discovery Link headers —
			// the assertion that matters is that noindex never leaks out
			// of the parasha family.
			expect(response?.headers.get("x-robots-tag") ?? null).toBeNull();
		});

		it("does not carry a variant's exclusion into later base requests", async () => {
			for (const suffix of ["", "?perush=Rashi", "", "?book", ""]) {
				const response = await proxy(makeRequest(`/פרשה/בראשית${suffix}`));
				expect(response?.headers.get("x-robots-tag")).toBe(
					suffix ? "noindex, follow" : null,
				);
			}
		});
	});

	describe("bypassed paths", () => {
		it.each([
			"/api/health",
			"/api/health/ready",
			"/favicon.ico",
			"/style.css",
			"/bundle.js",
			"/image.png",
			"/photo.jpg",
			"/icon.svg",
			"/font.woff2",
		])("returns undefined for %s", async (path) => {
			const result = await proxy(makeRequest(path));
			expect(result).toBeUndefined();
		});
	});

	describe("crawler parity (issue #3257)", () => {
		it.each([
			// Crawlers the legacy denylist used to block — now identical to
			// any other agent on the public corpus.
			"Bytespider",
			"MJ12bot/v1.4.8",
			"AhrefsBot/7.0",
			"SemrushBot/7~bl",
			"DotBot/1.2",
			"PetalBot",
			"BLEXBot/1.0",
			"MegaIndex.ru/2.0",
			"Sogou web spider/4.0",
			"DataForSeoBot/1.0",
			// Search + AI crawlers.
			"Googlebot/2.1",
			"GPTBot/1.2",
			"ClaudeBot/1.0",
			"meta-externalagent/1.1",
			"OAI-SearchBot/1.0",
			// Browsers and unknown agents.
			"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
			"totally-unknown-agent/9.9",
		])("serves the public corpus to %s exactly like a browser", async (ua) => {
			const result = await proxy(makeRequest("/929/1", { ua }));
			expect(result?.status).not.toBe(403);
			expect(result?.headers.get("x-middleware-next")).toBe("1");
		});

		it("returns the same response shape with no user-agent", async () => {
			const result = await proxy(makeRequest("/929/1"));
			expect(result?.headers.get("x-middleware-next")).toBe("1");
		});
	});

	describe("markdown discovery headers (issue #3257)", () => {
		it.each([
			["/", "/.md"],
			["/929", "/929.md"],
			["/929/1", "/929/1.md"],
			["/929/1/42", "/929/1/42.md"],
			// Link headers carry the URI-encoded canonical path, the same
			// spelling the sitemap uses.
			["/929/1/רש%22י", `/929/1/${encodeURIComponent('רש"י')}.md`],
			["/929/authors", "/929/authors.md"],
			["/פרשה", `/${encodeURIComponent("פרשה")}.md`],
			["/מסורה/7", `/${encodeURIComponent("מסורה")}/7.md`],
			["/masora/7", "/masora/7.md"],
			["/מועדים/פסח", `/${encodeURIComponent("מועדים")}/${encodeURIComponent("פסח")}.md`],
			["/pedia", "/pedia.md"],
			[`/pedia/${encodeURIComponent("אברהם")}`, `/pedia/${encodeURIComponent("אברהם")}.md`],
		])("advertises the .md alternate + guides on %s", async (path, mdPath) => {
			const response = await proxy(makeRequest(path));
			expect(response?.headers.get("x-middleware-next")).toBe("1");
			expect(response?.headers.get("vary")).toContain("Accept");
			const link = response?.headers.get("link") ?? "";
			expect(link).toContain(`<${mdPath}>; rel="alternate"; type="text/markdown"`);
			expect(link).toContain('</llms.txt>; rel="help"');
			expect(link).toContain('rel="api-catalog"');
		});

		it("does not add corpus headers to non-corpus paths", async () => {
			const response = await proxy(makeRequest("/api/search?q=x"));
			expect(response).toBeUndefined();
		});
	});

	describe("markdown negotiation + .md URLs (issue #3257)", () => {
		it.each([
			["/929/1.md", "/md/929/1"],
			["/929.md", "/md/929"],
			["/929/1/42.md", "/md/929/1/42"],
			["/.md", "/md/"],
			["/פרשה/בראשית.md", "/md/פרשה/בראשית"],
			["/מסורה/3.md", "/md/מסורה/3"],
			["/masora/3.md", "/md/masora/3"],
			["/מועדים/פסח.md", "/md/מועדים/פסח"],
			// rewrittenPath decodes the destination before comparing.
			[`/pedia/${encodeURIComponent("אברהם")}.md`, "/md/pedia/אברהם"],
			["/929/1.MD", "/md/929/1"],
		])("rewrites explicit %s to the markdown route", async (path, dest) => {
			const response = await proxy(makeRequest(path));
			expect(rewrittenPath(response)).toBe(
				dest === "/md/" ? "/md/" : dest,
			);
		});

		it("rewrites a text/markdown-preferred canonical URL the same way", async () => {
			const response = await proxy(
				makeRequest("/929/1", { accept: "text/markdown" }),
			);
			expect(rewrittenPath(response)).toBe("/md/929/1");
		});

		it("does not rewrite markdown-tied or plain-Accept requests", async () => {
			for (const accept of [
				"text/html,application/xhtml+xml;q=0.9,*/*;q=0.8",
				"text/markdown;q=0.5,text/html;q=1",
				"*/*",
				"application/json",
				"text/*",
			]) {
				const response = await proxy(makeRequest("/929/1", { accept }));
				expect(rewrittenPath(response)).toBeNull();
				expect(response?.headers.get("x-middleware-next")).toBe("1");
			}
		});

		it("keeps .md out of non-corpus and management paths", async () => {
			for (const path of [
				"/api/search.md",
				"/dev/dashboard.md",
				"/api/dev/x.md",
				"/foo/bar.md",
				"/929/930.md",
				"/פרשה/55.md",
			]) {
				const response = await proxy(makeRequest(path));
				expect(rewrittenPath(response)).toBeNull();
			}
		});

		it("never rewrites non-GET requests even for .md or markdown Accept", async () => {
			for (const method of ["POST", "PUT", "DELETE"]) {
				expect(
					rewrittenPath(await proxy(makeRequest("/929/1.md", { method }))),
				).toBeNull();
				expect(
					rewrittenPath(
						await proxy(
							makeRequest("/929/1", { method, accept: "text/markdown" }),
						),
					),
				).toBeNull();
			}
		});

		it("serves .md through HEAD too", async () => {
			const response = await proxy(makeRequest("/929/1.md", { method: "HEAD" }));
			expect(rewrittenPath(response)).toBe("/md/929/1");
		});

		it("keeps the .md suffix on alias redirects", async () => {
			const parasha = await proxy(makeRequest("/פרשה/1.md"));
			expect(parasha?.status).toBe(308);
			expect(
				decodeURIComponent(parasha?.headers.get("location") ?? ""),
			).toBe("https://localhost/פרשה/בראשית.md");

			const pedia = await proxy(makeRequest("/tanahpedia/person.md"));
			expect(pedia?.status).toBe(308);
			expect(
				decodeURIComponent(pedia?.headers.get("location") ?? ""),
			).toBe(`https://localhost/pedia/אישים.md`);
		});
	});

	describe("legacy tanahpedia alias", () => {
		it.each([
			["/tanahpedia", "/pedia"],
			["/tanahpedia/", "/pedia"],
			["/tanahpedia/person", `/pedia/${encodeURIComponent("אישים")}`],
			[
				"/tanahpedia/person?role=prophet",
				`/pedia/${encodeURIComponent("נביאים")}`,
			],
			["/tanahpedia/animal?kind=chaya", `/pedia/${encodeURIComponent("חיות")}`],
			[
				"/tanahpedia/animal?purity=tahor",
				`/pedia/${encodeURIComponent("טהורים")}`,
			],
			["/tanahpedia/nonsense", "/pedia"],
			["/tanahpedia/jerusalem", `/pedia/${encodeURIComponent("ירושלים")}`],
			["/pedia/jerusalem", `/pedia/${encodeURIComponent("ירושלים")}`],
			["/pedia/person", `/pedia/${encodeURIComponent("אישים")}`],
			["/pedia/person?role=prophet", `/pedia/${encodeURIComponent("נביאים")}`],
			[
				`/pedia/${encodeURIComponent("אישים")}?role=${encodeURIComponent("נביאים")}`,
				`/pedia/${encodeURIComponent("נביאים")}`,
			],
		])("redirects %s permanently", async (path, expectedPath) => {
			const result = await proxy(makeRequest(path));

			expect(result?.status).toBe(308);
			expect(result?.headers.get("location")).toBe(
				`https://localhost${expectedPath}`,
			);
		});

		it("does not redirect an already-canonical category slug", async () => {
			// /pedia/אישים resolves to the canonical Hebrew slug with no
			// filters — no redirect, just the corpus discovery headers.
			const result = await proxy(
				makeRequest(`/pedia/${encodeURIComponent("אישים")}`),
			);
			expect(result?.headers.get("location")).toBeNull();
			expect(result?.headers.get("x-middleware-next")).toBe("1");
		});

		it("leaves the tanahpedia preview API untouched", async () => {
			const result = await proxy(makeRequest("/api/tanahpedia/preview/moshe"));
			expect(result).toBeUndefined();
		});
	});

	describe("IndexNow key file", () => {
		// Low-entropy placeholder that secret scanners ignore.
		const KEY = "indexnow-test-key-0001";

		afterEach(() => {
			delete process.env.INDEXNOW_KEY;
		});

		it("serves the key verbatim at /<key>.txt on any host", async () => {
			process.env.INDEXNOW_KEY = KEY;
			const result = await proxy(makeRequest(`/${KEY}.txt`));

			expect(result?.status).toBe(200);
			expect(result?.headers.get("content-type")).toContain("text/plain");
			expect(await result?.text()).toBe(KEY);
		});

		it("passes through when no key is configured", async () => {
			delete process.env.INDEXNOW_KEY;
			const result = await proxy(makeRequest(`/${KEY}.txt`));
			expect(result).toBeUndefined();
		});

		it("passes through for a different .txt path", async () => {
			process.env.INDEXNOW_KEY = KEY;
			const result = await proxy(makeRequest("/other.txt"));
			expect(result).toBeUndefined();
		});

		it("does not serve the key under a nested path", async () => {
			process.env.INDEXNOW_KEY = KEY;
			const result = await proxy(makeRequest(`/sub/${KEY}.txt`));
			expect(result).toBeUndefined();
		});
	});

	describe("config", () => {
		it("exports a matcher that excludes _next/static, _next/image, and favicon.ico", () => {
			expect(config.matcher).toEqual([
				"/((?!_next/static|_next/image|favicon.ico).*)",
			]);
		});
	});
});
