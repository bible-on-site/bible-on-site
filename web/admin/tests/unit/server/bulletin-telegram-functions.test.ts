import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	methods: [] as string[],
	imports: 0,
	read: vi.fn(),
	queue: vi.fn(),
	audience: vi.fn(),
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
vi.mock("~/server/telegram-delivery.server", () => {
	mocks.imports++;
	return {
		getBulletinTelegramState: mocks.read,
		enqueueBulletinTelegram: mocks.queue,
		setTelegramAudience: mocks.audience,
	};
});

import {
	getDailyBulletinTelegram,
	queueDailyBulletinTelegram,
	setDailyBulletinTelegramAudience,
} from "~/server/bulletin-telegram";

const importsBeforeRequest = mocks.imports;
const request = {
	date: "2026-10-28",
	requestKey: "11111111-1111-4111-8111-111111111111",
	expectedAudience: "test" as const,
	expectedRevision: 4,
};

describe("authenticated Telegram server-function adapters", () => {
	beforeEach(() => {
		mocks.read.mockReset();
		mocks.queue.mockReset();
		mocks.audience.mockReset();
	});
	it("declares one read GET and explicit mutation POSTs without importing server transport eagerly", () => {
		expect(mocks.methods).toEqual(["GET", "POST", "POST"]);
		expect(importsBeforeRequest).toBe(0);
	});
	it("passes only a validated date to read state", async () => {
		const state = { settings: { audience: "test", revision: 4 }, job: null };
		mocks.read.mockResolvedValue(state);
		await expect(
			getDailyBulletinTelegram({ data: request.date }),
		).resolves.toEqual(state);
		expect(mocks.read).toHaveBeenCalledExactlyOnceWith(request.date);
		expect(mocks.queue).not.toHaveBeenCalled();
	});
	it("passes captured mode/revision and request UUID to enqueue and returns its job summary", async () => {
		const summary = {
			id: "job-1",
			date: request.date,
			audience: "test",
			status: "queued",
		};
		mocks.queue.mockResolvedValue(summary);
		await expect(
			queueDailyBulletinTelegram({ data: request }),
		).resolves.toEqual(summary);
		expect(mocks.queue).toHaveBeenCalledExactlyOnceWith(request);
	});
	it("requires literal confirmation before forwarding public activation", async () => {
		await expect(
			setDailyBulletinTelegramAudience({
				data: { audience: "real", expectedRevision: 4, confirmReal: false },
			}),
		).rejects.toThrow("נדרש אישור מפורש");
		expect(mocks.audience).not.toHaveBeenCalled();
		mocks.audience.mockResolvedValue({ audience: "real", revision: 5 });
		await expect(
			setDailyBulletinTelegramAudience({
				data: { audience: "real", expectedRevision: 4, confirmReal: true },
			}),
		).resolves.toEqual({ audience: "real", revision: 5 });
		expect(mocks.audience).toHaveBeenCalledExactlyOnceWith({
			audience: "real",
			expectedRevision: 4,
			confirmReal: true,
		});
	});
	it("allows an explicit return to test without public confirmation", async () => {
		await setDailyBulletinTelegramAudience({
			data: { audience: "test", expectedRevision: 5 },
		});
		expect(mocks.audience).toHaveBeenCalledExactlyOnceWith({
			audience: "test",
			expectedRevision: 5,
			confirmReal: false,
		});
	});
	it("rejects invalid or hidden targeting fields before calling delivery", async () => {
		const invoke = queueDailyBulletinTelegram as (request: {
			data: unknown;
		}) => Promise<unknown>;
		for (const data of [
			{ ...request, date: "2026-02-30" },
			{ ...request, expectedRevision: -1 },
			{ ...request, expectedAudience: "all" },
			{ ...request, requestKey: "not-a-uuid" },
			{ ...request, chatId: "override" },
			{ ...request, token: "unexpected" },
			{ ...request, caption: "override" },
			{ ...request, pdf: "override" },
		])
			await expect(invoke({ data })).rejects.toThrow();
		expect(mocks.queue).not.toHaveBeenCalled();
	});
	it("preserves a service rejection without retrying or switching audiences", async () => {
		mocks.queue.mockRejectedValue(new Error("מצב השליחה השתנה"));
		await expect(queueDailyBulletinTelegram({ data: request })).rejects.toThrow(
			"מצב השליחה השתנה",
		);
		expect(mocks.queue).toHaveBeenCalledOnce();
		expect(mocks.audience).not.toHaveBeenCalled();
	});
});
