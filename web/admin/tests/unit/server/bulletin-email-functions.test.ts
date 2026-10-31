import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	methods: [] as string[],
	read: vi.fn(),
	queue: vi.fn(),
	audience: vi.fn(),
	subscriber: vi.fn(),
}));
vi.mock("@tanstack/react-start", () => ({
	createServerFn: ({ method }: { method: string }) => {
		mocks.methods.push(method);
		return {
			validator: (validate: (data: unknown) => unknown) => ({
				handler:
					(handler: (context: { data: unknown }) => Promise<unknown>) =>
					async ({ data }: { data: unknown }) =>
						handler({ data: validate(data) }),
			}),
		};
	},
}));
vi.mock("~/server/ses-settings.server", () => ({
	getBulletinEmailState: mocks.read,
	setEmailAudience: mocks.audience,
	changeSubscriber: mocks.subscriber,
}));
vi.mock("~/server/ses-delivery.server", () => ({
	enqueueBulletinEmail: mocks.queue,
}));

import {
	changeDailyBulletinSubscriber,
	getDailyBulletinEmail,
	queueDailyBulletinEmail,
	setDailyBulletinEmailAudience,
} from "~/server/bulletin-email";

const request = {
	date: "2026-10-28",
	requestKey: "11111111-1111-4111-8111-111111111111",
	audience: "test" as const,
	revision: 4,
};
describe("bulletin email server functions", () => {
	beforeEach(() => {
		mocks.read.mockReset();
		mocks.queue.mockReset();
		mocks.audience.mockReset();
		mocks.subscriber.mockReset();
	});
	it("exposes state as GET and all changes as explicit POSTs", () => {
		expect(mocks.methods).toEqual(["GET", "POST", "POST", "POST"]);
	});
	it("forwards only validated subscriber fields to the consent service", async () => {
		const invoke = changeDailyBulletinSubscriber as (request: {
			data: unknown;
		}) => Promise<unknown>;
		await expect(
			invoke({
				data: {
					email: " Reader@Example.com ",
					audience: "test",
					action: "confirm",
					source: " Explicit test consent ",
					forceRestore: true,
					consent_status: "confirmed",
					recipients: ["other@example.com"],
				},
			}),
		).resolves.toBeUndefined();
		expect(mocks.subscriber).toHaveBeenCalledExactlyOnceWith({
			email: "reader@example.com",
			audience: "test",
			action: "confirm",
			source: "Explicit test consent",
		});
	});
	it("allows unsubscribe without new consent evidence", async () => {
		await changeDailyBulletinSubscriber({
			data: {
				email: "reader@example.com",
				audience: "test",
				action: "unsubscribe",
			},
		});
		expect(mocks.subscriber).toHaveBeenCalledExactlyOnceWith({
			email: "reader@example.com",
			audience: "test",
			action: "unsubscribe",
			source: "",
		});
	});
	it("rejects malformed subscriber details before invoking the service", async () => {
		for (const data of [
			{
				email: "invalid",
				audience: "test",
				action: "confirm",
				source: "Explicit test consent",
			},
			{
				email: "reader@example.com",
				audience: "test",
				action: "confirm",
				source: "short",
			},
		]) {
			await expect(changeDailyBulletinSubscriber({ data })).rejects.toThrow();
		}
		expect(mocks.subscriber).not.toHaveBeenCalled();
	});
	it("preserves the service's opt-out rejection without retrying", async () => {
		mocks.subscriber.mockRejectedValue(new Error("המנוי חסום לדיוור"));
		await expect(
			changeDailyBulletinSubscriber({
				data: {
					email: "reader@example.com",
					audience: "test",
					action: "confirm",
					source: "Explicit test consent",
				},
			}),
		).rejects.toThrow("המנוי חסום לדיוור");
		expect(mocks.subscriber).toHaveBeenCalledOnce();
	});
	it("forwards only a validated calendar date to the state service", async () => {
		const state = { settings: { audience: "test", revision: 4 }, job: null };
		mocks.read.mockResolvedValue(state);
		await expect(
			getDailyBulletinEmail({ data: request.date }),
		).resolves.toEqual(state);
		expect(mocks.read).toHaveBeenCalledExactlyOnceWith(request.date);
		expect(mocks.queue).not.toHaveBeenCalled();
		expect(mocks.audience).not.toHaveBeenCalled();
	});
	it("passes the captured audience and revision to enqueue without client destinations", async () => {
		const summary = { id: "job-1", status: "queued" };
		mocks.queue.mockResolvedValue(summary);
		await expect(queueDailyBulletinEmail({ data: request })).resolves.toEqual(
			summary,
		);
		expect(mocks.queue).toHaveBeenCalledExactlyOnceWith(
			request.date,
			request.requestKey,
			{ audience: "test", revision: 4 },
		);
	});
	it("requires an explicit confirmation before forwarding real-audience activation", async () => {
		await expect(
			setDailyBulletinEmailAudience({
				data: { audience: "real", revision: 4, confirmReal: false },
			}),
		).rejects.toThrow("נדרש אישור מפורש");
		expect(mocks.audience).not.toHaveBeenCalled();
		mocks.audience.mockResolvedValue({ audience: "real", revision: 5 });
		await expect(
			setDailyBulletinEmailAudience({
				data: { audience: "real", revision: 4, confirmReal: true },
			}),
		).resolves.toEqual({ audience: "real", revision: 5 });
		expect(mocks.audience).toHaveBeenCalledExactlyOnceWith({
			audience: "real",
			revision: 4,
			confirmReal: true,
		});
	});
	it("allows returning to test mode without a production confirmation", async () => {
		mocks.audience.mockResolvedValue({ audience: "test", revision: 6 });
		await setDailyBulletinEmailAudience({
			data: { audience: "test", revision: 5, confirmReal: false },
		});
		expect(mocks.audience).toHaveBeenCalledExactlyOnceWith({
			audience: "test",
			revision: 5,
			confirmReal: false,
		});
	});
	it("rejects invalid dates, request UUIDs and revisions before invoking services", async () => {
		await expect(getDailyBulletinEmail({ data: "2026-02-30" })).rejects.toThrow(
			"יש לבחור תאריך תקין",
		);
		await expect(
			queueDailyBulletinEmail({
				data: { ...request, requestKey: "not-a-uuid" },
			}),
		).rejects.toThrow("בקשת השליחה אינה תקינה");
		await expect(
			queueDailyBulletinEmail({ data: { ...request, revision: -1 } }),
		).rejects.toThrow("בקשת השליחה אינה תקינה");
		await expect(
			setDailyBulletinEmailAudience({
				data: { audience: "test", revision: 1.5, confirmReal: false },
			}),
		).rejects.toThrow("מצב השליחה אינו תקין");
		expect(mocks.read).not.toHaveBeenCalled();
		expect(mocks.queue).not.toHaveBeenCalled();
		expect(mocks.audience).not.toHaveBeenCalled();
	});
	it("discards attempted client recipient overrides", async () => {
		const untrustedQueue = queueDailyBulletinEmail as (request: {
			data: unknown;
		}) => Promise<unknown>;
		await untrustedQueue({
			data: {
				...request,
				recipients: ["unexpected@example.com"],
				contactList: "foreign",
			},
		});
		expect(mocks.queue).toHaveBeenCalledExactlyOnceWith(
			request.date,
			request.requestKey,
			{ audience: "test", revision: 4 },
		);
	});
	it("propagates safe service errors without retrying", async () => {
		mocks.queue.mockRejectedValue(new Error("מצב השליחה השתנה"));
		await expect(queueDailyBulletinEmail({ data: request })).rejects.toThrow(
			"מצב השליחה השתנה",
		);
		expect(mocks.queue).toHaveBeenCalledTimes(1);
	});
});
