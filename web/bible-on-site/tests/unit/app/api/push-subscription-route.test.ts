/** @jest-environment node */
const mockSave = jest.fn();
const mockDelete = jest.fn();
const mockConfigured = jest.fn();
jest.mock("@/lib/web-push", () => {
	const actual = jest.requireActual("@/lib/web-push/service");
	return {
		...actual,
		isWebPushConfigured: () => mockConfigured(),
		saveSubscription: (...args: unknown[]) => mockSave(...args),
		deleteSubscription: (...args: unknown[]) => mockDelete(...args),
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

import { DELETE, GET, POST } from "@/app/api/push/subscription/route";

const FCM = "https://fcm.googleapis.com/fcm/send/abc";
const privateFailure = () =>
	Object.assign(
		new Error(`request failed for ${FCM}`, {
			cause: new Error("private request body"),
		}),
		{ endpoint: FCM, body: "private request body" },
	);
const subscription = { endpoint: FCM, keys: { p256dh: "BN-1", auth: "t_8" } };
const request = (method: string, body: unknown) =>
	new Request("http://localhost/api/push/subscription", {
		method,
		body: typeof body === "string" ? body : JSON.stringify(body),
	});

describe("/api/push/subscription", () => {
	beforeEach(() => {
		jest.clearAllMocks();
		mockConfigured.mockReturnValue(true);
		process.env.VAPID_PUBLIC_KEY = "public-key";
		jest.spyOn(console, "error").mockImplementation(() => {});
	});
	afterEach(() => {
		delete process.env.VAPID_PUBLIC_KEY;
		jest.restoreAllMocks();
	});

	describe("when web push is not configured", () => {
		beforeEach(() => mockConfigured.mockReturnValue(false));

		it("hides the public key and refuses subscriptions", async () => {
			const response = GET();
			expect(response.status).toBe(200);
			expect(await response.json()).toEqual({ publicKey: null });
			expect((await POST(request("POST", subscription))).status).toBe(404);
			expect(mockSave).not.toHaveBeenCalled();
		});
	});

	it("GET returns the VAPID public key", async () => {
		const response = GET();
		expect(await response.json()).toEqual({ publicKey: "public-key" });
	});

	it.each(["POST", "DELETE"])(
		"%s rejects bodies over the UTF-8 byte limit",
		async (method) => {
			const handler = method === "POST" ? POST : DELETE;
			const response = await handler(
				request(method, { ...subscription, pad: "א".repeat(2100) }),
			);
			expect(response.status).toBe(400);
			expect(mockSave).not.toHaveBeenCalled();
			expect(mockDelete).not.toHaveBeenCalled();
		},
	);

	it.each(["POST", "DELETE"])(
		"%s rejects an unreadable body without logging private details",
		async (method) => {
			const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
			const handler = method === "POST" ? POST : DELETE;
			const req = request(method, subscription);
			jest.spyOn(req, "text").mockRejectedValue(privateFailure());
			expect((await handler(req)).status).toBe(400);
			expect(mockSave).not.toHaveBeenCalled();
			expect(mockDelete).not.toHaveBeenCalled();
			expect(warn).toHaveBeenCalledTimes(1);
			expect(warn).toHaveBeenCalledWith("Push subscription body read failed");
		},
	);

	describe("POST", () => {
		it("stores a valid subscription", async () => {
			const response = await POST(request("POST", subscription));
			expect(response.status).toBe(201);
			expect(mockSave).toHaveBeenCalledWith(subscription);
		});

		it.each([
			"not json",
			JSON.stringify({ ...subscription, endpoint: "https://evil.example/" }),
			JSON.stringify({ ...subscription, pad: "x".repeat(5000) }),
		])("rejects an invalid body", async (body) => {
			expect((await POST(request("POST", body))).status).toBe(400);
			expect(mockSave).not.toHaveBeenCalled();
		});

		it("returns 503 when the database write fails without logging private details", async () => {
			mockSave.mockRejectedValue(privateFailure());
			expect((await POST(request("POST", subscription))).status).toBe(503);
			expect(console.error).toHaveBeenCalledTimes(1);
			expect(console.error).toHaveBeenCalledWith(
				"Failed to save push subscription",
			);
		});
	});

	describe("DELETE", () => {
		it("removes the subscription even when push is unconfigured", async () => {
			mockConfigured.mockReturnValue(false);
			const response = await DELETE(request("DELETE", { endpoint: FCM }));
			expect(await response.json()).toEqual({ subscribed: false });
			expect(mockDelete).toHaveBeenCalledWith(FCM);
		});

		it.each(["null", JSON.stringify({ endpoint: "https://evil.example/" })])(
			"rejects an invalid endpoint %s",
			async (body) => {
				expect((await DELETE(request("DELETE", body))).status).toBe(400);
			},
		);

		it("returns 503 when the database delete fails without logging private details", async () => {
			mockDelete.mockRejectedValue(privateFailure());
			expect((await DELETE(request("DELETE", { endpoint: FCM }))).status).toBe(
				503,
			);
			expect(console.error).toHaveBeenCalledTimes(1);
			expect(console.error).toHaveBeenCalledWith(
				"Failed to delete push subscription",
			);
		});
	});
});
