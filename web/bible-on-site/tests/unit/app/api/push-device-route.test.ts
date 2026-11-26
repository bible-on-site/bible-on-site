/** @jest-environment node */
const mockSave = jest.fn();
const mockDelete = jest.fn();
const mockDeleteLegacy = jest.fn();
const mockVerify = jest.fn();
const mockConfigured = jest.fn();
const mockAllowed = jest.fn();
jest.mock("@/lib/app-push", () => {
	const actual = jest.requireActual("@/lib/app-push/service");
	return {
		...actual,
		isDeviceRegistryConfigured: () => mockConfigured(),
		saveDevice: (...args: unknown[]) => mockSave(...args),
		deleteDevice: (...args: unknown[]) => mockDelete(...args),
		deleteLegacyDevice: (...args: unknown[]) => mockDeleteLegacy(...args),
		verifyFirebaseIdToken: (...args: unknown[]) => mockVerify(...args),
	};
});
jest.mock("@/lib/rate-limit", () => {
	const actual = jest.requireActual("@/lib/rate-limit");
	return {
		...actual,
		pushRegistrationAllowed: (...args: unknown[]) => mockAllowed(...args),
	};
});
jest.mock("server-only", () => ({}));

import { DELETE, POST } from "@/app/api/push/device/route";
import {
	DeviceOwnershipError,
	DeviceStoreFullError,
	FirebaseIdentityUnavailableError,
} from "@/lib/app-push";

const device = {
	userId: "d7f3a1b2c4d5e6f7a8b9c0",
	installationId: "e1f2a3b4c5d6e7f8a9b0c1",
	token: `fcm-token:${"x".repeat(140)}`,
	platform: "android",
	topics: ["daily_perek"],
	appVersion: "5.1.8",
};
const privateFailure = () =>
	Object.assign(
		new Error(`request failed for ${device.token}`, {
			cause: new Error("private request body"),
		}),
		{ token: device.token, body: "private request body" },
	);
const request = (method: string, body: unknown, authenticated = true) =>
	new Request("http://localhost/api/push/device", {
		method,
		headers: authenticated ? { authorization: "Bearer valid.jwt.token" } : {},
		body: typeof body === "string" ? body : JSON.stringify(body),
	});

