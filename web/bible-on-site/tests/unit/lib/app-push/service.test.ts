/** @jest-environment node */
jest.mock("server-only", () => ({}));

const mockQuery = jest.fn();
const mockLockedTransaction = jest.fn();
const mockTxQuery = jest.fn();
const mockTxExecute = jest.fn();
jest.mock("@/lib/api-client", () => ({
	query: (...args: unknown[]) => mockQuery(...args),
	lockedTransaction: (...args: unknown[]) => mockLockedTransaction(...args),
	txQuery: (...args: unknown[]) => mockTxQuery(...args),
	txExecute: (...args: unknown[]) => mockTxExecute(...args),
}));

import { generateKeyPairSync } from "node:crypto";

const { privateKey } = generateKeyPairSync("rsa", {
	modulusLength: 2048,
	publicKeyEncoding: { type: "spki", format: "pem" },
	privateKeyEncoding: { type: "pkcs8", format: "pem" },
});
const SERVICE_ACCOUNT = {
	project_id: "tanah-al-haperek",
	client_email: "fcm-sender@tanah-al-haperek.iam.gserviceaccount.com",
	private_key: privateKey,
};
const TOKEN = `fcm-token:${"x".repeat(140)}`;
const validDevice = {
	userId: "d7f3a1b2c4d5e6f7a8b9c0",
	installationId: "e1f2a3b4c5d6e7f8a9b0c1",
	token: TOKEN,
	platform: "android" as const,
	topics: ["daily_perek"],
	appVersion: "5.1.8",
};
const mockFetch = jest.fn();
const jsonResponse = (body: unknown, status = 200) =>
	new Response(JSON.stringify(body), { status });
const oauthResponse = () =>
	jsonResponse({ access_token: "test-access-token", expires_in: 3600 });
const SEND_URL =
	"https://fcm.googleapis.com/v1/projects/tanah-al-haperek/messages:send";

let service: typeof import("@/lib/app-push");

