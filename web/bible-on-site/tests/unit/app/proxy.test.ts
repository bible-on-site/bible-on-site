/**
 * @jest-environment node
 */
import { NextRequest } from "next/server";
import { config, proxy } from "@/proxy";

function makeRequest(
	pathname: string,
	opts?: { ua?: string },
): NextRequest {
	const headers: Record<string, string> = {};
	if (opts?.ua) headers["user-agent"] = opts.ua;
	return new NextRequest(new URL(pathname, "https://localhost"), { headers });
}

describe("proxy", () => {
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

	describe("config", () => {
		it("exports a matcher that excludes _next/static, _next/image, and favicon.ico", () => {
			expect(config.matcher).toEqual([
				"/((?!_next/static|_next/image|favicon.ico).*)",
			]);
		});
	});
});
