/** @jest-environment node */
const mockSend = jest.fn();
const mockConfigured = jest.fn();
jest.mock("@/lib/web-push", () => {
	const actual = jest.requireActual("@/lib/web-push/service");
	return {
		...actual,
		isWebPushConfigured: () => mockConfigured(),
		sendDailyPerek: (...args: unknown[]) => mockSend(...args),
	};
});
jest.mock("server-only", () => ({}));
// web-push 4 is ESM-only; the real service module must not reach the real
// package through requireActual under Jest's CommonJS runtime.
jest.mock("web-push", () => ({
	__esModule: true,
	sendNotification: jest.fn(),
	setVapidDetails: jest.fn(),
	WebPushError: class extends Error {},
}));

import { POST } from "@/app/api/push/daily/route";

const call = (authorization?: string, body?: unknown) =>
	POST(
		new Request("http://localhost/api/push/daily", {
			method: "POST",
			headers: authorization ? { authorization } : {},
			body: body === undefined ? undefined : JSON.stringify(body),
		}),
	);

const callRaw = (authorization: string, body: string) =>
	POST(
		new Request("http://localhost/api/push/daily", {
			method: "POST",
			headers: { authorization },
			body,
		}),
	);

const FCM = "https://fcm.googleapis.com/fcm/send/abc";
const privateFailure = () =>
	Object.assign(
		new Error(`request failed for ${FCM}`, {
			cause: new Error("private request body"),
		}),
		{ endpoint: FCM, body: "private request body" },
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
		jest.restoreAllMocks();
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
			expect(mockSend).toHaveBeenCalledWith(body.perekId, undefined);
			expect(body).toEqual({
				perekId: expect.any(Number),
				sent: 3,
				removed: 1,
				failed: 0,
			});
		});

		it("targets one subscription when the body names an endpoint", async () => {
			const response = await call("Bearer s3cret", { endpoint: FCM });
			const body = await response.json();
			expect(response.status).toBe(200);
			expect(mockSend).toHaveBeenCalledWith(body.perekId, FCM);
		});

		it("returns 502 when every attempted send failed (#3499)", async () => {
			mockSend.mockResolvedValue({ sent: 0, removed: 0, failed: 4 });
			const response = await call("Bearer s3cret");
			expect(response.status).toBe(502);
			expect(await response.json()).toMatchObject({
				sent: 0,
				removed: 0,
				failed: 4,
			});
		});

		it("stays 200 when some sends failed but others delivered", async () => {
			mockSend.mockResolvedValue({ sent: 2, removed: 1, failed: 3 });
			expect((await call("Bearer s3cret")).status).toBe(200);
		});

		it("stays 200 when nothing was sent and nothing failed", async () => {
			mockSend.mockResolvedValue({ sent: 0, removed: 2, failed: 0 });
			expect((await call("Bearer s3cret")).status).toBe(200);
			mockSend.mockResolvedValue({ sent: 0, removed: 0, failed: 0 });
			expect((await call("Bearer s3cret")).status).toBe(200);
		});

		it.each([
			["an unknown endpoint", { sent: 0, removed: 0, failed: 0 }],
			["an endpoint pruned as gone", { sent: 0, removed: 1, failed: 0 }],
		])(
			"returns 404 for a targeted check that matched no live subscription (%s)",
			async (_label, result) => {
				mockSend.mockResolvedValue(result);
				const response = await call("Bearer s3cret", { endpoint: FCM });
				expect(response.status).toBe(404);
			},
		);

		it("returns 502 for a targeted send that failed", async () => {
			mockSend.mockResolvedValue({ sent: 0, removed: 0, failed: 1 });
			const response = await call("Bearer s3cret", { endpoint: FCM });
			expect(response.status).toBe(502);
		});

		it("broadcasts when the supplied body is empty", async () => {
			const response = await callRaw("Bearer s3cret", "");
			const body = await response.json();
			expect(response.status).toBe(200);
			expect(mockSend).toHaveBeenCalledWith(body.perekId, undefined);
		});

		it.each([
			{ endpoint: "https://evil.example/fcm" },
			{ endpoint: "http://fcm.googleapis.com/fcm/send/x" },
			{ endpoint: 42 },
			{ endpoint: null },
			{ endpont: FCM }, // mistyped key must not broadcast
			{ note: "all" },
			{},
		])("rejects an invalid targeting body %#", async (body) => {
			expect((await call("Bearer s3cret", body)).status).toBe(400);
			expect(mockSend).not.toHaveBeenCalled();
		});

		it.each(["not json", "null", "42", '["https://fcm.googleapis.com/x"]'])(
			"rejects a malformed or non-object body %s",
			async (body) => {
				expect((await callRaw("Bearer s3cret", body)).status).toBe(400);
				expect(mockSend).not.toHaveBeenCalled();
			},
		);

		it("rejects an oversized body instead of silently broadcasting", async () => {
			const response = await call("Bearer s3cret", {
				pad: "x".repeat(5000),
			});
			expect(response.status).toBe(400);
			expect(mockSend).not.toHaveBeenCalled();
		});

		it("measures the targeting body limit in UTF-8 bytes", async () => {
			const response = await call("Bearer s3cret", {
				endpoint: FCM,
				pad: "א".repeat(2100),
			});
			expect(response.status).toBe(400);
			expect(mockSend).not.toHaveBeenCalled();
		});

		it("rejects an unreadable body without sending or logging private details", async () => {
			const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
			const request = new Request("http://localhost/api/push/daily", {
				method: "POST",
				headers: { authorization: "Bearer s3cret" },
				body: new ReadableStream<Uint8Array>({
					start(controller) {
						controller.error(privateFailure());
					},
				}),
				duplex: "half",
			} as RequestInit);
			expect((await POST(request)).status).toBe(400);
			expect(mockSend).not.toHaveBeenCalled();
			expect(warn).toHaveBeenCalledTimes(1);
			expect(warn).toHaveBeenCalledWith("Push daily request body read failed");
		});

		it("returns 500 when sending fails without logging private details", async () => {
			const error = jest.spyOn(console, "error").mockImplementation(() => {});
			mockSend.mockRejectedValue(privateFailure());
			expect((await call("Bearer s3cret")).status).toBe(500);
			expect(error).toHaveBeenCalledTimes(1);
			expect(error).toHaveBeenCalledWith("Daily web push failed");
		});
	});

	it("skips Shabbat without notifying", async () => {
		process.env.MOCK_DATE = "2026-10-31T06:00:00Z";
		const response = await call("Bearer s3cret");
		expect(await response.json()).toEqual({ skipped: "review" });
		expect(mockSend).not.toHaveBeenCalled();
	});
});
