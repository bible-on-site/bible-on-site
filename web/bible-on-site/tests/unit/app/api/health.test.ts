/** @jest-environment node */
import { GET as healthGet } from "@/app/api/health/route";

test("liveness returns immediately without depending on content", async () => {
	const response = healthGet();
	expect(response.status).toBe(200);
	expect(await response.json()).toEqual({ status: "ok" });
});

describe("GET /api/health/ready", () => {
	let mockQuery: jest.Mock;
	let mockPerek: jest.Mock;
	let mockRecitation: jest.Mock;
	beforeEach(() => {
		jest.resetModules();
		mockQuery = jest
			.fn()
			.mockResolvedValue([{ authorCount: 64, articleCount: 2681 }]);
		mockPerek = jest.fn();
		mockRecitation = jest.fn();
		jest.doMock("@/lib/api-client", () => ({ query: mockQuery }));
		jest.doMock("@/data/perek-dto", () => ({ getPerekByPerekId: mockPerek }));
		jest.doMock("@/lib/recitation-response", () => ({
			recitationResponse: mockRecitation,
		}));
		jest.spyOn(console, "error").mockImplementation(() => {});
	});
	afterEach(() => jest.restoreAllMocks());
	test("checks public content without requiring bulletin approval", async () => {
		const { GET } = await import("@/app/api/health/ready/route");
		const response = await GET();
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({
			status: "ready",
			warmed: true,
			content: { authorCount: 64, articleCount: 2681 },
		});
		expect(mockQuery.mock.calls[0][0]).not.toContain("distributable");
	});
	test("rechecks the database even after canonical data has warmed", async () => {
		const { GET } = await import("@/app/api/health/ready/route");
		await GET();
		mockQuery.mockRejectedValueOnce(new Error("Database unavailable"));
		expect((await GET()).status).toBe(503);
		expect(mockPerek).toHaveBeenCalledTimes(2);
		expect(mockQuery).toHaveBeenCalledTimes(2);
	});
	test("rechecks recitation preparation after warming and recovers from failure", async () => {
		const { GET } = await import("@/app/api/health/ready/route");
		expect((await GET()).status).toBe(200);
		mockRecitation.mockImplementationOnce(() => {
			throw new Error("Recitation validation failed");
		});
		const failed = await GET();
		expect(failed.status).toBe(503);
		expect((await failed.json()).message).toBe("Recitation validation failed");
		expect(mockQuery).toHaveBeenCalledTimes(1);
		expect((await GET()).status).toBe(200);
		expect(mockPerek).toHaveBeenCalledTimes(2);
		expect(mockRecitation).toHaveBeenCalledTimes(3);
	});
	test.each([
		{ rows: [] },
		{ rows: [{ authorCount: 0, articleCount: 0 }] },
		{ rows: [{ authorCount: 0, articleCount: 10 }] },
		{ rows: [{ authorCount: 2, articleCount: 0 }] },
	])("rejects missing public content: %j", async ({ rows }) => {
		mockQuery.mockResolvedValue(rows);
		const { GET } = await import("@/app/api/health/ready/route");
		expect((await GET()).status).toBe(503);
	});
	test.each([new Error("Canonical load failed"), "string error"])(
		"rejects canonical loading failures: %j",
		async (error) => {
			mockPerek.mockImplementation(() => {
				throw error;
			});
			const { GET } = await import("@/app/api/health/ready/route");
			const response = await GET();
			expect(response.status).toBe(503);
			expect((await response.json()).message).toBe(
				error instanceof Error ? error.message : "Unknown error",
			);
		},
	);
});