describe("/api/push/device", () => {
	beforeEach(() => {
		jest.clearAllMocks();
		mockConfigured.mockReturnValue(true);
		mockAllowed.mockReturnValue(true);
		mockVerify.mockResolvedValue({ userId: device.userId });
		mockSave.mockResolvedValue(false);
		jest.spyOn(console, "error").mockImplementation(() => {});
	});
	afterEach(() => {
		jest.restoreAllMocks();
	});

	describe("when the registry is not configured", () => {
		beforeEach(() => mockConfigured.mockReturnValue(false));

		it("refuses registrations but still honors opt-out", async () => {
			expect((await POST(request("POST", device))).status).toBe(404);
			expect(mockSave).not.toHaveBeenCalled();
			const response = await DELETE(
				request("DELETE", { userId: device.userId }),
			);
			expect(await response.json()).toEqual({ registered: false });
			expect(mockDelete).toHaveBeenCalledWith(device.userId, device.userId);
		});
	});

	it.each(["POST", "DELETE"])(
		"%s rejects bodies over the UTF-8 byte limit",
		async (method) => {
			const handler = method === "POST" ? POST : DELETE;
			const response = await handler(
				request(method, { ...device, pad: "א".repeat(2100) }),
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
			const req = new Request("http://localhost/api/push/device", {
				method,
				body: new ReadableStream<Uint8Array>({
					start(controller) {
						controller.error(privateFailure());
					},
				}),
				duplex: "half",
			} as RequestInit);
			expect((await handler(req)).status).toBe(400);
			expect(mockSave).not.toHaveBeenCalled();
			expect(mockDelete).not.toHaveBeenCalled();
			expect(warn).toHaveBeenCalledTimes(1);
			expect(warn).toHaveBeenCalledWith("Push device body read failed");
		},
	);

	describe("POST", () => {
		it("stores a valid registration", async () => {
			const response = await POST(request("POST", device));
			expect(response.status).toBe(201);
			expect(await response.json()).toEqual({
				registered: true,
				legacyMigrated: false,
			});
			expect(mockSave).toHaveBeenCalledWith(device, device.userId);
		});

		it("requires a bearer credential", async () => {
			const response = await POST(request("POST", device, false));

			expect(response.status).toBe(401);
			expect(mockVerify).not.toHaveBeenCalled();
			expect(mockSave).not.toHaveBeenCalled();
		});

		it("rejects an invalid bearer credential", async () => {
			mockVerify.mockResolvedValue(null);

			const response = await POST(request("POST", device));

			expect(response.status).toBe(401);
			expect(mockVerify).toHaveBeenCalledWith("valid.jwt.token");
			expect(mockSave).not.toHaveBeenCalled();
		});

		it("reports verification infrastructure as unavailable rather than forged", async () => {
			mockVerify.mockRejectedValue(new FirebaseIdentityUnavailableError());

			const response = await POST(request("POST", device));

			expect(response.status).toBe(503);
			expect(await response.json()).toEqual({
				error: "Identity verification unavailable",
			});
			expect(mockSave).not.toHaveBeenCalled();
		});

		it("rejects a verified identity that does not match the claimed registration owner", async () => {
			mockVerify.mockResolvedValue({ userId: "other-installation" });

			const response = await POST(request("POST", device));

			expect(response.status).toBe(403);
			expect(mockSave).not.toHaveBeenCalled();
		});

		it("maps registry ownership rejection to 403", async () => {
			mockSave.mockRejectedValue(new DeviceOwnershipError());

			const response = await POST(request("POST", device));

			expect(response.status).toBe(403);
		});

		it("bounds anonymous writes per client address (#3500)", async () => {
			mockAllowed.mockReturnValue(false);
			const response = await POST(
				new Request("http://localhost/api/push/device", {
					method: "POST",
					headers: { "x-real-ip": "203.0.113.9" },
					body: JSON.stringify(device),
				}),
			);
			expect(response.status).toBe(429);
			expect(mockAllowed).toHaveBeenCalledWith("203.0.113.9");
			expect(mockSave).not.toHaveBeenCalled();
		});

		it("keeps the configured gate ahead of the rate limit", async () => {
			mockConfigured.mockReturnValue(false);
			mockAllowed.mockReturnValue(false);
			expect((await POST(request("POST", device))).status).toBe(404);
			expect(mockAllowed).not.toHaveBeenCalled();
		});

		it("returns 503 when the device store is at its bound", async () => {
			mockSave.mockRejectedValue(new DeviceStoreFullError());
			expect((await POST(request("POST", device))).status).toBe(503);
			expect(console.error).toHaveBeenCalledWith("Push device store is full");
		});

		it.each([
			"not json",
			JSON.stringify({ ...device, token: "has space" }),
			JSON.stringify({ ...device, platform: "web" }),
			JSON.stringify({ userId: device.userId }),
			JSON.stringify({ ...device, pad: "x".repeat(5000) }),
		])("rejects an invalid body", async (body) => {
			expect((await POST(request("POST", body))).status).toBe(400);
			expect(mockSave).not.toHaveBeenCalled();
		});

		it("returns 503 when the database write fails without logging private details", async () => {
			mockSave.mockRejectedValue(privateFailure());
			expect((await POST(request("POST", device))).status).toBe(503);
			expect(console.error).toHaveBeenCalledTimes(1);
			expect(console.error).toHaveBeenCalledWith("Failed to save push device");
		});
	});

	describe("DELETE", () => {
		it("removes the registration", async () => {
			const response = await DELETE(
				request("DELETE", { userId: device.userId }),
			);
			expect(await response.json()).toEqual({ registered: false });
			expect(mockDelete).toHaveBeenCalledWith(device.userId, device.userId);
		});

		it("uses the unbound-row compatibility lane without a bearer credential", async () => {
			const response = await DELETE(
				request("DELETE", { userId: "legacy-user" }, false),
			);

			expect(response.status).toBe(200);
			expect(mockVerify).not.toHaveBeenCalled();
			expect(mockDeleteLegacy).toHaveBeenCalledWith("legacy-user");
			expect(mockDelete).not.toHaveBeenCalled();
		});

		it("rejects an invalid bearer credential", async () => {
			mockVerify.mockResolvedValue(null);

			const response = await DELETE(
				request("DELETE", { userId: device.userId }),
			);

			expect(response.status).toBe(401);
			expect(mockDelete).not.toHaveBeenCalled();
			expect(mockDeleteLegacy).not.toHaveBeenCalled();
		});

		it("reports verification infrastructure as unavailable", async () => {
			mockVerify.mockRejectedValue(new FirebaseIdentityUnavailableError());

			const response = await DELETE(
				request("DELETE", { userId: device.userId }),
			);

			expect(response.status).toBe(503);
			expect(mockDelete).not.toHaveBeenCalled();
		});

		it("rejects a verified identity that does not match the claimed row", async () => {
			mockVerify.mockResolvedValue({ userId: "other-installation" });

			const response = await DELETE(
				request("DELETE", { userId: device.userId }),
			);

			expect(response.status).toBe(403);
			expect(mockDelete).not.toHaveBeenCalled();
		});

		it("maps registry ownership rejection to 403", async () => {
			mockDelete.mockRejectedValue(new DeviceOwnershipError());

			const response = await DELETE(
				request("DELETE", { userId: device.userId }),
			);

			expect(response.status).toBe(403);
		});

		it.each(["null", JSON.stringify({ userId: "has space" }), "{}"])(
			"rejects an invalid user id %s",
			async (body) => {
				expect((await DELETE(request("DELETE", body))).status).toBe(400);
			},
		);

		it("returns 503 when the database delete fails without logging private details", async () => {
			mockDelete.mockRejectedValue(privateFailure());
			expect(
				(await DELETE(request("DELETE", { userId: device.userId }))).status,
			).toBe(503);
			expect(console.error).toHaveBeenCalledTimes(1);
			expect(console.error).toHaveBeenCalledWith(
				"Failed to delete push device",
			);
		});
	});
});
