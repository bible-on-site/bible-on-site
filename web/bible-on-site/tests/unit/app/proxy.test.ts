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
	describe("parasha search exclusion", () => {
		it.each([
			"/פרשה?book",
			"/פרשה/1?perush=Rashi",
			"/פרשה/1?article=123",
			"/פרשה/54?haftaraPerush=Rashi",
			"/פרשה/54?haftaraArticle=123",
			"/פרשה/1?bookPage=front",
			"/פרשה/1?toc",
			"/פרשה/1?haftara",
			"/פרשה/1?reading=weekday&scheme=default",
			"/פרשה/1?scheme=default",
			"/פרשה/1?perush=",
			"/פרשה/בראשית/כריכה",
			"/פרשה/דברים/גב",
			"/parasha/1?book&article=123",
			`/${encodeURIComponent("פרשה").toLowerCase()}/1?book`,
		])("keeps the reader usable but excludes %s", async (path) => {
			const response = await proxy(makeRequest(path, { ua: "Googlebot/2.1" }));
			expect(response?.status).toBe(200);
			expect(response?.headers.get("x-middleware-next")).toBe("1");
			expect(response?.headers.get("x-robots-tag")).toBe("noindex, follow");
		});

		it.each([
			"/פרשה",
			"/פרשה/1",
			"/פרשה/54",
			"/parasha",
			"/parasha/1",
			"/פרשה/1?utm_source=test",
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
				const response = await proxy(makeRequest(`/פרשה/1${suffix}`));
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
