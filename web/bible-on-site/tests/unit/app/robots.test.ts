jest.mock("next/headers", () => ({
	headers: jest.fn(),
}));

import { headers } from "next/headers";
import robots from "@/app/robots";

describe("robots", () => {
	beforeEach(() => {
		jest.clearAllMocks();
	});

	it("allows all user agents to crawl /", async () => {
		(headers as jest.Mock).mockResolvedValue({
			get: () => "example.com",
		});

		const result = await robots();

		expect(result.rules).toEqual(
			expect.objectContaining({
				userAgent: "*",
				allow: "/",
			}),
		);
	});

	it("disallows /api/ for all user agents", async () => {
		(headers as jest.Mock).mockResolvedValue({
			get: () => "example.com",
		});

		const result = await robots();

		const rules = Array.isArray(result.rules) ? result.rules : [result.rules];
		const disallowed = rules.flatMap((r) =>
			Array.isArray(r.disallow) ? r.disallow : [r.disallow],
		);
		expect(disallowed).toContain("/api/");
	});

	it("derives sitemap URL from host header", async () => {
		(headers as jest.Mock).mockResolvedValue({
			get: (name: string) => (name === "host" ? "my-host.example.com" : null),
		});

		const result = await robots();

		expect(result.sitemap).toBe("https://my-host.example.com/sitemap.xml");
	});

	it("falls back to xn--febl3a.co.il when host header is absent", async () => {
		(headers as jest.Mock).mockResolvedValue({
			get: () => null,
		});

		const result = await robots();

		expect(result.sitemap).toBe("https://xn--febl3a.co.il/sitemap.xml");
	});

	it("does not set crawl-delay", async () => {
		(headers as jest.Mock).mockResolvedValue({
			get: () => "example.com",
		});

		const result = await robots();

		const rules = Array.isArray(result.rules) ? result.rules : [result.rules];
		for (const rule of rules) {
			expect((rule as Record<string, unknown>).crawlDelay).toBeUndefined();
		}
	});
});
