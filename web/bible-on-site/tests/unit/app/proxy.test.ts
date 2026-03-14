/**
 * @jest-environment node
 */
jest.mock("rate-limiter-flexible", () => {
	let consumed = 0;
	return {
		RateLimiterMemory: jest.fn().mockImplementation(({ points }) => ({
			consume: jest.fn().mockImplementation(async () => {
				consumed++;
				if (consumed > points) {
					throw new Error("Rate limit exceeded");
				}
				return { remainingPoints: points - consumed };
			}),
			_resetForTest: () => {
				consumed = 0;
			},
		})),
	};
});

jest.mock("@/util/environment", () => ({
	isProduction: jest.fn(),
}));

import { NextRequest } from "next/server";
import { RateLimiterMemory } from "rate-limiter-flexible";
import { config, proxy } from "@/proxy";
import { isProduction } from "@/util/environment";

function makeRequest(
	pathname: string,
	opts?: { ua?: string; ip?: string; forwardedFor?: string },
): NextRequest {
	const headers: Record<string, string> = {};
	if (opts?.ua) headers["user-agent"] = opts.ua;
	if (opts?.ip) headers["x-real-ip"] = opts.ip;
	if (opts?.forwardedFor) headers["x-forwarded-for"] = opts.forwardedFor;
	return new NextRequest(new URL(pathname, "https://localhost"), { headers });
}

function resetLimiter() {
	const instance = (RateLimiterMemory as jest.Mock).mock.results[0]?.value;
	instance?._resetForTest();
}

const mockIsProduction = isProduction as jest.MockedFunction<
	typeof isProduction
>;

describe("proxy", () => {
	beforeEach(() => {
		resetLimiter();
		mockIsProduction.mockReturnValue(true);
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
		])("returns 403 for blocked bot: %s", async (ua) => {
			const result = await proxy(makeRequest("/929/1", { ua, ip: "1.2.3.4" }));
			expect(result?.status).toBe(403);
		});

		it("blocks bots even in non-production", async () => {
			mockIsProduction.mockReturnValue(false);
			const result = await proxy(
				makeRequest("/929/1", { ua: "Bytespider", ip: "1.2.3.4" }),
			);
			expect(result?.status).toBe(403);
		});

		it("does not block legitimate crawlers like Googlebot", async () => {
			const result = await proxy(
				makeRequest("/929/1", { ua: "Googlebot/2.1", ip: "66.249.66.1" }),
			);
			expect(result?.status).not.toBe(403);
		});

		it("does not block regular browsers", async () => {
			const result = await proxy(
				makeRequest("/929/1", {
					ua: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
					ip: "203.0.113.1",
				}),
			);
			expect(result?.status).not.toBe(403);
		});
	});

	describe("non-production bypass", () => {
		beforeEach(() => {
			mockIsProduction.mockReturnValue(false);
		});

		it("skips rate limiting in non-production environment", async () => {
			const result = await proxy(makeRequest("/929/1", { ip: "10.0.0.1" }));
			expect(result?.status).toBe(200);
			expect(result?.headers.get("X-RateLimit-Remaining")).toBeNull();
		});
	});

	describe("direct access bypass (no reverse proxy)", () => {
		it("skips rate limiting when no IP headers are present", async () => {
			const result = await proxy(makeRequest("/929/1"));
			expect(result?.status).toBe(200);
		});

		it("skips rate limiting when x-forwarded-for is empty", async () => {
			const req = new NextRequest(new URL("/929/1", "https://localhost"), {
				headers: { "x-forwarded-for": "" },
			});
			const result = await proxy(req);
			expect(result?.status).toBe(200);
		});
	});

	describe("rate limiting", () => {
		it("sets X-RateLimit-Remaining header for normal requests", async () => {
			const result = await proxy(makeRequest("/929/1", { ip: "10.0.0.1" }));
			expect(result?.status).toBe(200);
			expect(result?.headers.get("X-RateLimit-Remaining")).toBeDefined();
		});

		it("extracts IP from x-forwarded-for when x-real-ip is absent", async () => {
			const result = await proxy(
				makeRequest("/929/1", { forwardedFor: "10.0.0.2, 192.168.1.1" }),
			);
			expect(result?.status).toBe(200);
		});

		it("returns 429 when rate limit is exceeded", async () => {
			for (let i = 0; i < 30; i++) {
				await proxy(makeRequest("/929/1", { ip: "10.99.1.1" }));
			}
			const result = await proxy(makeRequest("/929/1", { ip: "10.99.1.1" }));
			expect(result?.status).toBe(429);
		});

		it("includes Retry-After header in 429 response", async () => {
			for (let i = 0; i < 30; i++) {
				await proxy(makeRequest("/929/1", { ip: "10.98.1.1" }));
			}
			const result = await proxy(makeRequest("/929/1", { ip: "10.98.1.1" }));
			expect(result?.headers.get("Retry-After")).toBe("60");
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
