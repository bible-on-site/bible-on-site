/**
 * @jest-environment node
 */
import { GET } from "../../../src/app/api/store-metadata/[platform]/route";

describe("GET /api/store-metadata/[platform]", () => {
	afterEach(() => jest.restoreAllMocks());

	it("404s on an unknown platform", async () => {
		const response = await GET(new Request("http://x"), {
			params: Promise.resolve({ platform: "switch" }),
		});
		expect(response.status).toBe(404);
	});

	it("returns metadata JSON with cache headers for a platform", async () => {
		jest
			.spyOn(globalThis, "fetch")
			.mockResolvedValue(new Response('"141":[[["5.0.139"]]]'));
		const response = await GET(new Request("http://x"), {
			params: Promise.resolve({ platform: "android" }),
		});
		expect(response.status).toBe(200);
		expect(response.headers.get("cache-control")).toContain("max-age");
		const body = await response.json();
		expect(body.platform).toBe("android");
	});
});
