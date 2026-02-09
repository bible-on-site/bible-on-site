/**
 * @jest-environment node
 */
import { GET as healthGet } from "@/app/api/health/route";

describe("GET /api/health", () => {
	it("returns 200 with status ok", () => {
		const response = healthGet();
		expect(response.status).toBe(200);
		expect(response).toBeInstanceOf(Response);
	});

	it("returns JSON body with status ok", async () => {
		const response = healthGet();
		const body = await response.json();
		expect(body).toEqual({ status: "ok" });
	});
});

describe("GET /api/health/ready", () => {
	it("returns 200 with status ready and warmed", async () => {
		const { GET: readyGet } = await import("@/app/api/health/ready/route");
		const response = readyGet();
		expect(response.status).toBe(200);
		const body = await response.json();
		expect(body.status).toBe("ready");
		expect(body.warmed).toBe(true);
	});
});
