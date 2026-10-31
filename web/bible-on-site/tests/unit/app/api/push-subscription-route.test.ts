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

import { DELETE, GET, POST } from "@/app/api/push/subscription/route";

const FCM = "https://fcm.googleapis.com/fcm/send/abc";
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
			expect(GET().status).toBe(404);
			expect((await POST(request("POST", subscription))).status).toBe(404);
			expect(mockSave).not.toHaveBeenCalled();
		});
	});

	it("GET returns the VAPID public key", async () => {
		const response = GET();
		expect(await response.json()).toEqual({ publicKey: "public-key" });
	});

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

		it("returns 503 when the database write fails", async () => {
			mockSave.mockRejectedValue(new Error("db down"));
			expect((await POST(request("POST", subscription))).status).toBe(503);
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

		it("returns 503 when the database delete fails", async () => {
			mockDelete.mockRejectedValue(new Error("db down"));
			expect((await DELETE(request("DELETE", { endpoint: FCM }))).status).toBe(
				503,
			);
		});
	});
});
