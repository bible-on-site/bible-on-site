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

	it("uses cached warmed state on subsequent calls", async () => {
		const { GET: readyGet } = await import("@/app/api/health/ready/route");
		readyGet();
		const response = readyGet();
		expect(response.status).toBe(200);
		const body = await response.json();
		expect(body.warmed).toBe(true);
	});

	it("returns 503 when warming throws an error", async () => {
		jest.resetModules();
		jest.doMock("@/data/perek-dto", () => ({
			getPerekByPerekId: () => {
				throw new Error("Simulated failure");
			},
		}));
		const { GET: readyGet } = await import("@/app/api/health/ready/route");
		const response = readyGet();
		expect(response.status).toBe(503);
		const body = await response.json();
		expect(body.status).toBe("error");
		expect(body.message).toBe("Simulated failure");
	});

	it("returns 503 with 'Unknown error' for non-Error throws", async () => {
		jest.resetModules();
		jest.doMock("@/data/perek-dto", () => ({
			getPerekByPerekId: () => {
				throw "string error";
			},
		}));
		const { GET: readyGet } = await import("@/app/api/health/ready/route");
		const response = readyGet();
		expect(response.status).toBe(503);
		const body = await response.json();
		expect(body.message).toBe("Unknown error");
	});
});
