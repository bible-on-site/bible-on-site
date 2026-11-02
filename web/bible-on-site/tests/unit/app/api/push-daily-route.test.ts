/** @jest-environment node */
const mockSend = jest.fn();
const mockConfigured = jest.fn();
jest.mock("@/lib/web-push", () => ({
	isWebPushConfigured: () => mockConfigured(),
	sendDailyPerek: (...args: unknown[]) => mockSend(...args),
}));

import { POST } from "@/app/api/push/daily/route";

const call = (authorization?: string) =>
	POST(
		new Request("http://localhost/api/push/daily", {
			method: "POST",
			headers: authorization ? { authorization } : {},
		}),
	);

describe("POST /api/push/daily", () => {
	beforeEach(() => {
		jest.clearAllMocks();
		mockConfigured.mockReturnValue(true);
		process.env.PUSH_SEND_SECRET = "s3cret";
		mockSend.mockResolvedValue({ sent: 3, removed: 1, failed: 0 });
	});
	afterEach(() => {
		delete process.env.PUSH_SEND_SECRET;
		delete process.env.MOCK_DATE;
	});

	it("returns 503 when web push is not configured", async () => {
		mockConfigured.mockReturnValue(false);
		expect((await call("Bearer s3cret")).status).toBe(503);
	});

	it.each([undefined, "Bearer wrong", "s3cret"])(
		"rejects authorization %s",
		async (authorization) => {
			expect((await call(authorization)).status).toBe(401);
			expect(mockSend).not.toHaveBeenCalled();
		},
	);

	describe("on a study day", () => {
		// Sunday 2026-11-01, mid-morning in Israel.
		beforeEach(() => {
			process.env.MOCK_DATE = "2026-11-01T06:00:00Z";
		});

		it("sends today's perek and reports the counts", async () => {
			const response = await call("Bearer s3cret");
			const body = await response.json();
			expect(response.status).toBe(200);
			expect(mockSend).toHaveBeenCalledWith(body.perekId);
			expect(body).toEqual({
				perekId: expect.any(Number),
				sent: 3,
				removed: 1,
				failed: 0,
			});
		});

		it("returns 500 when sending fails", async () => {
			jest.spyOn(console, "error").mockImplementation(() => {});
			mockSend.mockRejectedValue(new Error("db down"));
			expect((await call("Bearer s3cret")).status).toBe(500);
		});
	});

	it("skips Shabbat without notifying", async () => {
		process.env.MOCK_DATE = "2026-10-31T06:00:00Z";
		const response = await call("Bearer s3cret");
		expect(await response.json()).toEqual({ skipped: "review" });
		expect(mockSend).not.toHaveBeenCalled();
	});
});
