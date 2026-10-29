import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	methods: [] as string[],
	imports: 0,
	read: vi.fn(),
	verify: vi.fn(),
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
vi.mock("~/server/whatsapp-delivery.server", () => {
	mocks.imports++;
	return {
		getBulletinWhatsAppState: mocks.read,
		verifyBulletinWhatsApp: mocks.verify,
		enqueueBulletinWhatsApp: mocks.queue,
		setWhatsAppAudience: mocks.audience,
	};
});

import {
	getDailyBulletinWhatsApp,
	queueDailyBulletinWhatsApp,
	updateDailyBulletinWhatsAppAudience,
	verifyDailyBulletinWhatsApp,
} from "~/server/bulletin-whatsapp";

const importsBeforeRequest = mocks.imports;
const request = {
	date: "2026-10-28",
	requestKey: "11111111-1111-4111-8111-111111111111",
	expectedAudience: "test" as const,
	expectedRevision: 4,
};

describe("WhatsApp server-function adapters", () => {
	beforeEach(() => {
		for (const fn of [mocks.read, mocks.verify, mocks.queue, mocks.audience])
			fn.mockReset();
	});
	it("declares a cached GET and three explicit POSTs without eager transport imports", () => {
		expect(mocks.methods).toEqual(["GET", "POST", "POST", "POST"]);
		expect(importsBeforeRequest).toBe(0);
	});
	it("reads cached state without invoking provider verification", async () => {
		const state = { settings: { audience: "test", revision: 4 } };
		mocks.read.mockResolvedValue(state);
		await expect(
			getDailyBulletinWhatsApp({ data: request.date }),
		).resolves.toEqual(state);
		expect(mocks.read).toHaveBeenCalledExactlyOnceWith(request.date);
		expect(mocks.verify).not.toHaveBeenCalled();
		expect(mocks.queue).not.toHaveBeenCalled();
	});
	it("verifies only after an explicit POST with a validated date", async () => {
		const state = { settings: { audience: "test", revision: 4 } };
		mocks.verify.mockResolvedValue(state);
		await expect(
			verifyDailyBulletinWhatsApp({ data: request.date }),
		).resolves.toEqual(state);
		expect(mocks.verify).toHaveBeenCalledExactlyOnceWith(request.date);
		expect(mocks.queue).not.toHaveBeenCalled();
		const invoke = verifyDailyBulletinWhatsApp as (request: {
			data: unknown;
		}) => Promise<unknown>;
		await expect(
			invoke({ data: { date: request.date, groupId: "override" } }),
		).rejects.toThrow();
		expect(mocks.verify).toHaveBeenCalledOnce();
	});
	it("enqueues the captured audience, revision and stable key without accepting targeting fields", async () => {
		const summary = {
			id: "job-1",
			date: request.date,
			audience: "test",
			status: "queued",
		};
		mocks.queue.mockResolvedValue(summary);
		await expect(
			queueDailyBulletinWhatsApp({ data: request }),
		).resolves.toEqual(summary);
		expect(mocks.queue).toHaveBeenCalledExactlyOnceWith(request);
		const invoke = queueDailyBulletinWhatsApp as (request: {
			data: unknown;
		}) => Promise<unknown>;
		for (const data of [
			{ ...request, groupId: "override" },
			{ ...request, apiUrl: "https://example.com" },
			{ ...request, token: "override" },
			{ ...request, expectedRevision: -1 },
		])
			await expect(invoke({ data })).rejects.toThrow();
		expect(mocks.queue).toHaveBeenCalledOnce();
	});
	it("requires real confirmation and forwards a return to test without it", async () => {
		await expect(
			updateDailyBulletinWhatsAppAudience({
				data: { audience: "real", expectedRevision: 4, confirmReal: false },
			}),
		).rejects.toThrow("נדרש אישור מפורש");
		expect(mocks.audience).not.toHaveBeenCalled();
		mocks.audience.mockResolvedValue({ audience: "real", revision: 5 });
		await expect(
			updateDailyBulletinWhatsAppAudience({
				data: { audience: "real", expectedRevision: 4, confirmReal: true },
			}),
		).resolves.toEqual({ audience: "real", revision: 5 });
		await updateDailyBulletinWhatsAppAudience({
			data: { audience: "test", expectedRevision: 5 },
		});
		expect(mocks.audience).toHaveBeenLastCalledWith({
			audience: "test",
			expectedRevision: 5,
			confirmReal: false,
		});
	});
	it("does not hide a settings/provider rejection or repeat an uncertain enqueue", async () => {
		mocks.read.mockRejectedValue(new Error("לא ניתן לקרוא את ההגדרות"));
		await expect(
			getDailyBulletinWhatsApp({ data: request.date }),
		).rejects.toThrow("לא ניתן לקרוא");
		mocks.verify.mockRejectedValue(new Error("הבדיקה אינה זמינה"));
		await expect(
			verifyDailyBulletinWhatsApp({ data: request.date }),
		).rejects.toThrow("הבדיקה אינה זמינה");
		mocks.queue.mockRejectedValue(new Error("תוצאת השליחה אינה ודאית"));
		await expect(queueDailyBulletinWhatsApp({ data: request })).rejects.toThrow(
			"אינה ודאית",
		);
		expect(mocks.queue).toHaveBeenCalledOnce();
		expect(mocks.audience).not.toHaveBeenCalled();
	});
});
