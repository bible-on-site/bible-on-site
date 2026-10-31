/** @jest-environment node */
jest.mock("server-only", () => ({}));

const mockQuery = jest.fn();
jest.mock("@/lib/api-client", () => ({
	query: (...args: unknown[]) => mockQuery(...args),
}));

const mockSend = jest.fn();
const mockSetVapid = jest.fn();
jest.mock("web-push", () => ({
	__esModule: true,
	default: {
		sendNotification: (...args: unknown[]) => mockSend(...args),
		setVapidDetails: (...args: unknown[]) => mockSetVapid(...args),
	},
	WebPushError: class extends Error {
		constructor(public statusCode: number) {
			super(`status ${statusCode}`);
		}
	},
}));

import {
	dailyPerekPayload,
	deleteSubscription,
	getVapidPublicKey,
	isPushServiceEndpoint,
	isWebPushConfigured,
	parseSubscription,
	saveSubscription,
	sendDailyPerek,
} from "@/lib/web-push";

const { WebPushError: MockWebPushError } = jest.requireMock("web-push") as {
	WebPushError: new (statusCode: number) => Error;
};

const FCM = "https://fcm.googleapis.com/fcm/send/abc";
const validBody = {
	endpoint: FCM,
	keys: { p256dh: "BNcR_x-1", auth: "tBH-8w" },
};
const ENV_KEYS = [
	"VAPID_PUBLIC_KEY",
	"VAPID_PRIVATE_KEY",
	"VAPID_SUBJECT",
	"PUSH_SEND_SECRET",
] as const;

describe("web-push service", () => {
	beforeEach(() => {
		jest.clearAllMocks();
		for (const key of ENV_KEYS) process.env[key] = `${key}-value`;
	});
	afterEach(() => {
		for (const key of ENV_KEYS) delete process.env[key];
	});

	describe("configuration", () => {
		it("is configured only when every key is set", () => {
			expect(isWebPushConfigured()).toBe(true);
			expect(getVapidPublicKey()).toBe("VAPID_PUBLIC_KEY-value");
			delete process.env.PUSH_SEND_SECRET;
			expect(isWebPushConfigured()).toBe(false);
			delete process.env.VAPID_PUBLIC_KEY;
			expect(getVapidPublicKey()).toBeNull();
		});
	});

	describe("isPushServiceEndpoint", () => {
		it.each([
			FCM,
			"https://jmt17.google.com/fcm/send/x",
			"https://updates.push.services.mozilla.com/wpush/v2/x",
			"https://wns2-par02p.notify.windows.com/w/?token=x",
			"https://web.push.apple.com/QGx",
		])("accepts the browser push service %s", (url) => {
			expect(isPushServiceEndpoint(url)).toBe(true);
		});

		it.each([
			"http://fcm.googleapis.com/fcm/send/abc",
			"https://evil.example/fcm.googleapis.com",
			"https://fcm.googleapis.com.evil.example/x",
			"https://mail.google.com/x",
			"not a url",
			42,
		])("rejects %s", (url) => {
			expect(isPushServiceEndpoint(url)).toBe(false);
		});

		it("rejects endpoints longer than the stored column", () => {
			expect(
				isPushServiceEndpoint(`https://fcm.googleapis.com/${"a".repeat(1100)}`),
			).toBe(false);
		});
	});

	describe("parseSubscription", () => {
		it("returns the validated subscription", () => {
			expect(parseSubscription({ ...validBody, extra: 1 })).toEqual(validBody);
		});

		it.each([
			null,
			"string",
			{ endpoint: "https://evil.example/x", keys: validBody.keys },
			{ endpoint: FCM },
			{ endpoint: FCM, keys: null },
			{ endpoint: FCM, keys: { p256dh: "has space", auth: "x" } },
			{ endpoint: FCM, keys: { p256dh: "x", auth: "" } },
			{ endpoint: FCM, keys: { p256dh: "x", auth: "a".repeat(65) } },
		])("rejects invalid body #%#", (body) => {
			expect(parseSubscription(body)).toBeNull();
		});
	});

	describe("persistence", () => {
		it("upserts by endpoint hash", async () => {
			await saveSubscription(validBody);
			const [sql, params] = mockQuery.mock.calls[0];
			expect(sql).toContain("ON DUPLICATE KEY UPDATE");
			expect(params[0]).toMatch(/^[0-9a-f]{64}$/);
			expect(params.slice(1)).toEqual([
				FCM,
				"BNcR_x-1",
				"tBH-8w",
				"BNcR_x-1",
				"tBH-8w",
			]);
		});

		it("deletes by the same endpoint hash", async () => {
			await saveSubscription(validBody);
			await deleteSubscription(FCM);
			expect(mockQuery.mock.calls[1][0]).toContain("DELETE");
			expect(mockQuery.mock.calls[1][1]).toEqual([
				mockQuery.mock.calls[0][1][0],
			]);
		});
	});

	describe("dailyPerekPayload", () => {
		it("links to the perek and names its source", () => {
			expect(dailyPerekPayload(1)).toEqual({
				title: 'הפרק היומי - תנ"ך על הפרק',
				body: "הפרק של היום: בראשית א",
				url: "/929/1",
				tag: "daily-perek",
			});
		});
	});

	describe("sendDailyPerek", () => {
		const row = (n: number) => ({
			endpoint: `${FCM}${n}`,
			p256dh: "p",
			auth: "a",
		});

		it("sends to every subscriber, prunes gone ones and counts failures", async () => {
			const rows = Array.from({ length: 53 }, (_, i) => row(i));
			mockQuery.mockResolvedValueOnce(rows).mockResolvedValue([]);
			const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
			mockSend.mockImplementation(
				async (subscription: { endpoint: string }) => {
					if (subscription.endpoint === `${FCM}1`)
						throw new MockWebPushError(410);
					if (subscription.endpoint === `${FCM}2`)
						throw new MockWebPushError(404);
					if (subscription.endpoint === `${FCM}3`)
						throw new MockWebPushError(500);
					if (subscription.endpoint === `${FCM}4`) throw new Error("network");
				},
			);

			const result = await sendDailyPerek(1);

			expect(result).toEqual({ sent: 49, removed: 2, failed: 2 });
			expect(mockSetVapid).toHaveBeenCalledWith(
				"VAPID_SUBJECT-value",
				"VAPID_PUBLIC_KEY-value",
				"VAPID_PRIVATE_KEY-value",
			);
			expect(mockSend).toHaveBeenCalledTimes(53);
			const [, payload, options] = mockSend.mock.calls[0];
			expect(JSON.parse(payload).url).toBe("/929/1");
			expect(options).toEqual({
				TTL: 43200,
				topic: "daily-perek",
				urgency: "normal",
			});
			const deletes = mockQuery.mock.calls.filter(([sql]) =>
				String(sql).startsWith("DELETE"),
			);
			expect(deletes).toHaveLength(2);
			expect(warn).toHaveBeenCalledTimes(2);
			warn.mockRestore();
		});
	});
});
