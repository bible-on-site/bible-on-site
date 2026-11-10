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
	let mockSanitize: jest.Mock;
	let mockPerekIndex: jest.Mock;
	let mockPasukIndex: jest.Mock;
	let mockPages: jest.Mock;
	beforeEach(() => {
		jest.resetModules();
		mockQuery = jest
			.fn()
			.mockResolvedValue([{ authorCount: 64, articleCount: 2681 }]);
		mockPerek = jest.fn();
		mockRecitation = jest.fn();
		mockSanitize = jest.fn((html: string) => html);
		mockPerekIndex = jest.fn();
		mockPasukIndex = jest.fn();
		mockPages = jest.fn().mockResolvedValue(undefined);
		jest.doMock("@/lib/server-page-readiness", () => ({
			warmServerPages: mockPages,
		}));
		jest.doMock("@/lib/search/corpus", () => ({
			getPerekIndex: mockPerekIndex,
			getPasukIndex: mockPasukIndex,
		}));
		jest.doMock("isomorphic-dompurify", () => ({
			__esModule: true,
			default: { sanitize: mockSanitize },
		}));
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
	test("withholds readiness until page rendering completes and rejects failure", async () => {
		let finish!: () => void;
		mockPages.mockReturnValueOnce(
			new Promise<void>((resolve) => {
				finish = resolve;
			}),
		);
		const { GET } = await import("@/app/api/health/ready/route");
		let admitted = false;
		const pending = GET().then((response) => {
			admitted = true;
			return response;
		});
		await Promise.resolve();
		expect(admitted).toBe(false);
		finish();
		expect((await pending).status).toBe(200);
		mockPages.mockRejectedValueOnce(new Error("Page renderer unavailable"));
		const failed = await GET();
		expect(failed.status).toBe(503);
		expect((await failed.json()).message).toBe("Page renderer unavailable");
		expect((await GET()).status).toBe(200);
	});
	test("rechecks the database even after canonical data has warmed", async () => {
		const { GET } = await import("@/app/api/health/ready/route");
		await GET();
		mockQuery.mockRejectedValueOnce(new Error("Database unavailable"));
		expect((await GET()).status).toBe(503);
		expect(mockPerek).toHaveBeenCalledTimes(2);
		expect(mockSanitize).toHaveBeenCalledTimes(1);
		expect(mockPerekIndex).toHaveBeenCalledTimes(1);
		expect(mockPasukIndex).toHaveBeenCalledTimes(1);
		expect(mockQuery).toHaveBeenCalledTimes(2);
	});
	test("shares one in-flight check between concurrent probes", async () => {
		const { GET } = await import("@/app/api/health/ready/route");
		let finish!: () => void;
		mockQuery.mockImplementationOnce(
			() =>
				new Promise((resolve) => {
					finish = () => resolve([{ authorCount: 64, articleCount: 2681 }]);
				}),
		);
		const first = GET();
		const second = GET();
		finish();
		const [a, b] = await Promise.all([first, second]);
		expect(a.status).toBe(200);
		expect(b.status).toBe(200);
		expect(mockQuery).toHaveBeenCalledTimes(1);
		// The next sequential probe still re-verifies the database.
		expect((await GET()).status).toBe(200);
		expect(mockQuery).toHaveBeenCalledTimes(2);
	});
	test("requires complete search indexes before admission and recovers from preparation failure", async () => {
		mockPasukIndex.mockImplementationOnce(() => {
			throw new Error("Verse search index unavailable");
		});
		const { GET } = await import("@/app/api/health/ready/route");
		const failed = await GET();
		expect(failed.status).toBe(503);
		expect((await failed.json()).message).toBe(
			"Verse search index unavailable",
		);
		// The database check now overlaps the warm-up instead of following it.
		expect(mockQuery).toHaveBeenCalledTimes(1);
		expect(mockRecitation).not.toHaveBeenCalled();
		expect((await GET()).status).toBe(200);
		expect(mockPerekIndex).toHaveBeenCalledTimes(2);
		expect(mockPasukIndex).toHaveBeenCalledTimes(2);
	});
	test("reports a concurrent content failure masked by a warm-up error", async () => {
		mockQuery.mockRejectedValue(new Error("Database unavailable"));
		mockPasukIndex.mockImplementationOnce(() => {
			throw new Error("Verse search index unavailable");
		});
		const { GET } = await import("@/app/api/health/ready/route");
		const failed = await GET();
		expect(failed.status).toBe(503);
		expect((await failed.json()).message).toBe(
			"Verse search index unavailable",
		);
		// The overlapped query still failed; its error reaches diagnostics
		// instead of being swallowed by the warm-up failure.
		expect(console.error).toHaveBeenCalledWith(
			"Concurrent content readiness failure:",
			expect.any(Error),
		);
	});
	test("requires a working HTML sanitizer before admitting traffic and can recover", async () => {
		mockSanitize.mockReturnValueOnce("");
		const { GET } = await import("@/app/api/health/ready/route");
		const failed = await GET();
		expect(failed.status).toBe(503);
		expect((await failed.json()).message).toBe("HTML sanitizer is unavailable");
		expect(mockQuery).toHaveBeenCalledTimes(1);
		expect(mockRecitation).not.toHaveBeenCalled();
		expect((await GET()).status).toBe(200);
		expect(mockSanitize).toHaveBeenCalledTimes(2);
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
		// The content query fires concurrently, even on a check the recitation
		// gate then fails.
		expect(mockQuery).toHaveBeenCalledTimes(2);
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