describe("app-push service", () => {
	beforeEach(async () => {
		jest.clearAllMocks();
		// The OAuth access token is cached at module scope — isolate each
		// test so token-fetch expectations stay deterministic.
		jest.resetModules();
		service = await import("@/lib/app-push");
		global.fetch = mockFetch as unknown as typeof fetch;
		process.env.FCM_SERVICE_ACCOUNT_JSON = JSON.stringify(SERVICE_ACCOUNT);
		process.env.PUSH_SEND_SECRET = "s3cret";
	});
	afterEach(() => {
		delete process.env.FCM_SERVICE_ACCOUNT_JSON;
		delete process.env.PUSH_SEND_SECRET;
	});

	describe("configuration", () => {
		it("is configured only with a valid service account and send secret", () => {
			expect(service.isDeviceRegistryConfigured()).toBe(true);
			expect(service.isAppPushConfigured()).toBe(true);
			delete process.env.PUSH_SEND_SECRET;
			expect(service.isDeviceRegistryConfigured()).toBe(true);
			expect(service.isAppPushConfigured()).toBe(false);
			delete process.env.FCM_SERVICE_ACCOUNT_JSON;
			expect(service.isDeviceRegistryConfigured()).toBe(false);
		});

		it.each([
			"not json",
			JSON.stringify({ ...SERVICE_ACCOUNT, project_id: "UPPER-CASE" }),
			JSON.stringify({ ...SERVICE_ACCOUNT, project_id: "x" }),
			JSON.stringify({ ...SERVICE_ACCOUNT, client_email: "a@example.com" }),
			JSON.stringify({ ...SERVICE_ACCOUNT, private_key: "not-pem" }),
			JSON.stringify({ client_email: SERVICE_ACCOUNT.client_email }),
		])("treats malformed service account %s as unconfigured", (raw) => {
			process.env.FCM_SERVICE_ACCOUNT_JSON = raw;
			const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
			expect(service.isDeviceRegistryConfigured()).toBe(false);
			expect(service.isAppPushConfigured()).toBe(false);
			warn.mockRestore();
		});

		it("warns once when the credential cannot be parsed", () => {
			process.env.FCM_SERVICE_ACCOUNT_JSON = "not json";
			const warn = jest.spyOn(console, "warn").mockImplementation(() => {});

			service.isDeviceRegistryConfigured();
			service.isDeviceRegistryConfigured();

			expect(warn).toHaveBeenCalledTimes(1);
			expect(warn).toHaveBeenCalledWith(
				"FCM_SERVICE_ACCOUNT_JSON is malformed; app push is disabled",
			);
			warn.mockRestore();
		});
	});

	describe("isPushSendAuthorized", () => {
		const request = (authorization?: string) =>
			new Request("http://localhost/api/push/device/daily", {
				method: "POST",
				headers: authorization ? { authorization } : {},
			});

		it("accepts only the exact bearer secret", () => {
			expect(service.isPushSendAuthorized(request("Bearer s3cret"))).toBe(true);
			expect(service.isPushSendAuthorized(request("Bearer wrong"))).toBe(false);
			expect(service.isPushSendAuthorized(request("s3cret"))).toBe(false);
			expect(service.isPushSendAuthorized(request())).toBe(false);
		});
	});

	describe("parseDeviceRegistration", () => {
		it("returns the validated registration", () => {
			expect(
				service.parseDeviceRegistration({ ...validDevice, extra: 1 }),
			).toEqual(validDevice);
		});

		it.each([
			["ios", "durable notification identity from FID"],
			["other", "non-mobile fallback"],
		])("accepts platform %s (%s)", (platform) => {
			expect(
				service.parseDeviceRegistration({ ...validDevice, platform }),
			).not.toBeNull();
		});

		it("accepts an empty installation id and empty topics", () => {
			expect(
				service.parseDeviceRegistration({
					...validDevice,
					installationId: "",
					topics: [],
				}),
			).not.toBeNull();
		});

		it.each([
			null,
			"string",
			{ ...validDevice, userId: "" },
			{ ...validDevice, userId: "has space" },
			{ ...validDevice, userId: 42 },
			{ ...validDevice, userId: "a".repeat(129) },
			{ ...validDevice, installationId: "has space" },
			{ ...validDevice, installationId: null },
			{ ...validDevice, token: "short" },
			{ ...validDevice, token: "has space" },
			{ ...validDevice, token: `x${"y".repeat(1024)}` },
			{ ...validDevice, token: 42 },
			{ ...validDevice, platform: "web" },
			{ ...validDevice, platform: 42 },
			{ ...validDevice, topics: "daily_perek" },
			{ ...validDevice, topics: ["daily perek"] },
			{ ...validDevice, topics: [42] },
			{ ...validDevice, topics: Array(33).fill("daily_perek") },
			{
				...validDevice,
				// 26 individually-valid topics serialize past the VARCHAR(1024)
				// column — validated so registration fails 400, not 503.
				topics: Array(26).fill("a".repeat(40)),
			},
			{ ...validDevice, appVersion: "" },
			{ ...validDevice, appVersion: "a".repeat(65) },
			{ ...validDevice, appVersion: "5.1.8\ninjected" },
			{ ...validDevice, appVersion: 518 },
		])("rejects invalid body %#", (body) => {
			expect(service.parseDeviceRegistration(body)).toBeNull();
		});
	});

	describe("parseDeviceUserId", () => {
		it("returns a valid user id", () => {
			expect(service.parseDeviceUserId({ userId: validDevice.userId })).toBe(
				validDevice.userId,
			);
		});

		it.each([
			null,
			"string",
			{},
			{ userId: "" },
			{ userId: "has space" },
			{ userId: 42 },
		])("rejects %#", (body) => {
			expect(service.parseDeviceUserId(body)).toBeNull();
		});
	});

	describe("persistence", () => {
		beforeEach(() => {
			mockQuery.mockResolvedValue([]);
			mockTxQuery.mockResolvedValue([]);
			mockLockedTransaction.mockImplementation((_lock, fn) => fn({}));
		});

		it("upserts the full registration tuple by user id", async () => {
			await service.saveDevice(validDevice);
			// New identity: existence probe, then the locked re-check, the
			// capacity count and the insert inside one transaction.
			expect(mockQuery.mock.calls[0][0]).toContain(
				"SELECT user_id FROM tanah_push_device WHERE user_id = ?",
			);
			expect(mockLockedTransaction).toHaveBeenCalledWith(
				"tanah_push_device:save",
				expect.any(Function),
			);
			expect(mockTxQuery.mock.calls[0][1]).toContain(
				"SELECT user_id FROM tanah_push_device WHERE user_id = ?",
			);
			expect(mockTxQuery.mock.calls[1][1]).toContain(
				"SELECT COUNT(*) AS total FROM tanah_push_device",
			);
			const [, sql, params] = mockTxExecute.mock.calls[0];
			expect(sql).toContain("INSERT INTO tanah_push_device");
			expect(sql).toContain("ON DUPLICATE KEY UPDATE");
			expect(params).toEqual([
				validDevice.userId,
				validDevice.installationId,
				validDevice.token,
				"android",
				'["daily_perek"]',
				"5.1.8",
				validDevice.installationId,
				validDevice.token,
				"android",
				'["daily_perek"]',
				"5.1.8",
			]);
		});

		it("deletes by user id and by token", async () => {
			await service.deleteDevice(validDevice.userId);
			await service.deleteDeviceToken(TOKEN);
			expect(mockQuery.mock.calls[0][0]).toContain(
				"DELETE FROM tanah_push_device WHERE user_id",
			);
			expect(mockQuery.mock.calls[0][1]).toEqual([validDevice.userId]);
			expect(mockQuery.mock.calls[1][0]).toContain(
				"DELETE FROM tanah_push_device WHERE token",
			);
			expect(mockQuery.mock.calls[1][1]).toEqual([TOKEN]);
		});

		it("refuses a new registration when the store is at its bound (#3500)", async () => {
			mockTxQuery
				.mockReset()
				.mockResolvedValueOnce([]) // userId not yet stored
				.mockResolvedValueOnce([{ total: 25_000 }]);

			await expect(service.saveDevice(validDevice)).rejects.toBeInstanceOf(
				service.DeviceStoreFullError,
			);
			expect(mockTxExecute).not.toHaveBeenCalled();
		});

		it("still upserts an existing identity at the store bound", async () => {
			mockQuery
				.mockReset()
				.mockResolvedValueOnce([{ user_id: validDevice.userId }])
				.mockResolvedValue([]);

			await service.saveDevice(validDevice);

			expect(mockQuery).toHaveBeenCalledTimes(2);
			expect(mockQuery.mock.calls[1][0]).toContain(
				"INSERT INTO tanah_push_device",
			);
			expect(mockLockedTransaction).not.toHaveBeenCalled();
		});

		it("upserts an identity claimed while waiting for the store lock", async () => {
			mockTxQuery
				.mockReset()
				.mockResolvedValueOnce([{ user_id: validDevice.userId }]);

			await service.saveDevice(validDevice);

			// Claimed inside the lock: no capacity count, straight to insert.
			expect(mockTxQuery).toHaveBeenCalledTimes(1);
			expect(mockTxExecute).toHaveBeenCalledTimes(1);
		});
	});

	describe("sendDailyPerekToDevices", () => {
		const sendCalls = () =>
			mockFetch.mock.calls.filter(([url]) => url === SEND_URL);
		const sendBody = () =>
			JSON.parse(sendCalls()[0][1].body as string) as {
				message: Record<string, unknown>;
			};

		it("broadcasts the daily perek payload to the topic", async () => {
			mockFetch
				.mockResolvedValueOnce(oauthResponse())
				.mockResolvedValueOnce(jsonResponse({ name: "projects/x/messages/1" }));

			const result = await service.sendDailyPerekToDevices(1);

			expect(result).toEqual({ sent: 1, removed: 0, failed: 0 });
			expect(sendCalls()).toHaveLength(1);
			const [, init] = sendCalls()[0];
			expect(init.method).toBe("POST");
			expect(init.headers).toEqual({
				authorization: "Bearer test-access-token",
				"content-type": "application/json",
			});
			const { message } = sendBody();
			expect(message.topic).toBe("daily_perek");
			expect(message).not.toHaveProperty("token");
			expect(message.notification).toEqual({
				title: 'הפרק היומי - תנ"ך על הפרק',
				body: "הפרק של היום: בראשית א",
			});
			expect(message.data).toEqual({
				url: "/929/1",
				tag: "daily-perek",
			});
			expect(message.android).toEqual({
				ttl: "43200s",
				notification: { channel_id: "daily_perek" },
			});
			const apns = message.apns as {
				headers: Record<string, string>;
				payload: { aps: Record<string, unknown> };
			};
			expect(apns.payload.aps).toEqual({
				sound: "default",
				"thread-id": "daily-perek",
			});
			// The reminder must die with its study day, not weeks later.
			const expiration = Number(apns.headers["apns-expiration"]);
			expect(expiration).toBeGreaterThan(Date.now() / 1000 + 11 * 3600);
			expect(expiration).toBeLessThan(Date.now() / 1000 + 13 * 3600);
		});

		it("targets a single token instead of the topic", async () => {
			mockFetch
				.mockResolvedValueOnce(oauthResponse())
				.mockResolvedValueOnce(jsonResponse({ name: "m/1" }));

			await service.sendDailyPerekToDevices(1, TOKEN);

			const { message } = sendBody();
			expect(message.token).toBe(TOKEN);
			expect(message).not.toHaveProperty("topic");
		});

		it("mints an RS256 JWT bearer grant for the OAuth exchange", async () => {
			mockFetch
				.mockResolvedValueOnce(oauthResponse())
				.mockResolvedValueOnce(jsonResponse({ name: "m/1" }));

			await service.sendDailyPerekToDevices(1);

			const [url, init] = mockFetch.mock.calls[0];
			expect(url).toBe("https://oauth2.googleapis.com/token");
			const form = new URLSearchParams(init.body as string);
			expect(form.get("grant_type")).toBe(
				"urn:ietf:params:oauth:grant-type:jwt-bearer",
			);
			const [header, payload, signature] = (
				form.get("assertion") as string
			).split(".");
			expect(JSON.parse(Buffer.from(header, "base64url").toString())).toEqual({
				alg: "RS256",
				typ: "JWT",
			});
			const claims = JSON.parse(Buffer.from(payload, "base64url").toString());
			expect(claims).toMatchObject({
				iss: SERVICE_ACCOUNT.client_email,
				scope: "https://www.googleapis.com/auth/firebase.messaging",
				aud: "https://oauth2.googleapis.com/token",
			});
			expect(signature.length).toBeGreaterThan(100);
		});

		it("caches the OAuth access token between sends", async () => {
			mockFetch
				.mockResolvedValueOnce(oauthResponse())
				.mockResolvedValue(jsonResponse({ name: "m/1" }));

			await service.sendDailyPerekToDevices(1);
			await service.sendDailyPerekToDevices(2);

			expect(
				mockFetch.mock.calls.filter(
					([url]) => url === "https://oauth2.googleapis.com/token",
				),
			).toHaveLength(1);
			expect(sendCalls()).toHaveLength(2);
		});

		it.each([
			["404 NOT_FOUND", 404, { error: { status: "NOT_FOUND" } }],
			[
				"400 with UNREGISTERED detail",
				400,
				{ error: { details: [{ errorCode: "UNREGISTERED" }] } },
			],
		])(
			"drops a targeted registration FCM reports as unregistered (%s)",
			async (_label, status, errorBody) => {
				mockFetch.mockReset();
				jest.resetModules();
				service = await import("@/lib/app-push");
				mockFetch
					.mockResolvedValueOnce(oauthResponse())
					.mockResolvedValueOnce(jsonResponse(errorBody, status));

				const result = await service.sendDailyPerekToDevices(1, TOKEN);

				expect(result).toEqual({ sent: 0, removed: 1, failed: 0 });
				expect(mockQuery).toHaveBeenCalledWith(
					expect.stringContaining("DELETE FROM tanah_push_device WHERE token"),
					[TOKEN],
				);
			},
		);

		it.each([
			["no UNREGISTERED detail", { error: { status: "INVALID_ARGUMENT" } }],
			["an unreadable body", "plain text"],
		])(
			"keeps the row on a targeted 400 that is not a dead token (%s)",
			async (_label, errorBody) => {
				mockFetch.mockReset();
				jest.resetModules();
				service = await import("@/lib/app-push");
				mockFetch
					.mockResolvedValueOnce(oauthResponse())
					.mockResolvedValueOnce(
						typeof errorBody === "string"
							? new Response(errorBody, { status: 400 })
							: jsonResponse(errorBody, 400),
					);
				const warn = jest.spyOn(console, "warn").mockImplementation(() => {});

				const result = await service.sendDailyPerekToDevices(1, TOKEN);

				expect(result).toEqual({ sent: 0, removed: 0, failed: 1 });
				expect(mockQuery).not.toHaveBeenCalled();
				warn.mockRestore();
			},
		);

		it.each([400, 404, 500])(
			"counts a broadcast failure without deleting rows (%s)",
			async (status) => {
				jest.resetModules();
				service = await import("@/lib/app-push");
				mockFetch
					.mockResolvedValueOnce(oauthResponse())
					.mockResolvedValueOnce(jsonResponse({ error: {} }, status));
				const warn = jest.spyOn(console, "warn").mockImplementation(() => {});

				const result = await service.sendDailyPerekToDevices(1);

				expect(result).toEqual({ sent: 0, removed: 0, failed: 1 });
				expect(mockQuery).not.toHaveBeenCalled();
				expect(warn).toHaveBeenCalledWith("App push delivery failed", {
					statusCode: status,
				});
				warn.mockRestore();
			},
		);

		it("counts a targeted provider error without deleting the row", async () => {
			mockFetch
				.mockResolvedValueOnce(oauthResponse())
				.mockResolvedValueOnce(jsonResponse({ error: {} }, 500));
			const warn = jest.spyOn(console, "warn").mockImplementation(() => {});

			const result = await service.sendDailyPerekToDevices(1, TOKEN);

			expect(result).toEqual({ sent: 0, removed: 0, failed: 1 });
			expect(mockQuery).not.toHaveBeenCalled();
			warn.mockRestore();
		});

		it("throws when the OAuth exchange fails", async () => {
			mockFetch.mockResolvedValueOnce(jsonResponse({}, 500));

			await expect(service.sendDailyPerekToDevices(1)).rejects.toThrow(
				"OAuth token endpoint returned 500",
			);
		});

		it("throws when the OAuth exchange returns a malformed body", async () => {
			mockFetch.mockResolvedValueOnce(jsonResponse({ access_token: 42 }));

			await expect(service.sendDailyPerekToDevices(1)).rejects.toThrow(
				"malformed",
			);
		});

		it("throws when no service account is configured", async () => {
			delete process.env.FCM_SERVICE_ACCOUNT_JSON;

			await expect(service.sendDailyPerekToDevices(1)).rejects.toThrow(
				"not configured",
			);
			expect(mockFetch).not.toHaveBeenCalled();
		});
	});
});
