/** @jest-environment node */
const mockSave = jest.fn();
const mockDelete = jest.fn();
const mockConfigured = jest.fn();
jest.mock("@/lib/app-push", () => {
	const actual = jest.requireActual("@/lib/app-push/service");
	return {
		...actual,
		isDeviceRegistryConfigured: () => mockConfigured(),
		saveDevice: (...args: unknown[]) => mockSave(...args),
		deleteDevice: (...args: unknown[]) => mockDelete(...args),
	};
});
jest.mock("server-only", () => ({}));

import { DELETE, POST } from "@/app/api/push/device/route";

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
const request = (method: string, body: unknown) =>
	new Request("http://localhost/api/push/device", {
		method,
		body: typeof body === "string" ? body : JSON.stringify(body),
	});

describe("/api/push/device", () => {
	beforeEach(() => {
		jest.clearAllMocks();
		mockConfigured.mockReturnValue(true);
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
			expect(mockDelete).toHaveBeenCalledWith(device.userId);
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
			expect(await response.json()).toEqual({ registered: true });
			expect(mockSave).toHaveBeenCalledWith(device);
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
			expect(mockDelete).toHaveBeenCalledWith(device.userId);
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
