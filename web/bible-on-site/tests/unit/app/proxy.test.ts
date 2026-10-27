/**
 * @jest-environment node
 */
import { NextRequest } from "next/server";
import { config, proxy } from "@/proxy";

function makeRequest(pathname: string, opts?: { ua?: string }): NextRequest {
	const headers: Record<string, string> = {};
	if (opts?.ua) headers["user-agent"] = opts.ua;
	return new NextRequest(new URL(pathname, "https://localhost"), { headers });
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

		it.each([
			"/פרשה",
			"/פרשה/בראשית",
			"/פרשה/לך-לך",
			"/פרשה/וזאת-הברכה",
			// Unknown and out-of-range segments fall through to the router's
			// 404 — the proxy never redirects to a dead end.
			"/פרשה/55",
			"/פרשה/not-a-unit",
			"/פרשה/1garbage",
			// Three-segment paths skip unit canonicalization entirely
			// (book chrome gets its own noindex handling above).
			"/פרשה/בראשית/not-a-cover",
			"/929/153",
			"/other/1",
			"/%invalid/1",
		])("leaves canonical, unknown, and non-unit %s untouched", async (path) => {
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
			"/פרשה",
			"/פרשה/בראשית",
			"/פרשה/וזאת-הברכה",
			"/פרשה/בראשית?utm_source=test",
			"/פרשה/not-a-book/כריכה",
			"/פרשה/בראשית/not-a-book-page",
			"/929/153",
			"/929/1/123?book&article=123",
			"/929/1/Rashi?perush=Rashi",
			"/other?perush=Rashi",
			"/parasha-other/1?book",
			"/%invalid/1?book",
		])("does not exclude base content or unrelated %s", async (path) => {
			expect(await proxy(makeRequest(path))).toBeUndefined();
		});

		it("does not carry a variant's exclusion into later base requests", async () => {
			for (const suffix of ["", "?perush=Rashi", "", "?book", ""]) {
				const response = await proxy(makeRequest(`/פרשה/בראשית${suffix}`));
				expect(response?.headers.get("x-robots-tag")).toBe(
					suffix ? "noindex, follow" : undefined,
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

	describe("blocked bots", () => {
		it.each([
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
		])("returns 403 for blocked bot: %s", async (ua) => {
			const result = await proxy(makeRequest("/929/1", { ua }));
			expect(result?.status).toBe(403);
		});

		it("does not block legitimate crawlers like Googlebot", async () => {
			const result = await proxy(
				makeRequest("/929/1", { ua: "Googlebot/2.1" }),
			);
			expect(result).toBeUndefined();
		});

		it("does not block AI training crawlers like meta-externalagent", async () => {
			const result = await proxy(
				makeRequest("/929/1", {
					ua: "meta-externalagent/1.1 (+https://developers.facebook.com/docs/sharing/webmasters/crawler)",
				}),
			);
			expect(result).toBeUndefined();
		});

		it("does not block regular browsers", async () => {
			const result = await proxy(
				makeRequest("/929/1", {
					ua: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
				}),
			);
			expect(result).toBeUndefined();
		});
	});

	describe("non-blocked requests", () => {
		it("returns undefined for regular page requests", async () => {
			const result = await proxy(
				makeRequest("/929/1", {
					ua: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
				}),
			);
			expect(result).toBeUndefined();
		});

		it("returns undefined when no user-agent is set", async () => {
			const result = await proxy(makeRequest("/929/1"));
			expect(result).toBeUndefined();
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

		it("leaves the tanahpedia preview API untouched", async () => {
			const result = await proxy(makeRequest("/api/tanahpedia/preview/moshe"));
			expect(result).toBeUndefined();
		});

		it.each([
			"/pedia",
			`/pedia/${encodeURIComponent("אישים")}`,
			`/pedia/${encodeURIComponent("נביאים")}`,
			`/pedia/${encodeURIComponent("משה-רבנו")}`,
		])("leaves canonical %s untouched", async (path) => {
			const result = await proxy(makeRequest(path));
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

	describe("BOT_BLOCKING_ENABLED", () => {
		it("allows a blocked crawler when bot blocking is disabled", async () => {
			jest.replaceProperty(process, "env", {
				...process.env,
				BOT_BLOCKING_ENABLED: "false",
			});
			let configuredProxy: typeof proxy = proxy;
			jest.isolateModules(() => {
				configuredProxy = require("@/proxy").proxy;
			});
			try {
				expect(
					await configuredProxy(makeRequest("/929/1", { ua: "Bytespider" })),
				).toBeUndefined();
			} finally {
				jest.restoreAllMocks();
			}
		});
		it("blocks bots by default (env var not set)", async () => {
			const result = await proxy(makeRequest("/929/1", { ua: "Bytespider" }));
			expect(result?.status).toBe(403);
		});
	});
});
